/**
 * "Claim once": marca atómica de un evento único-por-ventana, con el MISMO
 * backend swappeable que rate-limit.ts (A1).
 *
 * Caso de uso (M-S7): el aviso de pausa de sesión debe anexarse UNA sola vez. El
 * dedupe primario es leer los mensajes recientes (un assistant con safetyFlag
 * "session-warn"), pero dos pestañas simultáneas cerca del minuto 30 leen ambas
 * "sin aviso previo" y anexan las dos. `claimOnce` cierra esa carrera: la PRIMERA
 * llamada gana el slot; las concurrentes reciben `false` y no anexan.
 *
 * - Con Upstash configurado: `SET key val NX PX ttl` → atómico y COMPARTIDO entre
 *   instancias serverless (el modo correcto en prod).
 * - Sin Upstash (dev / instancia única): Map en memoria. JS es single-thread: el
 *   check-and-set no cede el event loop entre leer y escribir, así que da
 *   atomicidad por instancia.
 *
 * A diferencia de rate-limit, esto NO es un control de seguridad: un doble aviso
 * es solo cosmético. Por eso NO hace fail-fast en prod sin Upstash y NUNCA lanza:
 * ante Redis caído o no configurado, degrada a memoria en silencio.
 */

const UPSTASH_TIMEOUT_MS = 2_000;
const UPSTASH_KEY_PREFIX = "simon:once:";

// Store en memoria (dev / fallback). Cada clave guarda su expiración absoluta.
export type Claim = { expiresAt: number };
const claims = new Map<string, Claim>();

// Barrido perezoso para que el Map no crezca sin límite.
const CLAIM_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastClaimSweep = Date.now();

/**
 * Check-and-set atómico en memoria (función pura y testeable). Devuelve `true` si
 * la clave estaba libre/vencida y se reclamó ahora; `false` si sigue vigente.
 */
export function claimOnceMemory(
  store: Map<string, Claim>,
  key: string,
  ttlMs: number,
  now: number,
): boolean {
  const existing = store.get(key);
  if (existing && existing.expiresAt > now) return false;
  store.set(key, { expiresAt: now + ttlMs });
  return true;
}

function sweepClaims(now: number) {
  if (now - lastClaimSweep < CLAIM_SWEEP_INTERVAL_MS) return;
  lastClaimSweep = now;
  for (const [key, claim] of claims) {
    if (claim.expiresAt <= now) claims.delete(key);
  }
}

/**
 * Implementación Upstash REST: `SET key 1 NX PX ttl` en un solo round-trip.
 * Devuelve `true` si ganamos el slot ("OK"), `false` si ya estaba tomado (nil), o
 * `null` si Redis falló (el caller degrada a memoria).
 */
async function claimOnceUpstash(
  key: string,
  ttlMs: number,
  restUrl: string,
  restToken: string,
): Promise<boolean | null> {
  const redisKey = `${UPSTASH_KEY_PREFIX}${key}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTASH_TIMEOUT_MS);
  try {
    const res = await fetch(`${restUrl.replace(/\/$/, "")}/pipeline`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${restToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify([["SET", redisKey, "1", "NX", "PX", String(ttlMs)]]),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[claim-once] Upstash respondió ${res.status}; degradando a memoria`);
      return null;
    }
    const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const result = data?.[0]?.result;
    // "OK" → ganamos el slot; null → la clave ya existía (otra pestaña lo tomó).
    if (result === "OK") return true;
    if (result === null) return false;
    console.error("[claim-once] respuesta malformada de Upstash; degradando a memoria");
    return null;
  } catch (err) {
    console.error(
      "[claim-once] fallo de red/timeout contra Upstash; degradando a memoria:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Reclama `key` por `ttlMs`. `true` = esta llamada ganó (primera); `false` = ya
 * estaba reclamada. Nunca lanza.
 *
 * @param key   identificador del evento (p. ej. `session-warn:${userId}`)
 * @param ttlMs vida de la marca en ms (la ventana en la que el evento es único)
 */
export async function claimOnce(key: string, ttlMs: number): Promise<boolean> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restToken) {
    const shared = await claimOnceUpstash(key, ttlMs, restUrl, restToken);
    if (shared !== null) return shared;
    // Redis caído: fallback a memoria (acota por instancia; ya se logueó).
  }
  const now = Date.now();
  sweepClaims(now);
  return claimOnceMemory(claims, key, ttlMs, now);
}
