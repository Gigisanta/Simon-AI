/**
 * Suite del circuit-breaker COMPARTIDO de proveedores (lib/ai/provider.ts) — obj-a.
 *
 *   pnpm provider-health-shared-suite
 *
 * Testea `createUpstashProviderHealthStore` con FAKE fetch (sin red, sin timers
 * reales, sin tocar process.env). Un fake "Redis" en memoria simula Upstash
 * REST con expiración por PX gobernada por un reloj controlado, así se pueden
 * reproducir de forma determinística:
 *   1. Upstash OK: estado compartido entre instancias (una marca, la otra la ve).
 *   2. Reprobe por TTL: la clave expira sola y el proveedor vuelve a ser usable.
 *   3. markHealthy solo escribe en la transición no-sano→sano (no en cada éxito).
 *   4. Cache del espejo: ≤1 round-trip a Redis por decisión dentro de la ventana.
 *   5. Upstash caído (throw y 5xx): degrada al espejo local, loguea UNA sola vez.
 *   6. Carrera: refresh no pisa una marca local MÁS NUEVA que el propio refresh.
 *
 * Los casos del breaker en memoria (createProviderHealthStore + resolveProvider)
 * viven en provider-router-suite.ts y siguen intactos. Sale con código 1 si algo
 * falla (gate CI).
 */
import { createChecker } from "./suite-helpers";
import {
  createUpstashProviderHealthStore,
  type ProviderHealthStore,
} from "../src/lib/ai/provider";

const { check, done } = createChecker("Provider-health compartido suite");

const REPROBE = 1_000; // ventana de reprobe corta para números claros
const CACHE = 100; // frescura del espejo local

/** Deja drenar los writes fire-and-forget (SET/DEL) antes de asertar. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

type Mode = "ok" | "down" | "http500";

/**
 * Fake Upstash REST compartido: un Map con expiración por PX contra un reloj
 * manual. Varios stores que apunten al MISMO `fetchImpl` comparten estado, igual
 * que varias instancias serverless contra el mismo Redis.
 */
function makeFakeRedis() {
  const kv = new Map<string, { value: string; expiresAt: number }>();
  let clock = 0;
  let calls = 0;
  let mode: Mode = "ok";

  const fetchImpl = (async (_url: string, init: { body: string }) => {
    calls += 1;
    if (mode === "down") throw new Error("ECONNREFUSED (fake redis caído)");
    if (mode === "http500") {
      return { ok: false, status: 500, json: async () => [] } as unknown as Response;
    }
    const commands = JSON.parse(init.body) as unknown[][];
    const results = commands.map((cmd) => {
      const [op, key, val, , px] = cmd as [string, string, string, string, string];
      if (op === "GET") {
        const e = kv.get(key);
        if (!e) return { result: null };
        if (clock >= e.expiresAt) {
          kv.delete(key);
          return { result: null };
        }
        return { result: e.value };
      }
      if (op === "SET") {
        kv.set(key, { value: String(val), expiresAt: clock + Number(px) });
        return { result: "OK" };
      }
      if (op === "DEL") {
        return { result: kv.delete(key) ? 1 : 0 };
      }
      return { error: `cmd desconocido: ${op}` };
    });
    return { ok: true, status: 200, json: async () => results } as unknown as Response;
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    setClock: (t: number) => { clock = t; },
    setMode: (m: Mode) => { mode = m; },
    callCount: () => calls,
    resetCalls: () => { calls = 0; },
    has: (key: string) => kv.has(key),
  };
}

const KEY = "simon:pcb:primary";
const NAMES = ["primary", "fallback"];

function makeStore(
  redis: ReturnType<typeof makeFakeRedis>,
  onError?: (msg: string, err?: unknown) => void,
): ProviderHealthStore {
  return createUpstashProviderHealthStore({
    restUrl: "https://fake.upstash.io",
    restToken: "tok",
    reprobeMs: REPROBE,
    cacheTtlMs: CACHE,
    fetchImpl: redis.fetchImpl,
    onError,
  });
}

async function main() {
  // ---------- 1. Upstash OK: estado compartido entre instancias ----------
  {
    const redis = makeFakeRedis();
    const a = makeStore(redis); // "instancia A"
    const b = makeStore(redis); // "instancia B", mismo Redis

    await a.refresh!(NAMES, 0);
    check(a.isUsable("primary", 0) === true, "OK: sin marcas, primary usable");

    a.markUnhealthy("primary", 0);
    await flush();
    check(redis.has(KEY), "OK: markUnhealthy escribe la clave en Redis");
    check(a.isUsable("primary", 0) === false, "OK: A ve su propia marca (espejo local)");

    // B todavía no refrescó: su espejo está vacío.
    check(b.isUsable("primary", 0) === true, "OK: B aún no refrescó → no ve la marca");
    await b.refresh!(NAMES, 0);
    check(
      b.isUsable("primary", 0) === false,
      "COMPARTIDO: B ve la marca de A tras refresh (estado entre instancias)",
    );
    check(b.isUsable("fallback", 0) === true, "COMPARTIDO: fallback sigue sano en B");
  }

  // ---------- 2. Reprobe por TTL: la clave expira y vuelve a ser usable ----------
  {
    const redis = makeFakeRedis();
    const a = makeStore(redis);
    a.markUnhealthy("primary", 0);
    await flush();
    check(a.isUsable("primary", REPROBE - 1) === false, "TTL: dentro de la ventana sigue no-sano");

    // Reloj más allá del PX → GET devuelve null (expiró) → refresh limpia el espejo.
    redis.setClock(REPROBE);
    await a.refresh!(NAMES, REPROBE);
    check(a.isUsable("primary", REPROBE) === true, "TTL: al expirar la clave, reprobe → usable");
    check(!redis.has(KEY), "TTL: GET expirado además purga la clave en Redis");
  }

  // ---------- 3. markHealthy: solo escribe en la transición ----------
  {
    const redis = makeFakeRedis();
    const a = makeStore(redis);
    a.markUnhealthy("primary", 0);
    await flush();
    redis.resetCalls();

    a.markHealthy("primary"); // había marca local → DEL
    await flush();
    check(!redis.has(KEY), "markHealthy transición: borra la clave en Redis");
    check(redis.callCount() === 1, "markHealthy transición: exactamente 1 write (DEL)");

    redis.resetCalls();
    a.markHealthy("primary"); // sin marca local (éxito estable) → NO escribe
    await flush();
    check(redis.callCount() === 0, "markHealthy sin marca previa: 0 writes (no paga Redis por éxito)");
  }

  // ---------- 4. Cache del espejo: ≤1 round-trip por decisión ----------
  {
    const redis = makeFakeRedis();
    const a = makeStore(redis);
    redis.resetCalls();
    await a.refresh!(NAMES, 0);
    await a.refresh!(NAMES, CACHE - 1); // dentro de la ventana → NO pega a Redis
    check(redis.callCount() === 1, "cache: dos refresh dentro de la ventana = 1 round-trip");
    await a.refresh!(NAMES, CACHE + 1); // ventana vencida → nuevo round-trip
    check(redis.callCount() === 2, "cache: pasada la ventana, refresh vuelve a pegar a Redis");
  }

  // ---------- 5. Upstash caído: degrada al espejo local, loguea una vez ----------
  {
    const redis = makeFakeRedis();
    redis.setMode("down");
    let logs = 0;
    const a = makeStore(redis, () => { logs += 1; });

    await a.refresh!(NAMES, 0); // fetch throws → no revienta
    check(a.isUsable("primary", 0) === true, "caído: refresh no lanza, sigue con espejo local");

    a.markUnhealthy("primary", 0); // SET falla, pero el espejo local se actualiza
    await flush();
    check(
      a.isUsable("primary", 0) === false,
      "caído: el breaker local sigue funcionando aunque Redis no responda",
    );

    await a.refresh!(NAMES, CACHE + 1);
    a.markUnhealthy("fallback", CACHE + 1);
    await flush();
    check(logs === 1, "caído: loguea UNA sola vez pese a múltiples fallos de Redis");
  }

  // 5b. Upstash responde 5xx (res.ok=false) también degrada y loguea.
  {
    const redis = makeFakeRedis();
    redis.setMode("http500");
    let logs = 0;
    const a = makeStore(redis, () => { logs += 1; });
    await a.refresh!(NAMES, 0);
    check(logs === 1, "5xx: respuesta no-ok degrada y loguea una vez");
    check(a.isUsable("primary", 0) === true, "5xx: sin datos, cae al espejo local (usable)");
  }

  // ---------- 6. Carrera: refresh no pisa una marca local MÁS NUEVA ----------
  {
    const redis = makeFakeRedis();
    const a = makeStore(redis);
    // Marca "futura" (now=2*REPROBE); el SET escribe con expiresAt = clock(0)+REPROBE.
    a.markUnhealthy("primary", 2 * REPROBE);
    await flush();
    // Reloj más allá del PX → el GET del refresh devuelve null (clave expirada),
    // pero la marca local (2*REPROBE) es más nueva que el `now` del refresh: el
    // guard debe conservarla en vez de limpiarla (defensa ante un markUnhealthy
    // ocurrido durante el await de otro refresh).
    redis.setClock(REPROBE + 1);
    await a.refresh!(NAMES, REPROBE);
    check(
      a.isUsable("primary", REPROBE) === false,
      "carrera: refresh con null NO pisa una marca local más nueva que el refresh",
    );
  }

  done();
}

main();
