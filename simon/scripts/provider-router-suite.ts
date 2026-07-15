/**
 * Suite del router de proveedores IA (lib/ai/provider.ts) — ADR-3.
 *
 *   pnpm provider-router-suite
 *
 * Testea SOLO lógica pura + comportamiento con dependencias inyectadas (sin
 * red, sin timers reales, sin tocar process.env):
 *   1. parseProviderList: AI_PROVIDERS (JSON) vs pares AI_* / AI_FALLBACK_*,
 *      defaults idénticos a chatModel()/smallModel() de hoy, parseo defensivo.
 *   2. providerUsable: TTL de reprobe del circuit-breaker (mismo shape que
 *      openAiKeyUsable de moderation.ts).
 *   3. resolveProvider: éxito directo, retry transitorio, fallback ordenado
 *      entre proveedores, circuit-breaker salteando un proveedor no-sano y
 *      reprobándolo tras el TTL, y "todos no-sanos" no bloquea el intento.
 *
 * Camino crítico: con la env de hoy (un solo proveedor) el comportamiento
 * debe ser observacionalmente idéntico — parseProviderList() con esa env da
 * una lista de 1 elemento. Sale con código 1 si algún caso falla (gate CI).
 */
import { createChecker } from "./suite-helpers";
import {
  parseProviderList,
  providerUsable,
  createProviderHealthStore,
  resolveProvider,
  PROVIDER_CIRCUIT_REPROBE_MS,
  type AiEnvSnapshot,
} from "../src/lib/ai/provider";

const { check, done } = createChecker("Provider-router suite");

// Simula el shape de APICallError del SDK `ai` (mismo helper que retry-suite).
function apiError(statusCode: number, message = "API error"): Error {
  return Object.assign(new Error(message), { name: "APICallError", statusCode });
}

// ---------- 1. parseProviderList ----------
{
  // Env vacía → defaults, un solo proveedor "primary" (comportamiento de hoy).
  {
    const list = parseProviderList({});
    check(list.length === 1, "env vacía: un solo proveedor");
    check(list[0]?.name === "primary", "env vacía: nombre 'primary'");
    check(list[0]?.baseURL === "https://api.deepseek.com", "env vacía: baseURL default");
    check(list[0]?.model === "deepseek-v4-flash", "env vacía: model default");
    check(list[0]?.smallModel === "deepseek-v4-flash", "env vacía: smallModel cae a default");
  }

  // Env "de hoy" (AI_BASE_URL/AI_API_KEY/AI_MODEL/AI_SMALL_MODEL/AI_EXTRA_BODY,
  // sin AI_FALLBACK_*) → sigue siendo un solo proveedor (regla del ADR).
  {
    const env: AiEnvSnapshot = {
      AI_BASE_URL: "https://opencode.ai/zen/go/v1",
      AI_API_KEY: "key-real",
      AI_MODEL: "deepseek-v4-flash",
      AI_SMALL_MODEL: "deepseek-v4-flash",
      AI_EXTRA_BODY: '{"thinking":{"type":"disabled"}}',
    };
    const list = parseProviderList(env);
    check(list.length === 1, "env actual (sin fallback): un solo proveedor");
    check(list[0]?.baseURL === "https://opencode.ai/zen/go/v1", "env actual: baseURL de env");
    check(list[0]?.apiKey === "key-real", "env actual: apiKey de env");
    check(
      list[0]?.extraBody?.thinking !== undefined,
      "env actual: AI_EXTRA_BODY parseado en el proveedor primario",
    );
  }

  // smallModel: sin AI_SMALL_MODEL cae a AI_MODEL (mismo default que smallModel() hoy).
  {
    const list = parseProviderList({ AI_MODEL: "modelo-grande" });
    check(list[0]?.smallModel === "modelo-grande", "smallModel sin AI_SMALL_MODEL cae a AI_MODEL");
  }

  // AI_FALLBACK_* presente → segundo proveedor, orden primary→fallback.
  {
    const env: AiEnvSnapshot = {
      AI_MODEL: "modelo-a",
      AI_FALLBACK_BASE_URL: "https://otro-proveedor.example",
      AI_FALLBACK_API_KEY: "key-b",
      AI_FALLBACK_MODEL: "modelo-b",
    };
    const list = parseProviderList(env);
    check(list.length === 2, "con AI_FALLBACK_*: dos proveedores");
    check(list[0]?.name === "primary" && list[1]?.name === "fallback", "orden primary→fallback");
    check(list[1]?.baseURL === "https://otro-proveedor.example", "fallback: baseURL propia");
    check(list[1]?.model === "modelo-b", "fallback: model propio");
  }

  // AI_PROVIDERS (JSON) válido gana sobre los pares.
  {
    const env: AiEnvSnapshot = {
      AI_MODEL: "deberia-ser-ignorado",
      AI_PROVIDERS: JSON.stringify([
        { name: "uno", baseURL: "https://p1.example", apiKey: "k1", model: "m1" },
        { name: "dos", baseURL: "https://p2.example", apiKey: "k2", model: "m2", smallModel: "m2-mini" },
      ]),
    };
    const list = parseProviderList(env);
    check(list.length === 2, "AI_PROVIDERS válido: gana sobre los pares (2 proveedores)");
    check(list[0]?.name === "uno" && list[1]?.name === "dos", "AI_PROVIDERS: preserva el orden");
    check(list[1]?.smallModel === "m2-mini", "AI_PROVIDERS: respeta smallModel explícito");
  }

  // AI_PROVIDERS inválido (JSON roto) → cae a los pares, no revienta.
  {
    const list = parseProviderList({ AI_PROVIDERS: "{no es json", AI_MODEL: "fallback-model" });
    check(list.length === 1 && list[0]?.model === "fallback-model", "AI_PROVIDERS JSON roto: cae a los pares");
  }

  // AI_PROVIDERS vacío o sin forma de proveedor → cae a los pares.
  {
    const listEmpty = parseProviderList({ AI_PROVIDERS: "[]", AI_MODEL: "x" });
    check(listEmpty.length === 1, "AI_PROVIDERS array vacío: cae a los pares");

    const listBad = parseProviderList({ AI_PROVIDERS: '[{"model":"sin-baseurl-ni-key"}]', AI_MODEL: "x" });
    check(listBad.length === 1, "AI_PROVIDERS con elemento inválido: cae a los pares");
  }

  // AI_EXTRA_BODY roto no revienta el parseo del proveedor primario.
  {
    const list = parseProviderList({ AI_EXTRA_BODY: "{roto" });
    check(list.length === 1 && list[0]?.extraBody === null, "AI_EXTRA_BODY roto: extraBody null, no revienta");
  }
}

// ---------- 2. providerUsable (TTL del circuit-breaker) ----------
{
  check(providerUsable(null, 1_000) === true, "nunca marcado no-sano → usable");
  check(providerUsable(1_000, 1_000) === false, "recién marcado, mismo instante → todavía no-sano");
  check(
    providerUsable(1_000, 1_000 + PROVIDER_CIRCUIT_REPROBE_MS - 1) === false,
    "1ms antes del TTL → todavía no-sano",
  );
  check(
    providerUsable(1_000, 1_000 + PROVIDER_CIRCUIT_REPROBE_MS) === true,
    "justo en el TTL → usable de nuevo (reprobe)",
  );
  check(
    providerUsable(1_000, 1_000 + PROVIDER_CIRCUIT_REPROBE_MS + 1) === true,
    "después del TTL → usable",
  );
  // reprobeMs custom (inyectable).
  check(providerUsable(1_000, 1_500, 1_000) === false, "TTL custom: todavía dentro de la ventana");
  check(providerUsable(1_000, 2_000, 1_000) === true, "TTL custom: reprobe al llegar al TTL");
}

// ---------- 3. resolveProvider (fallback + retry + circuit-breaker) ----------
async function testResolveProvider() {
  const noSleep = async () => {};
  const singleEnv: AiEnvSnapshot = { AI_MODEL: "modelo-unico" };
  const twoProviderEnv: AiEnvSnapshot = {
    AI_MODEL: "modelo-a",
    AI_FALLBACK_BASE_URL: "https://otro.example",
    AI_FALLBACK_API_KEY: "key-b",
    AI_FALLBACK_MODEL: "modelo-b",
  };

  // Éxito directo con un solo proveedor configurado → 1 llamada.
  {
    let calls = 0;
    const out = await resolveProvider(
      "main",
      async () => {
        calls += 1;
        return "ok";
      },
      { env: singleEnv, now: 0, healthStore: createProviderHealthStore(), retry: { sleep: noSleep } },
    );
    check(out === "ok" && calls === 1, "un proveedor, éxito directo: 1 llamada");
  }

  // Retry transitorio dentro del MISMO proveedor (vía withTransientRetry) antes de dar por fallido.
  {
    let calls = 0;
    const out = await resolveProvider(
      "main",
      async () => {
        calls += 1;
        if (calls === 1) throw apiError(502);
        return "ok-retry";
      },
      { env: singleEnv, now: 0, healthStore: createProviderHealthStore(), retry: { sleep: noSleep } },
    );
    check(out === "ok-retry" && calls === 2, "transitorio: reintenta el MISMO proveedor antes de fallback");
  }

  // Fallback ordenado: primary falla (no-transitorio) → prueba fallback → éxito.
  {
    const seen: string[] = [];
    const health = createProviderHealthStore();
    const out = await resolveProvider(
      "main",
      async (client) => {
        seen.push(client.config.name);
        if (client.config.name === "primary") throw apiError(401); // no-transitorio, sin retry
        return "ok-fallback";
      },
      { env: twoProviderEnv, now: 1_000, healthStore: health, retry: { sleep: noSleep } },
    );
    check(out === "ok-fallback", "primary falla → fallback responde ok");
    check(seen[0] === "primary" && seen[1] === "fallback", "orden probado: primary antes que fallback");
    check(health.isUsable("primary", 1_000) === false, "primary queda marcado no-sano tras fallar");
    check(health.isUsable("fallback", 1_000) === true, "fallback queda sano tras responder ok");
  }

  // Todos los proveedores fallan → relanza el ÚLTIMO error.
  {
    const health = createProviderHealthStore();
    let threw: unknown;
    try {
      await resolveProvider(
        "main",
        async (client) => {
          throw apiError(500, `boom-${client.config.name}`);
        },
        { env: twoProviderEnv, now: 2_000, healthStore: health, retry: { retries: 0, sleep: noSleep } },
      );
    } catch (err) {
      threw = err;
    }
    check(threw instanceof Error && threw.message === "boom-fallback", "todos fallan: relanza el error del ÚLTIMO proveedor probado");
    check(health.isUsable("primary", 2_000) === false, "todos fallan: primary no-sano");
    check(health.isUsable("fallback", 2_000) === false, "todos fallan: fallback no-sano");
  }

  // Circuit-breaker: proveedor marcado no-sano recientemente se SALTEA (no se llama).
  {
    const health = createProviderHealthStore();
    health.markUnhealthy("primary", 1_000);
    const seen: string[] = [];
    const out = await resolveProvider(
      "main",
      async (client) => {
        seen.push(client.config.name);
        return "ok-directo-a-fallback";
      },
      { env: twoProviderEnv, now: 1_000 + 1, healthStore: health, retry: { sleep: noSleep } },
    );
    check(out === "ok-directo-a-fallback", "circuit-breaker: responde ok saltando el proveedor no-sano");
    check(seen.length === 1 && seen[0] === "fallback", "circuit-breaker: NO llama al proveedor marcado no-sano (salteado)");
  }

  // Circuit-breaker: tras el TTL, el proveedor no-sano se reprueba (vuelve a la lista).
  {
    const health = createProviderHealthStore();
    health.markUnhealthy("primary", 1_000);
    const seen: string[] = [];
    await resolveProvider(
      "main",
      async (client) => {
        seen.push(client.config.name);
        return "ok";
      },
      {
        env: twoProviderEnv,
        now: 1_000 + PROVIDER_CIRCUIT_REPROBE_MS,
        healthStore: health,
        retry: { sleep: noSleep },
      },
    );
    check(seen[0] === "primary", "circuit-breaker: tras el TTL, reprueba el proveedor (vuelve a intentarse primero)");
  }

  // Todos no-sanos → NO bloquea: igual intenta (mejor 1 intento que corte total).
  {
    const health = createProviderHealthStore();
    health.markUnhealthy("primary", 1_000);
    health.markUnhealthy("fallback", 1_000);
    const seen: string[] = [];
    const out = await resolveProvider(
      "main",
      async (client) => {
        seen.push(client.config.name);
        return "ok-pese-a-todos-no-sanos";
      },
      { env: twoProviderEnv, now: 1_000 + 1, healthStore: health, retry: { sleep: noSleep } },
    );
    check(out === "ok-pese-a-todos-no-sanos", "todos no-sanos: igual intenta (no bloquea de por vida)");
    check(seen[0] === "primary", "todos no-sanos: respeta el orden original al reintentar");
  }

  // tier "small" resuelve el modelo correcto por proveedor.
  {
    const models: string[] = [];
    await resolveProvider(
      "small",
      async (client) => {
        models.push(client.modelId);
        return "ok";
      },
      {
        env: { AI_MODEL: "grande", AI_SMALL_MODEL: "chico" },
        now: 0,
        healthStore: createProviderHealthStore(),
        retry: { sleep: noSleep },
      },
    );
    check(models[0] === "chico", "tier 'small' usa smallModel, no model");
  }

  // Sin proveedores configurados (AI_PROVIDERS vacío fuerza pares con env vacía
  // igual da 1 proveedor por diseño) — se cubre la rama defensiva llamando con
  // una lista vacía simulada vía AI_PROVIDERS inválido + pares también vacíos
  // no es alcanzable con la env real (siempre hay 'primary'); se documenta que
  // el guard `providers.length === 0` es defensivo y no alcanzable hoy.
}

async function main() {
  await testResolveProvider();
  done();
}

main();
