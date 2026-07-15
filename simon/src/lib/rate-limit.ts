/**
 * Rate limiter por clave (userId) con backend swappeable (A1).
 *
 * - Con `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`: ventana FIJA
 *   compartida en Upstash Redis vía REST (INCR + PEXPIRE NX + PTTL en un
 *   /pipeline, fetch nativo, sin SDK). Es el modo correcto para serverless:
 *   todas las instancias comparten el contador.
 * - Sin esas env (dev / instancia única): ventana deslizante en memoria.
 *
 * PRODUCCIÓN: el modo in-memory NO se comparte entre instancias serverless y por
 * eso protege menos que Upstash. Aun así, es un fallback operativo: la ausencia
 * de un servicio opcional no puede tumbar chat, historial y superficies del
 * tutor. `assertProdEnv()` deja una advertencia accionable en el cold start.
 *
 * Robustez: si Redis está CONFIGURADO pero no responde (timeout 2s, red caída,
 * respuesta rara), se DEGRADA a la implementación in-memory para esa llamada y
 * se loguea por console.error — el rate limiting nunca tumba una request
 * legítima, y el fallback in-memory sigue acotando por instancia mientras dura
 * el incidente. (Esta degradación por caída transitoria NO lanza: Upstash SÍ
 * está configurado; el fail-fast de #35 cubre solo la config AUSENTE.)
 *
 * La interfaz `checkRateLimit` es el único punto de contacto (ahora async).
 */

// Cada bucket guarda SU propia ventana (H1): una clave "por minuto" y una "por
// día" conviven en el mismo Map con ventanas distintas, y el sweep debe podar
// cada una con la suya.
export type Bucket = { timestamps: number[]; windowMs: number };

const buckets = new Map<string, Bucket>();

// Limpieza periódica para que el Map no crezca sin límite.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweep = Date.now();

/**
 * Poda cada bucket usando SU PROPIA ventana (H1). Función pura y testeable.
 *
 * BUG QUE CORRIGE: antes el sweep filtraba TODOS los buckets con la ventana de
 * la llamada actual. Como el chat llama primero al límite por minuto (60s), un
 * sweep disparado en ese momento borraba los timestamps del bucket diario
 * (24h) → el tope de 400/día nunca se alcanzaba en modo in-memory. Ahora cada
 * bucket se poda con `bucket.windowMs`.
 */
export function sweepBuckets(map: Map<string, Bucket>, now: number): void {
  for (const [key, bucket] of map) {
    bucket.timestamps = bucket.timestamps.filter((t) => now - t < bucket.windowMs);
    if (bucket.timestamps.length === 0) map.delete(key);
  }
}

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  sweepBuckets(buckets, now);
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

/** Implementación in-memory (ventana deslizante). Dev / fallback. */
function checkRateLimitMemory(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { timestamps: [], windowMs };
    buckets.set(key, bucket);
  } else {
    // La ventana de una clave es estable en la práctica, pero mantenerla al día
    // asegura que el sweep pode con la ventana correcta si algo la cambiara.
    bucket.windowMs = windowMs;
  }
  bucket.timestamps = bucket.timestamps.filter((t) => now - t < windowMs);

  if (bucket.timestamps.length >= max) {
    const oldest = bucket.timestamps[0];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((oldest + windowMs - now) / 1000),
    );
    return { ok: false, retryAfterSeconds };
  }

  bucket.timestamps.push(now);
  return { ok: true };
}

const UPSTASH_TIMEOUT_MS = 2_000;
const UPSTASH_KEY_PREFIX = "simon:rl:";

/**
 * Implementación Upstash REST (ventana fija: la clave vive `windowMs` desde el
 * primer hit — suficiente para estos límites; sin sorted sets para mantenerlo
 * en un solo round-trip). Devuelve `null` si Redis falló (el caller degrada).
 */
async function checkRateLimitUpstash(
  key: string,
  max: number,
  windowMs: number,
  restUrl: string,
  restToken: string,
): Promise<RateLimitResult | null> {
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
      // PEXPIRE ... NX: solo fija TTL si la clave no lo tiene (primer hit de
      // la ventana). PTTL: para calcular retry-after exacto.
      body: JSON.stringify([
        ["INCR", redisKey],
        ["PEXPIRE", redisKey, String(windowMs), "NX"],
        ["PTTL", redisKey],
      ]),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[rate-limit] Upstash respondió ${res.status}; degradando a in-memory`);
      return null;
    }
    const data = (await res.json()) as Array<{ result?: unknown; error?: string }>;
    const count = data?.[0]?.result;
    const pttl = data?.[2]?.result;
    if (typeof count !== "number") {
      console.error("[rate-limit] respuesta malformada de Upstash; degradando a in-memory");
      return null;
    }
    if (count <= max) return { ok: true };
    const retryAfterSeconds =
      typeof pttl === "number" && pttl > 0
        ? Math.max(1, Math.ceil(pttl / 1000))
        : Math.max(1, Math.ceil(windowMs / 1000));
    return { ok: false, retryAfterSeconds };
  } catch (err) {
    console.error(
      "[rate-limit] fallo de red/timeout contra Upstash; degradando a in-memory:",
      err instanceof Error ? err.message : err,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param key      identificador (p. ej. `chat:${userId}`)
 * @param max      máximo de eventos permitidos dentro de la ventana
 * @param windowMs tamaño de la ventana en ms
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const hasUpstash = Boolean(restUrl && restToken);
  if (hasUpstash) {
    const shared = await checkRateLimitUpstash(key, max, windowMs, restUrl!, restToken!);
    if (shared !== null) return shared;
    // Redis caído: fallback in-memory (acota por instancia; ya se logueó).
  }
  return checkRateLimitMemory(key, max, windowMs);
}
