/**
 * Suite del single-flight + TTL de la cache de conocimiento — ciclo #26.
 *
 *   pnpm knowledge-cache-suite   (o: tsx scripts/knowledge-cache-suite.ts)
 *
 * Testea SOLO lógica pura (sin red, sin DB): createTtlSingleFlight, el helper que
 * usa loadKnowledgeCards en src/app/api/chat/route.ts. Verifica el invariante que
 * el WeakMap de tokenizeCards (system-prompt.ts) necesita —misma referencia del
 * valor durante el TTL— y la garantía de coalescing bajo concurrencia:
 *   1. Coalescing: N llamadas concurrentes con el TTL vencido comparten UNA sola
 *      ejecución de load() y todas resuelven al mismo valor.
 *   2. Cache dentro del TTL: sin re-ejecutar load(), misma referencia.
 *   3. Expiración del TTL: vencido, se vuelve a ejecutar load() (referencia nueva).
 *   4. Error no cacheado: si load() rechaza, el error se propaga y la próxima
 *      llamada REINTENTA (no queda una promesa rechazada pegada).
 *
 * Camino de perf (no disparar N findMany al vencer el TTL) + invariante de
 * memoización. Sale con código 1 si algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import { createTtlSingleFlight } from "../src/lib/single-flight";

const { check, done } = createChecker("Knowledge cache single-flight suite");

/** Deferred manual para controlar cuándo resuelve/rechaza una carga. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  // ---------- 1. Coalescing bajo concurrencia ----------
  {
    let calls = 0;
    const d = deferred<string[]>();
    const load = () => {
      calls += 1;
      return d.promise;
    };
    const get = createTtlSingleFlight(load, 10_000);

    // Tres llamadas concurrentes ANTES de que la carga resuelva.
    const p1 = get();
    const p2 = get();
    const p3 = get();
    check(calls === 1, "3 llamadas concurrentes → load() se ejecuta UNA sola vez");

    const value = ["ficha-a", "ficha-b"];
    d.resolve(value);
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    check(r1 === value && r2 === value && r3 === value, "todas resuelven al MISMO valor");
    check(calls === 1, "tras resolver, sigue habiendo una sola ejecución");
  }

  // ---------- 2. Cache dentro del TTL (misma referencia) ----------
  {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return [{ id: calls }]; // referencia nueva por ejecución
    };
    const get = createTtlSingleFlight(load, 10_000);

    const a = await get();
    const b = await get();
    check(calls === 1, "dentro del TTL no se re-ejecuta load()");
    check(a === b, "dentro del TTL devuelve la MISMA referencia (invariante WeakMap)");
  }

  // ---------- 3. Expiración del TTL (referencia nueva) ----------
  {
    let calls = 0;
    const load = async () => {
      calls += 1;
      return { gen: calls };
    };
    // TTL 0 → cualquier lectura posterior a la resolución ya está vencida.
    const get = createTtlSingleFlight(load, 0);

    const a = await get();
    await tick(); // asegura que Date.now() avance más allá de expiresAt (= ahora)
    const b = await get();
    check(calls === 2, "con el TTL vencido se vuelve a ejecutar load()");
    check(a !== b, "tras vencer el TTL devuelve una referencia NUEVA");
  }

  // ---------- 4. Error no cacheado → reintento ----------
  {
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error("db caída");
      return ["recuperado"];
    };
    const get = createTtlSingleFlight(load, 10_000);

    let threw = false;
    try {
      await get();
    } catch {
      threw = true;
    }
    check(threw, "un load() que rechaza PROPAGA el error (no lo traga)");

    const recovered = await get();
    check(calls === 2, "tras un error, la próxima llamada REINTENTA load()");
    check(recovered[0] === "recuperado", "el reintento devuelve el valor bueno");
  }

  done();
}

main();
