/**
 * Single-flight con cache TTL en memoria de proceso.
 *
 * Problema: una lectura cara y de baja frecuencia de cambio (p.ej. el corpus de
 * fichas de conocimiento) se cacheaba con TTL, pero al VENCER el TTL N requests
 * concurrentes disparaban N lecturas a la vez (thundering herd) antes de que la
 * primera repoblara el cache.
 *
 * `createTtlSingleFlight(load, ttlMs)` devuelve una función que:
 *   - Dentro del TTL: devuelve el valor cacheado (misma referencia — ver abajo).
 *   - Con el TTL vencido y una carga EN VUELO: los concurrentes esperan la MISMA
 *     promesa en vez de disparar su propia `load()`.
 *   - En éxito: cachea el valor con nueva expiración y libera la promesa en vuelo.
 *   - En error: NO cachea (no se cachean promesas rechazadas) y libera la promesa
 *     en vuelo, de modo que la próxima llamada reintenta la carga. El error se
 *     propaga al caller (nunca se traga).
 *
 * INVARIANTE DE REFERENCIA: durante un mismo TTL, todas las llamadas devuelven
 * la MISMA referencia del valor resuelto. Lo aprovecha el WeakMap de
 * `tokenizeCards` (system-prompt.ts), keyed por el array de fichas: misma
 * referencia → hit de memoización; al vencer el TTL se produce un valor nuevo y
 * la entrada vieja del WeakMap queda sin referencias para el GC.
 */
export function createTtlSingleFlight<T>(
  load: () => Promise<T>,
  ttlMs: number,
): () => Promise<T> {
  let cache: { value: T; expiresAt: number } | null = null;
  let inFlight: Promise<T> | null = null;

  return () => {
    const now = Date.now();
    if (cache && cache.expiresAt > now) return Promise.resolve(cache.value);
    if (!inFlight) {
      inFlight = load()
        .then((value) => {
          // Timestamp fresco al RESOLVER (no al iniciar): el TTL cubre el tiempo
          // durante el que el dato es válido desde que se obtuvo.
          cache = { value, expiresAt: Date.now() + ttlMs };
          return value;
        })
        .finally(() => {
          // Liberar el slot tras asentarse (éxito o error). En éxito las próximas
          // lecturas usan `cache` hasta que venza el TTL; al vencer, `inFlight` es
          // null → se relee. En error `cache` no se tocó → la próxima reintenta.
          inFlight = null;
        });
    }
    return inFlight;
  };
}
