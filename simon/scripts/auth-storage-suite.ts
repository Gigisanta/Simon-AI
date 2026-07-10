/**
 * Suite ejecutable del SecondaryStorage de better-auth respaldado por Upstash
 * (src/lib/auth-secondary-storage.ts). Sin framework — tsx.
 *
 *   pnpm test auth-storage
 *
 * ALTO (rate-limiter de login/registro compartido). Testea de forma
 * determinística, mockeando `fetch`, las dos mitades del contrato:
 *
 *   1. FALLBACK IN-MEMORY puro (memGet/memSet/memIncrement/memSweep + TTLs).
 *   2. DEGRADACIÓN: cuando Upstash falla (no-200, timeout/abort, JSON malformado)
 *      cada operación cae al Map in-memory (fallo abierto: un incidente de Redis
 *      nunca tumba el login). Con Upstash sano, usa Redis y no toca memoria.
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import { upstashSecondaryStorage, __testing } from "../src/lib/auth-secondary-storage";

const { check, done } = createChecker("Auth-storage suite");

const KEY_PREFIX = "simon:ba:"; // debe coincidir con el módulo bajo test

// ---------- Mock de fetch ----------
type FetchResult =
  | { kind: "ok"; status: number; json: unknown }
  | { kind: "malformed" } // status 200 pero body no parseable
  | { kind: "abort" }; // throw (timeout/red)

let nextFetch: FetchResult = { kind: "ok", status: 200, json: [] };
let fetchCalls = 0;
const originalFetch = globalThis.fetch;

globalThis.fetch = (async () => {
  fetchCalls += 1;
  const r = nextFetch;
  if (r.kind === "abort") {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  }
  if (r.kind === "malformed") {
    return {
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError("Unexpected token in JSON");
      },
    } as unknown as Response;
  }
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    json: async () => r.json,
  } as unknown as Response;
}) as typeof fetch;

function withUpstashEnv() {
  process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
  process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
}
function clearUpstashEnv() {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

// ---------- 1. Fallback in-memory puro ----------
{
  __testing.reset();
  const { memGet, memSet, memIncrement, memSweep, memStore } = __testing;

  // set/get básico sin TTL → persiste, expiresAt null.
  memSet("k1", "v1");
  check(memGet("k1") === "v1", "memSet/memGet: guarda y recupera un valor sin TTL");
  check(memStore.get("k1")?.expiresAt === null, "memSet sin TTL: expiresAt null (no expira)");

  // set con TTL → expiresAt ≈ now + ttl*1000.
  const before = Date.now();
  memSet("k2", "v2", 30);
  const exp = memStore.get("k2")?.expiresAt ?? 0;
  check(
    exp >= before + 30_000 && exp <= Date.now() + 30_000,
    "memSet con TTL: fija expiresAt = now + ttl*1000 (segundos)",
  );

  // memIncrement crea en 1 y luego suma, CONSERVANDO el TTL original de la ventana.
  __testing.reset();
  const c1 = memIncrement("cnt", 60);
  const createdExp = memStore.get("cnt")?.expiresAt ?? 0;
  const c2 = memIncrement("cnt", 60);
  const c3 = memIncrement("cnt", 5); // TTL distinto: NO debe re-fijar la ventana
  const afterExp = memStore.get("cnt")?.expiresAt ?? 0;
  check(c1 === 1 && c2 === 2 && c3 === 3, "memIncrement: cuenta 1,2,3 sobre la misma clave");
  check(
    createdExp === afterExp && createdExp !== 0,
    "memIncrement: el TTL solo se fija al crear; hits posteriores no estiran la ventana",
  );

  // memSweep: poda solo las claves vencidas (expiresAt <= now); conserva vivas y sin TTL.
  __testing.reset();
  const now = 1_000_000_000;
  memStore.set("vencida", { value: "x", expiresAt: now - 1 });
  memStore.set("viva", { value: "y", expiresAt: now + 60_000 });
  memStore.set("eterna", { value: "z", expiresAt: null });
  memSweep(now); // reset() puso lastSweep=0 → el sweep corre (no lo saltea el intervalo)
  check(!memStore.has("vencida"), "memSweep: elimina la clave con expiresAt <= now");
  check(memStore.has("viva"), "memSweep: conserva la clave aún vigente");
  check(memStore.has("eterna"), "memSweep: conserva la clave sin TTL (expiresAt null)");

  // memGet de una clave vencida → null y la borra (expiración perezosa).
  __testing.reset();
  memStore.set("old", { value: "x", expiresAt: Date.now() - 1 });
  check(memGet("old") === null, "memGet: clave vencida devuelve null");
  check(!memStore.has("old"), "memGet: clave vencida se borra al leerla (lazy expiry)");
}

// ---------- 2. Upstash sano: usa Redis, no toca memoria ----------
async function testHealthy() {
  __testing.reset();
  withUpstashEnv();
  const s = upstashSecondaryStorage();
  check(!!s, "con env de Upstash → devuelve un storage (no undefined)");
  if (!s) return;

  // GET: Upstash responde [{result: "hola"}] → devuelve "hola", sin tocar mem.
  nextFetch = { kind: "ok", status: 200, json: [{ result: "hola" }] };
  const g = await s.get("greet");
  check(g === "hola", "get sano: devuelve el result de Upstash");
  check(!__testing.memStore.has("greet"), "get sano: no escribe en el fallback in-memory");

  // GET miss: result null/ausente → null.
  nextFetch = { kind: "ok", status: 200, json: [{ result: null }] };
  check((await s.get("missing")) === null, "get sano: result null → null");

  // increment: Upstash devuelve el contador atómico (INCR) como number.
  nextFetch = { kind: "ok", status: 200, json: [{ result: 7 }, { result: 1 }] };
  const n = await s.increment("attempts", 60);
  check(n === 7, "increment sano: devuelve el contador de Upstash (INCR atómico)");
  check(
    !__testing.memStore.has("attempts"),
    "increment sano: no usa el contador in-memory",
  );
}

// ---------- 3. Degradación: no-200 → memoria ----------
async function testDegradeNon200() {
  __testing.reset();
  withUpstashEnv();
  const s = upstashSecondaryStorage()!;

  // set con Upstash caído (500) → escribe en memoria.
  nextFetch = { kind: "ok", status: 500, json: {} };
  await s.set("sk", "sv", 60);
  check(__testing.memGet("sk") === "sv", "set con Upstash 500 → degrada y guarda en memoria");

  // get posterior también 500 → lee de memoria el valor degradado.
  nextFetch = { kind: "ok", status: 500, json: {} };
  check((await s.get("sk")) === "sv", "get con Upstash 500 → lee del fallback in-memory");

  // increment con 500 → memIncrement (cuenta local).
  nextFetch = { kind: "ok", status: 503, json: {} };
  const a = await s.increment("il", 60);
  const b = await s.increment("il", 60);
  check(a === 1 && b === 2, "increment con Upstash caído → cuenta en memoria (1,2)");
}

// ---------- 4. Degradación: timeout/abort → memoria ----------
async function testDegradeAbort() {
  __testing.reset();
  withUpstashEnv();
  const s = upstashSecondaryStorage()!;

  nextFetch = { kind: "abort" };
  await s.set("tk", "tv", 30);
  check(__testing.memGet("tk") === "tv", "set con timeout/abort → guarda en memoria");

  nextFetch = { kind: "abort" };
  const inc = await s.increment("tcnt", 30);
  check(inc === 1, "increment con timeout/abort → cuenta en memoria");
}

// ---------- 5. Degradación: JSON malformado ----------
async function testDegradeMalformed() {
  __testing.reset();
  withUpstashEnv();
  const s = upstashSecondaryStorage()!;

  // set: res.ok pero json() lanza → pipeline devuelve null → memoria.
  nextFetch = { kind: "malformed" };
  await s.set("mk", "mv", 30);
  check(__testing.memGet("mk") === "mv", "set con JSON malformado → degrada a memoria");

  // increment: status 200 pero result NO es number → cae a memIncrement.
  __testing.reset();
  nextFetch = { kind: "ok", status: 200, json: [{ result: "no-soy-numero" }] };
  const inc = await s.increment("bad", 60);
  check(inc === 1, "increment con result no-numérico → fallback a memIncrement (1)");
}

// ---------- 6. Sin env de Upstash → undefined (comportamiento actual intacto) ----------
function testNoEnv() {
  clearUpstashEnv();
  check(
    upstashSecondaryStorage() === undefined,
    "sin env de Upstash → undefined (better-auth usa memory como hoy)",
  );
}

// ---------- 7. El key usa el prefijo propio (no colisiona con la app) ----------
async function testKeyPrefix() {
  __testing.reset();
  withUpstashEnv();
  const s = upstashSecondaryStorage()!;
  let capturedBody: string | null = null;
  const prev = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    capturedBody = init.body as string;
    return { ok: true, status: 200, json: async () => [{ result: null }] } as unknown as Response;
  }) as typeof fetch;
  await s.get("mykey");
  globalThis.fetch = prev;
  check(
    !!capturedBody && (capturedBody as string).includes(`${KEY_PREFIX}mykey`),
    "las claves se prefijan con simon:ba: (aislamiento del rate-limit de la app)",
  );
}

async function main() {
  await testHealthy();
  await testDegradeNon200();
  await testDegradeAbort();
  await testDegradeMalformed();
  testNoEnv();
  await testKeyPrefix();

  // Restaura fetch y limpia env para no contaminar otros procesos.
  globalThis.fetch = originalFetch;
  clearUpstashEnv();
  void fetchCalls;

  done();
}

main();
