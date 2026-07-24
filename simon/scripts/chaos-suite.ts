/**
 * Chaos-suite: simula fallas de infraestructura del pipeline de chat (LLM caído,
 * breaker, Upstash caído, contenido vacío) y afirma que SIEMPRE se degrada de
 * forma segura — el menor nunca ve una excepción ni un texto de error crudo del
 * proveedor.
 *
 *   pnpm test chaos
 *
 * TODO con fakes/inyección — cero red, cero LLM real. Reusa los mismos seams que
 * ya prueban retry-suite.ts (isTransientError/withTransientRetry) y
 * provider-router-suite.ts (resolveProvider/health store/breaker): un `run`
 * inyectado que lanza errores representativos, sin tocar HTTP real. Los fakes
 * `apiError`/`netError` viven en suite-helpers.ts (compartidos, no duplicados).
 *
 * Escenarios (ver AGENTS.md del objetivo):
 *   1. Primario 500 / timeout / 429 / cuerpo malformado → degrada al fallback en
 *      el orden configurado, con los reintentos esperados (ni más ni menos).
 *   2. Breaker: tras agotar los reintentos del primario abre; mientras está
 *      abierto no se pega al primario; tras PROVIDER_CIRCUIT_REPROBE_MS reprueba.
 *   3. Upstash caído (fetch rechaza / 5xx / body malformado) → rate-limit cae a
 *      memoria SIN lanzar, y la degradación sigue enforceando el tope.
 *   4. Todos los proveedores caídos → resolveProvider relanza (comportamiento
 *      correcto de la primitiva), pero el pipeline NUNCA deja escapar eso al
 *      menor: generate.ts lo atrapa en el sentinel ok:false y run.ts responde
 *      SIEMPRE el mismo texto amable fijo (GENERATION_FALLBACK_REPLY, sin
 *      interpolar el error). Se verifica en runtime (resolveProvider) + por
 *      lectura de fuente (mismo patrón anti-drift que retry-suite usa para
 *      maxDuration): generate.ts y run.ts NUNCA importan Prisma/Next acá.
 *   5. Contenido vacío/en blanco del proveedor (bug real ya visto en prod: modo
 *      "thinking" quema max_tokens en reasoning_content) → mismo camino de
 *      degradación que un fallo de generación (isBlankGenerationText).
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createChecker, apiError, netError } from "./suite-helpers";
import {
  resolveProvider,
  createProviderHealthStore,
  PROVIDER_CIRCUIT_REPROBE_MS,
  type AiEnvSnapshot,
} from "../src/lib/ai/provider";
import { checkRateLimit } from "../src/lib/rate-limit";
import { isBlankGenerationText } from "../src/lib/chat-pipeline/generate";
import { GENERATION_FALLBACK_REPLY } from "../src/lib/chat-pipeline/respond";

const { check, done } = createChecker("Chaos suite");

const here = dirname(fileURLToPath(import.meta.url));
const noSleep = async () => {};

// Cuerpo malformado (JSON roto en la respuesta del proveedor): sin statusCode
// ni code de red, no matchea ningún patrón de isTransientError → NO transitorio.
function malformedBodyError(): Error {
  return Object.assign(new SyntaxError("Unexpected token o in JSON at position 0"), {
    name: "SyntaxError",
  });
}
// Timeout del AbortSignal (mismo shape que retry-suite): NO transitorio, es el
// tope de latencia por intento, no un hipo de red.
function timeoutError(): { name: string; message: string } {
  return { name: "TimeoutError", message: "timed out" };
}

const twoProviderEnv: AiEnvSnapshot = {
  AI_MODEL: "modelo-a",
  AI_FALLBACK_BASE_URL: "https://otro.example",
  AI_FALLBACK_API_KEY: "key-b",
  AI_FALLBACK_MODEL: "modelo-b",
};

// ---------- 1. Primario 500/timeout/429/malformado → degrada al fallback ----------
async function testDegradesToFallback() {
  // 500 persistente (transitorio): agota el retry del PRIMARIO (2 llamadas)
  // antes de saltar al fallback — ni más ni menos.
  {
    const calls: string[] = [];
    const out = await resolveProvider(
      "main",
      async (client) => {
        calls.push(client.config.name);
        if (client.config.name === "primary") throw apiError(500);
        return "ok-fallback";
      },
      { env: twoProviderEnv, now: 0, healthStore: createProviderHealthStore(), retry: { sleep: noSleep } },
    );
    const primaryCalls = calls.filter((c) => c === "primary").length;
    check(out === "ok-fallback", "500 persistente: el fallback responde ok");
    check(primaryCalls === 2, `500 persistente: EXACTO 2 llamadas al primario (retry agotado), no más ni menos (fueron ${primaryCalls})`);
    check(calls.at(-1) === "fallback", "500 persistente: el último intento es el fallback");
  }

  // Timeout (NO transitorio): 1 sola llamada al primario, salta directo al
  // fallback (sin retry — reintentar un timeout duplicaría el presupuesto).
  {
    const calls: string[] = [];
    const out = await resolveProvider(
      "main",
      async (client) => {
        calls.push(client.config.name);
        if (client.config.name === "primary") throw timeoutError();
        return "ok-fallback";
      },
      { env: twoProviderEnv, now: 0, healthStore: createProviderHealthStore(), retry: { sleep: noSleep } },
    );
    check(out === "ok-fallback", "timeout: el fallback responde ok");
    check(
      calls.filter((c) => c === "primary").length === 1,
      "timeout: SOLO 1 llamada al primario (sin retry, salta directo al fallback)",
    );
  }

  // 429 (NO transitorio en este clasificador — ver retry-suite): 1 sola
  // llamada, salto directo al fallback.
  {
    const calls: string[] = [];
    const out = await resolveProvider(
      "main",
      async (client) => {
        calls.push(client.config.name);
        if (client.config.name === "primary") throw apiError(429);
        return "ok-fallback";
      },
      { env: twoProviderEnv, now: 0, healthStore: createProviderHealthStore(), retry: { sleep: noSleep } },
    );
    check(out === "ok-fallback", "429: el fallback responde ok");
    check(
      calls.filter((c) => c === "primary").length === 1,
      "429: SOLO 1 llamada al primario (sin retry, salta directo al fallback)",
    );
  }

  // Cuerpo malformado (JSON roto): NO transitorio, 1 sola llamada, salto
  // directo al fallback.
  {
    const calls: string[] = [];
    const out = await resolveProvider(
      "main",
      async (client) => {
        calls.push(client.config.name);
        if (client.config.name === "primary") throw malformedBodyError();
        return "ok-fallback";
      },
      { env: twoProviderEnv, now: 0, healthStore: createProviderHealthStore(), retry: { sleep: noSleep } },
    );
    check(out === "ok-fallback", "cuerpo malformado: el fallback responde ok");
    check(
      calls.filter((c) => c === "primary").length === 1,
      "cuerpo malformado: SOLO 1 llamada al primario (sin retry, salta directo al fallback)",
    );
  }

  // Error de red transitorio (ECONNRESET) también agota el retry antes de
  // saltar — mismo patrón que el 500, con el clasificador de netError.
  {
    const calls: string[] = [];
    await resolveProvider(
      "main",
      async (client) => {
        calls.push(client.config.name);
        if (client.config.name === "primary") throw netError("ECONNRESET");
        return "ok-fallback";
      },
      { env: twoProviderEnv, now: 0, healthStore: createProviderHealthStore(), retry: { sleep: noSleep } },
    );
    check(
      calls.filter((c) => c === "primary").length === 2,
      "ECONNRESET persistente: EXACTO 2 llamadas al primario antes del fallback",
    );
  }
}

// ---------- 2. Breaker: abre tras agotar retries, saltea mientras está abierto, reprueba tras el TTL ----------
async function testCircuitBreaker() {
  const health = createProviderHealthStore();

  // t=0: el primario falla persistente (500) → agota el retry (2 llamadas) →
  // se marca no-sano → el fallback responde.
  {
    const calls: string[] = [];
    const out = await resolveProvider(
      "main",
      async (client) => {
        calls.push(client.config.name);
        if (client.config.name === "primary") throw apiError(500);
        return "ok";
      },
      { env: twoProviderEnv, now: 0, healthStore: health, retry: { sleep: noSleep } },
    );
    check(out === "ok", "breaker t=0: fallback responde ok");
    check(health.isUsable("primary", 0) === false, "breaker t=0: primario queda marcado no-sano");
  }

  // Mientras el breaker sigue abierto (varias "requests" dentro del TTL): el
  // primario se SALTEA por completo, ni se lo llama una vez.
  for (const t of [1, 1_000, PROVIDER_CIRCUIT_REPROBE_MS - 1]) {
    const calls: string[] = [];
    await resolveProvider(
      "main",
      async (client) => {
        calls.push(client.config.name);
        return "ok";
      },
      { env: twoProviderEnv, now: t, healthStore: health, retry: { sleep: noSleep } },
    );
    check(
      !calls.includes("primary"),
      `breaker abierto (t=${t}): el primario NO se llama (salteado por el circuit-breaker)`,
    );
    check(calls[0] === "fallback", `breaker abierto (t=${t}): va directo al fallback`);
  }

  // Justo en el TTL: reprueba — el primario vuelve a la lista y se intenta primero.
  {
    const calls: string[] = [];
    await resolveProvider(
      "main",
      async (client) => {
        calls.push(client.config.name);
        return "ok-reprobado";
      },
      {
        env: twoProviderEnv,
        now: PROVIDER_CIRCUIT_REPROBE_MS,
        healthStore: health,
        retry: { sleep: noSleep },
      },
    );
    check(calls[0] === "primary", "breaker: tras el TTL, reprueba el primario (se intenta primero)");
    check(health.isUsable("primary", PROVIDER_CIRCUIT_REPROBE_MS) === true, "breaker: primario vuelve a sano tras responder ok");
  }
}

// ---------- 3. Upstash caído → rate-limit cae a memoria SIN lanzar ----------
async function testUpstashDownFallsBackToMemory() {
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL;
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const prevFetch = globalThis.fetch;
  const env = process.env as Record<string, string | undefined>;

  try {
    env.UPSTASH_REDIS_REST_URL = "https://fake-upstash.example";
    env.UPSTASH_REDIS_REST_TOKEN = "fake-token";

    // 3a. fetch rechaza (red caída / timeout): degrada a memoria sin lanzar.
    {
      globalThis.fetch = (async () => {
        throw new Error("network down");
      }) as typeof fetch;
      let threw = false;
      let result: Awaited<ReturnType<typeof checkRateLimit>> | undefined;
      try {
        result = await checkRateLimit(`chaos:upstash-reject:${Math.random()}`, 3, 60_000);
      } catch {
        threw = true;
      }
      check(!threw, "Upstash caído (fetch rechaza): checkRateLimit NUNCA lanza");
      check(!!result?.ok, "Upstash caído (fetch rechaza): degrada a memoria, primer hit ok");
    }

    // 3b. fetch responde 5xx: degrada a memoria sin lanzar.
    {
      globalThis.fetch = (async () => new Response("boom", { status: 500 })) as typeof fetch;
      let threw = false;
      try {
        await checkRateLimit(`chaos:upstash-5xx:${Math.random()}`, 3, 60_000);
      } catch {
        threw = true;
      }
      check(!threw, "Upstash caído (fetch responde 500): checkRateLimit NUNCA lanza");
    }

    // 3c. fetch responde 200 con body malformado (count no-numérico): degrada.
    {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify([{ result: "no-es-un-numero" }, {}, {}]), {
          status: 200,
        })) as typeof fetch;
      let threw = false;
      try {
        await checkRateLimit(`chaos:upstash-malformed:${Math.random()}`, 3, 60_000);
      } catch {
        threw = true;
      }
      check(!threw, "Upstash caído (body malformado): checkRateLimit NUNCA lanza");
    }

    // 3d. La degradación a memoria SIGUE enforceando el tope (no es un bypass
    //     total: el fallback in-memory acota por instancia mientras dura el
    //     incidente).
    {
      globalThis.fetch = (async () => {
        throw new Error("network down");
      }) as typeof fetch;
      const key = `chaos:upstash-enforce:${Math.random()}`;
      const r1 = await checkRateLimit(key, 2, 60_000);
      const r2 = await checkRateLimit(key, 2, 60_000);
      const r3 = await checkRateLimit(key, 2, 60_000);
      check(
        r1.ok && r2.ok && !r3.ok,
        "Upstash caído: el fallback in-memory SIGUE enforceando el tope (max=2, la 3ª se rechaza)",
      );
    }
  } finally {
    globalThis.fetch = prevFetch;
    if (prevUrl === undefined) delete env.UPSTASH_REDIS_REST_URL;
    else env.UPSTASH_REDIS_REST_URL = prevUrl;
    if (prevToken === undefined) delete env.UPSTASH_REDIS_REST_TOKEN;
    else env.UPSTASH_REDIS_REST_TOKEN = prevToken;
  }
}

// ---------- 4. Todos los proveedores caídos → NUNCA propaga al menor ----------
async function testAllProvidersDownNeverLeaksToUser() {
  // Nivel resolveProvider (primitiva): con TODOS los proveedores fallando,
  // incluso con mensajes que "parecen" filtrar detalle interno, la primitiva
  // relanza el ÚLTIMO error tal cual (no lo transforma en texto ni lo
  // silencia) — es responsabilidad del CALLER (generate.ts) no mostrarlo.
  {
    const sensitiveErr = Object.assign(
      new Error("upstream 500: apiKey=sk-proj-XXXXX baseURL=https://internal.example"),
      { name: "APICallError", statusCode: 500 },
    );
    const health = createProviderHealthStore();
    let caught: unknown;
    try {
      await resolveProvider(
        "main",
        async () => {
          throw sensitiveErr;
        },
        { env: twoProviderEnv, now: 0, healthStore: health, retry: { retries: 0, sleep: noSleep } },
      );
    } catch (err) {
      caught = err;
    }
    check(caught === sensitiveErr, "todos caídos: resolveProvider relanza el error tal cual (no lo silencia ni lo reformula)");
    check(health.isUsable("primary", 0) === false && health.isUsable("fallback", 0) === false, "todos caídos: ambos proveedores quedan no-sanos");
  }

  // Nivel pipeline (estructural, sin importar run.ts/generate.ts con sus
  // dependencias de Next/Prisma — mismo patrón anti-drift que retry-suite usa
  // para maxDuration): el catch de generate.ts NUNCA debe interpolar el error
  // atrapado en el sentinel que devuelve.
  {
    const genPath = join(here, "..", "src", "lib", "chat-pipeline", "generate.ts");
    const genSrc = readFileSync(genPath, "utf8");
    const catchBlock = genSrc.slice(genSrc.indexOf("} catch (err) {"));
    check(
      /return\s*\{\s*ok:\s*false\s*\}\s*;/.test(catchBlock),
      "generate.ts: el catch devuelve el sentinel { ok: false } sin datos del error",
    );
    check(
      !/return\s*\{[^}]*err[^}]*\}/.test(catchBlock),
      "generate.ts: el objeto devuelto en el catch NUNCA referencia `err` (no hay forma de que se filtre al usuario)",
    );

    // run.ts: la rama fallback-error usa el texto FIJO GENERATION_FALLBACK_REPLY,
    // no algo construido a partir de `generated`/el error.
    const runPath = join(here, "..", "src", "lib", "chat-pipeline", "run.ts");
    const runSrc = readFileSync(runPath, "utf8");
    check(
      /if \(!generated\.ok\) \{[\s\S]{0,400}?const reply = GENERATION_FALLBACK_REPLY;/.test(runSrc),
      "run.ts: la rama de fallo de generación usa el texto amable fijo GENERATION_FALLBACK_REPLY (no interpola el error)",
    );

    // respond.ts: el mensaje amable es un literal fijo, nunca un template
    // interpolado (así JAMÁS puede terminar conteniendo texto del error).
    const respondPath = join(here, "..", "src", "lib", "chat-pipeline", "respond.ts");
    const respondSrc = readFileSync(respondPath, "utf8");
    const constMatch = respondSrc.match(
      /export const GENERATION_FALLBACK_REPLY =\s*\n?\s*"([^"]*)"/,
    );
    check(constMatch !== null, "respond.ts: se encuentra el literal GENERATION_FALLBACK_REPLY");
    check(
      typeof GENERATION_FALLBACK_REPLY === "string" && GENERATION_FALLBACK_REPLY.length > 0,
      "GENERATION_FALLBACK_REPLY: es un string no vacío (mensaje amable configurado)",
    );
    check(
      !GENERATION_FALLBACK_REPLY.includes("${"),
      "GENERATION_FALLBACK_REPLY: no tiene marcas de interpolación (es un texto fijo, no puede filtrar nada dinámico)",
    );
  }
}

// ---------- 5. Contenido vacío/null del proveedor → degradación segura ----------
function testBlankGenerationDegradesSafely() {
  check(isBlankGenerationText("") === true, "isBlankGenerationText: string vacío → blanco");
  check(isBlankGenerationText("   \n\t  ") === true, "isBlankGenerationText: solo whitespace → blanco");
  check(isBlankGenerationText(null) === true, "isBlankGenerationText: null → blanco (proveedor no conforme)");
  check(isBlankGenerationText(undefined) === true, "isBlankGenerationText: undefined → blanco");
  check(isBlankGenerationText("hola") === false, "isBlankGenerationText: texto real → NO blanco");
  check(isBlankGenerationText(" hola ") === false, "isBlankGenerationText: texto real con espacios → NO blanco");

  // Anti-drift: el guard debe estar REALMENTE conectado en generate.ts, no solo
  // definido y sin usar (mismo patrón de lectura de fuente que retry-suite usa
  // para maxDuration).
  const genPath = join(here, "..", "src", "lib", "chat-pipeline", "generate.ts");
  const genSrc = readFileSync(genPath, "utf8");
  const guardIdx = genSrc.indexOf("isBlankGenerationText(g.text)");
  check(guardIdx !== -1, "generate.ts: isBlankGenerationText(g.text) se invoca sobre el resultado real del proveedor");
  if (guardIdx !== -1) {
    const after = genSrc.slice(guardIdx, guardIdx + 200);
    check(
      /return\s*\{\s*ok:\s*false\s*\}/.test(after),
      "generate.ts: contenido en blanco → devuelve { ok: false } (mismo camino que un fallo de generación)",
    );
  }
}

async function main() {
  await testDegradesToFallback();
  await testCircuitBreaker();
  await testUpstashDownFallsBackToMemory();
  await testAllProvidersDownNeverLeaksToUser();
  testBlankGenerationDegradesSafely();
  done();
}

main();
