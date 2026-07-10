/**
 * Reintento acotado para errores TRANSITORIOS del proveedor de IA (#36).
 *
 * `generateText` (chat) y el moderador LLM llaman a un gateway HTTP: un 502
 * puntual o un ECONNRESET no debería tirar directo al fallback/`available:false`
 * si un único reintento corto lo resuelve. Esto NO reemplaza los fallbacks
 * (siguen siendo el piso): solo evita perder una respuesta por un hipo de red.
 *
 * QUÉ SE REINTENTA (isTransientError):
 *   - APICallError del SDK `ai` con statusCode 5xx (server error).
 *   - Errores de red de Node/undici: ECONNRESET, ETIMEDOUT (socket), EAI_AGAIN,
 *     y el `TypeError: fetch failed` (se inspecciona el error y su `cause`).
 * QUÉ NO:
 *   - Abort/timeout del AbortSignal (name "AbortError"/"TimeoutError"): ES el
 *     presupuesto de latencia ya agotado; reintentar lo duplicaría.
 *   - 4xx (incluye 400/401/403/429): error de request/credenciales/cuota, no se
 *     arregla reintentando igual.
 *   - Errores de contenido/parseo (no tienen status ni código de red).
 *
 * PRESUPUESTO DE LATENCIA (documentado): el AbortSignal.timeout es POR INTENTO
 * (se crea uno nuevo en cada intento; una señal ya abortada quedaría inservible).
 * Peor caso teórico = 2·timeoutPorIntento + backoff. PERO un error transitorio
 * que SÍ se reintenta (5xx/ECONNRESET/fetch failed) falla RÁPIDO — la conexión
 * se resetea o el gateway responde 5xx enseguida, muy por debajo del timeout;
 * un fallo que consume el timeout completo aborta como TimeoutError y NO se
 * reintenta. Por eso el peor caso REAL ≈ (fallo rápido ~<2s) + backoff(~0.3s) +
 * 1 intento completo, que entra cómodo en el maxDuration=60 de la ruta de chat
 * junto con la moderación de salida. p99 añadido ≈ backoff.
 */

const TRANSIENT_NET_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPIPE",
]);

/** Backoff base y jitter (nombrados; el jitter evita reintentos sincronizados). */
export const RETRY_BACKOFF_MS = 300;
export const RETRY_JITTER_MS = 150;

/** Recorre el error y su cadena de `cause` (acotada) sin ciclar. */
function* errorChain(err: unknown, maxDepth = 4): Generator<Record<string, unknown>> {
  let current: unknown = err;
  const seen = new Set<unknown>();
  for (let i = 0; i < maxDepth && current && typeof current === "object"; i++) {
    if (seen.has(current)) return;
    seen.add(current);
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

function nameOf(e: Record<string, unknown>): string {
  return typeof e.name === "string" ? e.name : "";
}
function codeOf(e: Record<string, unknown>): string {
  return typeof e.code === "string" ? e.code : "";
}
function messageOf(e: Record<string, unknown>): string {
  return typeof e.message === "string" ? e.message : "";
}
function statusOf(e: Record<string, unknown>): number | undefined {
  const raw =
    typeof e.statusCode === "number"
      ? e.statusCode
      : typeof e.status === "number"
        ? e.status
        : undefined;
  return raw;
}

/** Abort/timeout del AbortSignal: NUNCA es transitorio (presupuesto agotado). */
function isAbortLike(err: unknown): boolean {
  for (const e of errorChain(err)) {
    const n = nameOf(e);
    if (n === "AbortError" || n === "TimeoutError") return true;
  }
  return false;
}

/**
 * Clasificador PURO: ¿el error amerita un reintento corto? Ver política arriba.
 * Función exportada para testear sobre shapes representativos.
 */
export function isTransientError(err: unknown): boolean {
  // El abort/timeout gana sobre todo: es el tope de latencia, no un hipo de red.
  if (isAbortLike(err)) return false;
  for (const e of errorChain(err)) {
    const status = statusOf(e);
    if (typeof status === "number") {
      if (status >= 500 && status <= 599) return true;
      if (status >= 400 && status <= 499) return false; // 4xx: no reintentar
    }
    if (TRANSIENT_NET_CODES.has(codeOf(e))) return true;
    if (/\bfetch failed\b|socket hang up|network error/i.test(messageOf(e))) {
      return true;
    }
  }
  return false;
}

export interface RetryOpts {
  /** Cantidad de REINTENTOS (no incluye el intento inicial). Default 1. */
  retries?: number;
  backoffMs?: number;
  jitterMs?: number;
  /** Clasificador (default isTransientError). Inyectable para testear. */
  isTransient?: (err: unknown) => boolean;
  /** Hook de observabilidad por reintento. */
  onRetry?: (err: unknown, attempt: number) => void;
  /** Seam de espera (inyectable en tests para no dormir de verdad). */
  sleep?: (ms: number) => Promise<void>;
  /** Fuente de aleatoriedad del jitter (inyectable). */
  random?: () => number;
}

function backoffDelay(opts: RetryOpts): number {
  const base = opts.backoffMs ?? RETRY_BACKOFF_MS;
  const jitter = opts.jitterMs ?? RETRY_JITTER_MS;
  const rnd = (opts.random ?? Math.random)();
  return base + Math.floor(rnd * jitter);
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ejecuta `fn` y, SOLO ante un error transitorio, la reintenta hasta `retries`
 * veces con backoff+jitter. IMPORTANTE: `fn` debe crear sus propios recursos
 * por invocación (p.ej. un AbortSignal.timeout nuevo) — cada intento es una
 * llamada limpia. Re-lanza el último error si se agotan los reintentos o si el
 * error no es transitorio.
 */
export async function withTransientRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const retries = opts.retries ?? 1;
  const isTransient = opts.isTransient ?? isTransientError;
  const sleep = opts.sleep ?? defaultSleep;
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isTransient(err)) throw err;
      attempt += 1;
      opts.onRetry?.(err, attempt);
      await sleep(backoffDelay(opts));
    }
  }
}
