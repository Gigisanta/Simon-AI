/**
 * Suite ejecutable del rate limiter in-memory (sin framework — se corre con tsx).
 *
 *   pnpm rate-limit-suite
 *
 * Testea SOLO lógica pura y determinística, sin red ni Upstash:
 *   1. sweepBuckets() — cada bucket se poda con SU PROPIA ventana (H1).
 *   2. checkRateLimit() en modo in-memory — enforcement del tope por ventana.
 *
 * Camino crítico: el bug H1 hacía que el sweep disparado por el límite por
 * minuto borrara los timestamps del bucket diario → el tope de 400/día nunca se
 * alcanzaba en modo in-memory. El caso multi-ventana lo cubre explícitamente.
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
// Sin credenciales de Upstash: checkRateLimit usa la implementación in-memory.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import { checkRateLimit, sweepBuckets, type Bucket } from "../src/lib/rate-limit";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

const MINUTE = 60_000;
const DAY = 24 * 60 * 60 * 1000;

// ---------- 1. sweepBuckets: cada bucket se poda con SU ventana (H1) ----------
{
  const now = 10_000_000;
  const map = new Map<string, Bucket>();

  // Bucket "por minuto": un timestamp de hace 5s (vive) y uno de hace 5min (muere).
  map.set("chat:m:u1", {
    windowMs: MINUTE,
    timestamps: [now - 5_000, now - 5 * MINUTE],
  });
  // Bucket "diario": timestamps de hace 5min y de hace 2h — AMBOS dentro de 24h.
  // Con el bug H1 (sweep con ventana de 1min para todos) se borraban los dos.
  map.set("chat:d:u1", {
    windowMs: DAY,
    timestamps: [now - 5 * MINUTE, now - 2 * 60 * MINUTE],
  });

  sweepBuckets(map, now);

  const minute = map.get("chat:m:u1");
  const day = map.get("chat:d:u1");

  check(
    !!minute && minute.timestamps.length === 1 && minute.timestamps[0] === now - 5_000,
    "sweep: bucket por-minuto conserva solo el timestamp de <60s",
  );
  // ESTE es el bug H1: el bucket diario NO puede ser barrido por una ventana de minuto.
  check(
    !!day && day.timestamps.length === 2,
    "sweep: bucket diario conserva sus timestamps de <24h (H1 — no se corrompe)",
  );
}

// ---------- 1b. sweepBuckets: bucket que queda vacío se elimina del Map ----------
{
  const now = 20_000_000;
  const map = new Map<string, Bucket>();
  map.set("viejo", { windowMs: MINUTE, timestamps: [now - 10 * MINUTE] });
  map.set("vivo", { windowMs: MINUTE, timestamps: [now - 1_000] });

  sweepBuckets(map, now);

  check(!map.has("viejo"), "sweep: bucket totalmente vencido se borra del Map");
  check(map.has("vivo"), "sweep: bucket con timestamps vigentes se conserva");
}

// ---------- 2. checkRateLimit in-memory: enforcement del tope ----------
async function testEnforcement() {
  const key = `suite:enforce:${Math.random()}`;
  const r1 = await checkRateLimit(key, 3, MINUTE);
  const r2 = await checkRateLimit(key, 3, MINUTE);
  const r3 = await checkRateLimit(key, 3, MINUTE);
  const r4 = await checkRateLimit(key, 3, MINUTE);
  check(
    r1.ok && r2.ok && r3.ok && !r4.ok,
    "checkRateLimit: las primeras 3 pasan y la 4ª (max=3) se rechaza",
  );
  if (!r4.ok) {
    check(
      r4.retryAfterSeconds >= 1 && r4.retryAfterSeconds <= 60,
      "checkRateLimit: retry-after del rechazo está dentro de la ventana",
    );
  } else {
    failures.push("  ✗ checkRateLimit: la 4ª llamada debió rechazarse");
  }
}

// ---------- 2b. checkRateLimit: minuto y día independientes (H1, integración) ----------
async function testIndependentWindows() {
  const u = Math.random();
  const minuteKey = `suite:m:${u}`;
  const dayKey = `suite:d:${u}`;
  // El bucket diario (max alto) no debe verse afectado por golpear el de minuto.
  for (let i = 0; i < 5; i++) await checkRateLimit(minuteKey, 3, MINUTE);
  const day = await checkRateLimit(dayKey, 400, DAY);
  check(day.ok, "checkRateLimit: el bucket diario es independiente del de minuto");
}

// ---------- 3. Fail-fast de producción sin Upstash (#35) ----------
async function testProdRequiresUpstash() {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevOverride = process.env.RATE_LIMIT_ALLOW_MEMORY;
  // NODE_ENV es typed readonly; el cast permite mutarlo solo para el test.
  const env = process.env as Record<string, string | undefined>;
  try {
    // prod, sin Upstash, sin override → debe LANZAR en el primer uso.
    env.NODE_ENV = "production";
    delete env.RATE_LIMIT_ALLOW_MEMORY;
    delete env.UPSTASH_REDIS_REST_URL;
    delete env.UPSTASH_REDIS_REST_TOKEN;
    let threw = false;
    try {
      await checkRateLimit(`prod:no-upstash:${Math.random()}`, 3, MINUTE);
    } catch {
      threw = true;
    }
    check(threw, "prod sin Upstash sin override → checkRateLimit LANZA (#35)");

    // prod, con override explícito → usa memoria, no lanza.
    env.RATE_LIMIT_ALLOW_MEMORY = "1";
    const overridden = await checkRateLimit(`prod:override:${Math.random()}`, 3, MINUTE);
    check(overridden.ok, "prod con RATE_LIMIT_ALLOW_MEMORY=1 → usa memoria (ok)");

    // dev (NODE_ENV != production), sin Upstash → memoria sin lanzar.
    delete env.RATE_LIMIT_ALLOW_MEMORY;
    env.NODE_ENV = "development";
    const dev = await checkRateLimit(`dev:mem:${Math.random()}`, 3, MINUTE);
    check(dev.ok, "dev sin Upstash → usa memoria sin lanzar");
  } finally {
    if (prevNodeEnv === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = prevNodeEnv;
    if (prevOverride === undefined) delete env.RATE_LIMIT_ALLOW_MEMORY;
    else env.RATE_LIMIT_ALLOW_MEMORY = prevOverride;
  }
}

async function main() {
  await testEnforcement();
  await testIndependentWindows();
  await testProdRequiresUpstash();

  const total = passed + failures.length;
  console.log(`\nRate-limit suite: ${passed}/${total} casos OK`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
    process.exit(1);
  }
  console.log("Todos los casos pasaron.\n");
}

main();
