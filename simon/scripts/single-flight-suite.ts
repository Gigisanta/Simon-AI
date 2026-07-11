/**
 * Suite de single-flight.ts — cache TTL con coalescing de cargas concurrentes.
 *
 *   pnpm single-flight-suite
 *
 * Testea SOLO lógica pura y determinística (sin red): el reloj se controla
 * pisando `Date.now`, y la carga se controla con promesas diferidas (deferred)
 * para orquestar el estado "en vuelo" sin timers reales. Casos:
 *   1. Coalescing: N llamadas concurrentes mientras una carga está en vuelo →
 *      una sola `load()`; todas resuelven al MISMO valor (invariante de referencia).
 *   2. Cache dentro del TTL: no recarga; misma referencia.
 *   3. Vencido el TTL: recarga y produce una referencia nueva.
 *   4. EDGE — la promesa en vuelo RECHAZA: el rechazo NO se cachea, se propaga a
 *      todos los awaiters, y la siguiente llamada REINTENTA la carga (y puede tener
 *      éxito).
 *
 * Thundering herd sobre una lectura cara: sin coalescing, N requests al vencer el
 * TTL disparan N cargas. Sale con código 1 si algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import { createTtlSingleFlight } from "../src/lib/single-flight";

const { check, done } = createChecker("Single-flight suite");

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function main() {
  const TTL = 100;
  let now = 1_000;
  const realNow = Date.now;
  Date.now = () => now;

  try {
    let loads = 0;
    let pending = deferred<{ v: number }>();
    const sf = createTtlSingleFlight<{ v: number }>(() => {
      loads += 1;
      return pending.promise;
    }, TTL);

    // ---------- 1. Coalescing de concurrentes en vuelo ----------
    const p1 = sf();
    const p2 = sf();
    const p3 = sf();
    check(loads === 1, "3 llamadas concurrentes en vuelo → una sola load()");
    const first = { v: 1 };
    pending.resolve(first);
    const [a, b, c] = await Promise.all([p1, p2, p3]);
    check(a === first && b === first && c === first, "las 3 resuelven a la MISMA referencia");

    // ---------- 2. Dentro del TTL: cache, sin recargar ----------
    // now sigue en 1_000; expiresAt = 1_000 + 100 = 1_100.
    now = 1_050;
    const cached = await sf();
    check(loads === 1 && cached === first, "dentro del TTL → valor cacheado, sin recargar, misma referencia");

    // ---------- 3. TTL vencido → recarga, referencia nueva ----------
    now = 1_200; // > 1_100
    pending = deferred<{ v: number }>();
    const p4 = sf();
    check(loads === 2, "TTL vencido → recarga (segunda load)");
    const second = { v: 2 };
    pending.resolve(second);
    const d = await p4;
    check(d === second && d !== first, "tras vencer el TTL → referencia nueva");

    // ---------- 4. EDGE: la carga en vuelo RECHAZA ----------
    now = 2_000; // vence el cache anterior (expiresAt = 1_300)
    pending = deferred<{ v: number }>();
    const rej1 = sf();
    const rej2 = sf();
    check(loads === 3, "una sola load para las concurrentes que van a fallar");
    const boom = new Error("carga falló");
    pending.reject(boom);
    let t1 = false;
    let t2 = false;
    await rej1.catch((e) => {
      t1 = e === boom;
    });
    await rej2.catch((e) => {
      t2 = e === boom;
    });
    check(t1 && t2, "el rechazo se propaga a TODOS los awaiters (no se traga)");

    // 4b. El rechazo NO se cacheó → la siguiente llamada reintenta y puede tener éxito.
    // now sigue en 2_000; si el rechazo se hubiera cacheado, no recargaría.
    pending = deferred<{ v: number }>();
    const retry = sf();
    check(loads === 4, "tras el rechazo → la siguiente llamada REINTENTA la carga");
    const third = { v: 3 };
    pending.resolve(third);
    const e = await retry;
    check(e === third, "el reintento tras el rechazo tiene éxito");
  } finally {
    Date.now = realNow;
  }

  done();
}

main();
