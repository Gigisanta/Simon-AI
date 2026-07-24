/**
 * Suite del reintento transitorio (lib/ai/retry.ts) — #36.
 *
 *   pnpm retry-suite
 *
 * Testea SOLO lógica pura (sin red, sin timers reales — el sleep se inyecta):
 *   1. isTransientError sobre shapes representativos del SDK `ai` y del fetch de
 *      Node (APICallError con statusCode, errores de red con code, cadena cause).
 *   2. withTransientRetry: éxito directo, transitorio→retry→éxito,
 *      transitorio→retry→falla→lanza, no-transitorio→sin retry, abort→sin retry.
 *   3. Anti-drift del presupuesto de latencia: el literal `maxDuration` inline de
 *      src/app/api/chat/route.ts (leído por regex, sin importar la ruta) coincide
 *      con CHAT_ROUTE_MAX_DURATION_S (lib/ai/limits.ts, fuente única).
 *
 * Camino crítico (no perder una respuesta al menor por un hipo de red, sin
 * reintentar lo que no corresponde ni reventar el presupuesto de latencia). Sale
 * con código 1 si algún caso falla (gate de CI).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createChecker, apiError, netError } from "./suite-helpers";
import { isTransientError, withTransientRetry } from "../src/lib/ai/retry";
import { CHAT_ROUTE_MAX_DURATION_S } from "../src/lib/ai/limits";

const { check, done } = createChecker("Retry suite");

// ---------- 1. isTransientError ----------
{
  // 5xx del SDK → transitorio.
  for (const s of [500, 502, 503, 504, 599]) {
    check(isTransientError(apiError(s)) === true, `statusCode ${s} → transitorio`);
  }
  // 4xx → NO transitorio (request/credenciales/cuota).
  for (const s of [400, 401, 403, 404, 422, 429]) {
    check(isTransientError(apiError(s)) === false, `statusCode ${s} → NO transitorio`);
  }

  // Errores de red por code → transitorio.
  for (const c of ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED", "EPIPE"]) {
    check(isTransientError(netError(c)) === true, `code ${c} → transitorio`);
  }

  // TypeError: fetch failed (undici) con cause de red → transitorio (cadena cause).
  const fetchFailed = Object.assign(new TypeError("fetch failed"), {
    name: "TypeError",
    cause: netError("ECONNRESET"),
  });
  check(isTransientError(fetchFailed) === true, "TypeError fetch failed (cause ECONNRESET) → transitorio");
  check(
    isTransientError(new TypeError("fetch failed")) === true,
    "TypeError fetch failed sin cause → transitorio (por mensaje)",
  );

  // Abort / timeout del AbortSignal → NO transitorio (es el tope de latencia).
  check(isTransientError({ name: "AbortError", message: "aborted" }) === false, "AbortError → NO transitorio");
  check(isTransientError({ name: "TimeoutError", message: "timed out" }) === false, "TimeoutError → NO transitorio");
  // El abort GANA sobre un cause transitorio (no se reintenta un timeout).
  check(
    isTransientError({ name: "TimeoutError", cause: netError("ECONNRESET") }) === false,
    "TimeoutError con cause de red → NO transitorio (abort gana)",
  );

  // status 4xx GANA sobre un mensaje que parezca de red (dentro del mismo error).
  check(
    isTransientError(apiError(400, "fetch failed")) === false,
    "4xx con mensaje 'fetch failed' → NO transitorio (status decide)",
  );

  // Errores de contenido/parseo y valores no-error → NO transitorio.
  check(isTransientError(new Error("invalid JSON from model")) === false, "error de contenido → NO transitorio");
  check(isTransientError(null) === false, "null → NO transitorio");
  check(isTransientError(undefined) === false, "undefined → NO transitorio");
  check(isTransientError("boom") === false, "string → NO transitorio");

  // Status en la cadena cause (error envuelto por el SDK).
  check(
    isTransientError(Object.assign(new Error("wrapped"), { cause: apiError(503) })) === true,
    "cause con statusCode 503 → transitorio",
  );
}

// ---------- 2. withTransientRetry ----------
async function testRetry() {
  const noSleep = async () => {};

  // Éxito directo → 1 llamada, 0 sleeps.
  {
    let calls = 0;
    let sleeps = 0;
    const out = await withTransientRetry(
      async () => {
        calls += 1;
        return "ok";
      },
      { sleep: async () => { sleeps += 1; } },
    );
    check(out === "ok" && calls === 1 && sleeps === 0, "éxito directo: 1 llamada, sin retry");
  }

  // Transitorio → retry → éxito. 2 llamadas, 1 sleep.
  {
    let calls = 0;
    let sleeps = 0;
    const out = await withTransientRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw apiError(502);
        return "ok2";
      },
      { sleep: async () => { sleeps += 1; } },
    );
    check(out === "ok2" && calls === 2 && sleeps === 1, "transitorio→retry→éxito: 2 llamadas, 1 sleep");
  }

  // Transitorio persistente → agota retries (1) → lanza el último error. 2 llamadas.
  {
    let calls = 0;
    let threw = false;
    try {
      await withTransientRetry(
        async () => {
          calls += 1;
          throw apiError(503);
        },
        { sleep: noSleep },
      );
    } catch {
      threw = true;
    }
    check(threw && calls === 2, "transitorio persistente: 2 llamadas y lanza");
  }

  // No-transitorio (4xx) → sin retry, lanza en la 1ra. 1 llamada.
  {
    let calls = 0;
    let threw = false;
    try {
      await withTransientRetry(
        async () => {
          calls += 1;
          throw apiError(400);
        },
        { sleep: noSleep },
      );
    } catch {
      threw = true;
    }
    check(threw && calls === 1, "no-transitorio (4xx): 1 llamada, sin retry");
  }

  // Abort → sin retry, lanza en la 1ra. 1 llamada.
  {
    let calls = 0;
    let threw = false;
    try {
      await withTransientRetry(
        async () => {
          calls += 1;
          throw { name: "TimeoutError", message: "timed out" };
        },
        { sleep: noSleep },
      );
    } catch {
      threw = true;
    }
    check(threw && calls === 1, "abort/timeout: 1 llamada, sin retry");
  }

  // retries configurable (2) → transitorio 3 veces = 3 llamadas.
  {
    let calls = 0;
    let threw = false;
    try {
      await withTransientRetry(
        async () => {
          calls += 1;
          throw netError("ECONNRESET");
        },
        { retries: 2, sleep: noSleep },
      );
    } catch {
      threw = true;
    }
    check(threw && calls === 3, "retries=2: 3 llamadas y lanza");
  }

  // onRetry se invoca por cada reintento con el número de intento.
  {
    const attempts: number[] = [];
    let calls = 0;
    await withTransientRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw apiError(500);
        return "ok";
      },
      { sleep: noSleep, onRetry: (_e, a) => attempts.push(a) },
    );
    check(attempts.length === 1 && attempts[0] === 1, "onRetry: se llama 1 vez con attempt=1");
  }
}

// ---------- 3. Anti-drift: maxDuration de la ruta vs CHAT_ROUTE_MAX_DURATION_S ----------
// La ruta declara `export const maxDuration` inline (Next exige literal estático,
// no una referencia importada) y valida en import que coincida con la fuente única
// (lib/ai/limits.ts) — pero ese throw SOLO corre al importar la ruta EN PRODUCCIÓN,
// y ningún test importa route.ts (arrastra Prisma/env). Una desincronización recién
// explotaría como 500 total en /api/chat. Acá lo verificamos leyendo el texto de la
// ruta con regex (sin importarla) y comparándolo con la constante importada.
function testMaxDurationSync() {
  const here = dirname(fileURLToPath(import.meta.url));
  const routePath = join(here, "..", "src", "app", "api", "chat", "route.ts");
  const src = readFileSync(routePath, "utf8");
  // Tolera anotación de tipo opcional (: number) y espaciado variable alrededor
  // del `=`, los dos puntos y el punto y coma.
  const match = src.match(
    /export\s+const\s+maxDuration\s*(?::\s*[A-Za-z0-9_]+\s*)?=\s*(\d+)\s*;/,
  );
  check(
    match !== null,
    "route.ts: se encuentra el literal `export const maxDuration`",
  );
  if (match === null) return;
  const literal = Number(match[1]);
  check(
    literal === CHAT_ROUTE_MAX_DURATION_S,
    `route.ts: maxDuration (${literal}) coincide con CHAT_ROUTE_MAX_DURATION_S (${CHAT_ROUTE_MAX_DURATION_S}) — si falla, sincronizá el literal inline de la ruta con lib/ai/limits.ts`,
  );
}

async function main() {
  await testRetry();
  testMaxDurationSync();
  done();
}

main();
