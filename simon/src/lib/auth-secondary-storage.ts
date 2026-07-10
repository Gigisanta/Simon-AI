/**
 * SecondaryStorage de better-auth respaldado por Upstash Redis REST (F3, A1).
 *
 * Con `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` seteadas, better-auth
 * usa este storage para su rate limiting (`rateLimit.storage:
 * "secondary-storage"`): el contador de intentos de login/registro pasa a ser
 * COMPARTIDO entre instancias serverless en vez de por proceso. Sin esas env,
 * `upstashSecondaryStorage()` devuelve undefined y better-auth queda como hoy
 * (memory por instancia).
 *
 * Robustez (mismo criterio que src/lib/rate-limit.ts, sin acoplarse a él):
 * fetch nativo contra el endpoint /pipeline, timeout corto, y si Redis no
 * responde se DEGRADA a un Map in-memory por instancia (fallo abierto: un
 * incidente de Redis nunca tumba el login; el fallback sigue acotando por
 * proceso mientras dura). Las SESIONES no dependen de esto: se fuerza
 * `session.storeSessionInDatabase: true` en lib/auth.ts, así Postgres sigue
 * siendo la fuente de verdad y un miss de Redis cae a la DB.
 */

import { withTransientRetry } from "@/lib/ai/retry";

const UPSTASH_TIMEOUT_MS = 2_000;
// Prefijo propio: no colisiona con "simon:rl:" (rate limit de la app).
const KEY_PREFIX = "simon:ba:";

// ---------- Fallback in-memory (solo si Redis falla) ----------
type MemEntry = { value: string; expiresAt: number | null };
const memStore = new Map<string, MemEntry>();
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweep = Date.now();

function memSweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of memStore) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) memStore.delete(key);
  }
}

function memGet(key: string): string | null {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    memStore.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlSeconds?: number) {
  const now = Date.now();
  memSweep(now);
  memStore.set(key, {
    value,
    expiresAt: ttlSeconds ? now + ttlSeconds * 1000 : null,
  });
}

function memIncrement(key: string, ttlSeconds: number): number {
  const current = memGet(key);
  const next = (current !== null ? Number.parseInt(current, 10) || 0 : 0) + 1;
  if (current !== null) {
    // Conserva el TTL original de la ventana (solo se fija al crear).
    const entry = memStore.get(key)!;
    entry.value = String(next);
  } else {
    memSet(key, String(next), ttlSeconds);
  }
  return next;
}

// ---------- Upstash REST ----------
type PipelineResult = Array<{ result?: unknown; error?: string }>;

/**
 * Ejecuta comandos en el /pipeline de Upstash. Devuelve null si Redis falló
 * (timeout, red, status != 200) — el caller degrada a in-memory.
 */
async function pipeline(
  restUrl: string,
  restToken: string,
  commands: string[][],
): Promise<PipelineResult | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
  try {
    const res = await fetch(`${restUrl.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${restToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(commands),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[auth-storage] Upstash respondió ${res.status}; degradando a in-memory`);
      return null;
    }
    return (await res.json()) as PipelineResult;
  } catch (err) {
    console.error(
      "[auth-storage] fallo de red/timeout contra Upstash; degradando a in-memory:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Superficie interna expuesta SOLO para scripts/auth-storage-suite.ts: permite
 * testear el fallback in-memory (memGet/memSet/memIncrement/memSweep, TTLs) de
 * forma determinística sin red. No la use código de producción.
 */
export const __testing = {
  memStore,
  memGet,
  memSet,
  memIncrement,
  memSweep,
  /** Reinicia el estado in-memory + el reloj de sweep entre casos de test. */
  reset() {
    memStore.clear();
    lastSweep = 0;
  },
};

/** Forma estructural del SecondaryStorage de better-auth 1.6 (TTL en segundos). */
export type AuthSecondaryStorage = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttl?: number) => Promise<void>;
  delete: (key: string) => Promise<void>;
  increment: (key: string, ttl: number) => Promise<number>;
};

/**
 * Invalida las copias de sesión de un usuario en el secondaryStorage (Redis) —
 * L4. Complementa el borrado en DB (cascade al borrar el menor/tutor, o
 * `session.deleteMany` al suspender el consentimiento).
 *
 * POR QUÉ HACE FALTA: con Upstash configurado, better-auth cachea cada sesión en
 * Redis y su `findSession` CONFÍA en esa copia si existe (aun con
 * `storeSessionInDatabase: true`, solo cae a la DB cuando la copia NO está). Si
 * al borrar/suspender al menor se borran únicamente las filas de DB, las copias
 * de Redis seguirían autenticando al menor hasta que expiren por TTL — un menor
 * sin supervisión seguiría chateando. Este helper las elimina explícitamente.
 *
 * Replica EXACTAMENTE el esquema de claves del internal-adapter de better-auth:
 *   - `active-sessions-<userId>` → JSON `[{ token, expiresAt }]` (lista índice).
 *   - `<token>`                  → copia de la sesión.
 * Borra cada token de la lista y después la lista.
 *
 * FAIL-CLOSED (L3, ciclo 15). ESTE camino es CRÍTICO: al SUSPENDER el
 * consentimiento de un menor, si el DELETE contra Redis no corre, la copia
 * cacheada de la sesión sigue autenticándolo (better-auth confía en la copia de
 * Redis si existe) y el menor seguiría chateando pese a la revocación. Por eso
 * acá NO se usa el fallback silencioso a in-memory del secondaryStorage (que
 * escribiría en un Map inútil sin tocar el Redis real): se habla con Upstash
 * DIRECTO, con un reintento corto (patrón lib/ai/retry.ts), y si aun así falla se
 * devuelve la señal de fallo (`false`) + un log nivel error accionable. El caller
 * de consent-revoked propaga esa señal (sessionsRevoked: false) para visibilidad.
 *
 * Devuelve `true` si la revocación en Redis se completó (o si no hay Upstash
 * configurado → no-op: las sesiones viven solo en DB y el cascade/deleteMany ya
 * las cubre). Devuelve `false` SOLO si Upstash quedó inalcanzable tras el
 * reintento (la copia cacheada podría seguir válida hasta su TTL).
 */
export async function revokeUserSessions(userId: string): Promise<boolean> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  // Sin env de Upstash → no-op: no hay copias en Redis, la DB es la única fuente.
  if (!restUrl || !restToken) return true;

  const indexKey = `active-sessions-${userId}`;

  // 1) Leer la lista índice (con reintento corto). Un null tras el reintento = no
  //    se pudo confirmar contra Redis → fail-closed (no se degrada a memoria).
  const listRes = await pipelineWithRetry(restUrl, restToken, [
    ["GET", KEY_PREFIX + indexKey],
  ]);
  if (listRes === null) {
    console.error(
      `[auth-storage] revokeUserSessions: Upstash inalcanzable al leer la lista de sesiones de ${userId}; ` +
        "la copia cacheada podría seguir autenticando al menor hasta su TTL. Revocación NO confirmada.",
    );
    return false;
  }

  let sessions: Array<{ token?: string }> = [];
  const raw = listRes[0]?.result;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) sessions = parsed;
    } catch {
      // Lista corrupta: igual se borra la clave índice abajo.
      sessions = [];
    }
  }

  // 2) Borrar cada token + la clave índice en UN pipeline (con reintento). Los
  //    tokens ANTES que la clave índice (mismo orden que el internal-adapter).
  const dels: string[][] = sessions
    .filter((s) => s?.token)
    .map((s) => ["DEL", KEY_PREFIX + s.token!]);
  dels.push(["DEL", KEY_PREFIX + indexKey]);

  const delRes = await pipelineWithRetry(restUrl, restToken, dels);
  if (delRes === null) {
    console.error(
      `[auth-storage] revokeUserSessions: Upstash inalcanzable al borrar las sesiones de ${userId}; ` +
        "la copia cacheada podría seguir autenticando al menor hasta su TTL. Revocación NO confirmada.",
    );
    return false;
  }
  return true;
}

/**
 * `pipeline` con reintento corto y acotado (L3). `pipeline` NO lanza: devuelve
 * null ante cualquier fallo de Redis (timeout, no-200, JSON malformado). Para
 * reintentar reusamos la mecánica de lib/ai/retry.ts (backoff+jitter, tope de
 * intentos): el factory relanza el null como excepción y el clasificador es
 * `() => true` (cualquier fallo de Redis en un camino crítico amerita reintentar,
 * acotado). Si el reintento se agota, se devuelve null (el caller falla cerrado).
 */
async function pipelineWithRetry(
  restUrl: string,
  restToken: string,
  commands: string[][],
): Promise<PipelineResult | null> {
  try {
    return await withTransientRetry(
      async () => {
        const r = await pipeline(restUrl, restToken, commands);
        if (r === null) throw new Error("upstash-unreachable");
        return r;
      },
      { retries: 2, isTransient: () => true },
    );
  } catch {
    return null;
  }
}

/**
 * Storage compartido si hay env de Upstash; undefined si no (comportamiento
 * actual intacto: better-auth usa memory).
 */
export function upstashSecondaryStorage(): AuthSecondaryStorage | undefined {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!restUrl || !restToken) return undefined;

  return {
    async get(key) {
      const r = await pipeline(restUrl, restToken, [["GET", KEY_PREFIX + key]]);
      if (r === null) return memGet(key);
      const value = r[0]?.result;
      return typeof value === "string" ? value : null;
    },

    async set(key, value, ttl) {
      const cmd =
        typeof ttl === "number" && ttl > 0
          ? ["SET", KEY_PREFIX + key, value, "EX", String(Math.ceil(ttl))]
          : ["SET", KEY_PREFIX + key, value];
      const r = await pipeline(restUrl, restToken, [cmd]);
      if (r === null) memSet(key, value, ttl);
    },

    async delete(key) {
      const r = await pipeline(restUrl, restToken, [["DEL", KEY_PREFIX + key]]);
      if (r === null) memStore.delete(key);
    },

    // Atómico (lo usa el rate limiter de better-auth): INCR + EXPIRE NX — el
    // TTL solo se fija al crear la clave, la ventana no se estira por hit.
    async increment(key, ttl) {
      const r = await pipeline(restUrl, restToken, [
        ["INCR", KEY_PREFIX + key],
        ["EXPIRE", KEY_PREFIX + key, String(Math.max(1, Math.ceil(ttl))), "NX"],
      ]);
      const count = r?.[0]?.result;
      if (typeof count === "number") return count;
      if (r !== null) {
        console.error("[auth-storage] respuesta malformada de Upstash en INCR; degradando a in-memory");
      }
      return memIncrement(key, ttl);
    },
  };
}
