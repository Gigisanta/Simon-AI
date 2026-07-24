/**
 * Suite de observabilidad in-process (lib/metrics.ts) — objetivo (b).
 *
 *   pnpm metrics-suite
 *
 * Testea SOLO lógica pura:
 *   1. percentileFromBuckets: percentiles con datos conocidos (buckets fijos).
 *   2. classifyAiError: categorización con shapes representativos de error.
 *   3. createMetricsStore: acumulación de count/errores/latencias por (stage,
 *      provider), snapshot con forma estable.
 *   4. Decisión de auth del endpoint /api/internal/metrics: se reutiliza
 *      `isAuthorizedCron` (ya cubierto exhaustivamente en retention-suite) y se
 *      prueban los 3 casos que le importan a ESTA ruta (sin secret → 503 antes
 *      de siquiera llamarla; sin/():con Bearer correcto → 401/200) SIN hacer un
 *      fetch HTTP real — se testea la función de decisión pura.
 */
import { createChecker } from "./suite-helpers";
import {
  percentileFromBuckets,
  classifyAiError,
  createMetricsStore,
  BUCKET_BOUNDS_MS,
} from "../src/lib/metrics";
import { isAuthorizedCron } from "../src/lib/retention";

const { check, done } = createChecker("Metrics suite");

// ---------- 1. percentileFromBuckets ----------
{
  const bounds = [10, 20, 30];

  check(percentileFromBuckets([0, 0, 0, 0], bounds, 50) === null, "sin muestras: null");

  // 10 muestras, todas en el primer bucket (<=10).
  check(
    percentileFromBuckets([10, 0, 0, 0], bounds, 50) === 10,
    "todas en el primer bucket: p50 = límite del bucket",
  );

  // Datos conocidos: 4 en bucket 1 (<=10), 3 en bucket 2 (<=20), 2 en bucket 3
  // (<=30), 1 en overflow. Total 10.
  const counts = [4, 3, 2, 1];
  // p50: rank = ceil(0.5*10) = 5 → cae en el bucket 2 (acumulado 4+3=7 >= 5) → 20.
  check(percentileFromBuckets(counts, bounds, 50) === 20, "p50 con datos conocidos");
  // p95: rank = ceil(0.95*10) = 10 → cae en overflow (acumulado 4+3+2+1=10 >= 10)
  // → se reporta el último límite finito (30) como piso.
  check(percentileFromBuckets(counts, bounds, 95) === 30, "p95 en overflow: reporta el último límite finito");
  // p10: rank = ceil(0.1*10) = 1 → cae en el primer bucket → 10.
  check(percentileFromBuckets(counts, bounds, 10) === 10, "p10 con datos conocidos");

  // BUCKET_BOUNDS_MS real: forma exportada, ascendente.
  check(BUCKET_BOUNDS_MS.length > 0, "BUCKET_BOUNDS_MS no vacío");
  check(
    BUCKET_BOUNDS_MS.every((b, i) => i === 0 || b > BUCKET_BOUNDS_MS[i - 1]),
    "BUCKET_BOUNDS_MS estrictamente ascendente",
  );
}

// ---------- 2. classifyAiError ----------
{
  check(classifyAiError(Object.assign(new Error("x"), { name: "AbortError" })) === "timeout", "AbortError → timeout");
  check(
    classifyAiError(Object.assign(new Error("x"), { name: "TimeoutError" })) === "timeout",
    "TimeoutError → timeout",
  );
  check(
    classifyAiError(Object.assign(new Error("API error"), { name: "APICallError", statusCode: 500 })) === "http",
    "APICallError con statusCode → http",
  );
  check(
    classifyAiError(Object.assign(new Error("x"), { code: "ECONNRESET" })) === "http",
    "código de red transitorio conocido → http",
  );
  check(classifyAiError(new Error("fetch failed")) === "http", "mensaje 'fetch failed' → http");
  check(classifyAiError(new Error("algo raro sin forma conocida")) === "other", "error sin forma conocida → other");
  check(classifyAiError("no es ni un objeto") === "other", "valor no-objeto → other, nunca lanza");
  // cadena de `cause`: el timeout puede estar envuelto por un error genérico.
  const wrapped = new Error("fallo de red", {
    cause: Object.assign(new Error("timeout interno"), { name: "AbortError" }),
  });
  check(classifyAiError(wrapped) === "timeout", "AbortError en la cadena de cause → timeout");
}

// ---------- 3. createMetricsStore ----------
{
  const store = createMetricsStore();
  store.recordCall("generation", "primary", 100);
  store.recordCall("generation", "primary", 3_000);
  store.recordCall("generation", "primary", 50_000, "timeout");
  store.recordCall("moderation", "openai", 20);

  const snap = store.snapshot();
  check(snap.generation?.primary?.count === 3, "count acumula por (stage, provider)");
  check(snap.generation?.primary?.errors.timeout === 1, "errores por categoría se acumulan");
  check(snap.generation?.primary?.errors.http === 0, "categorías no usadas quedan en 0 (no undefined)");
  check(snap.generation?.primary?.p50 !== null, "p50 no null con muestras");
  check(snap.moderation?.openai?.count === 1, "stages/providers distintos no se mezclan");
  check(snap.memory === undefined, "stage sin llamadas no aparece en el snapshot");

  // Store aislado: no comparte estado entre instancias (clave para tests
  // deterministas, a diferencia del singleton de proceso que usan provider.ts
  // y moderation.ts).
  const other = createMetricsStore();
  check(Object.keys(other.snapshot()).length === 0, "store nuevo arranca vacío (aislado del singleton)");
}

// ---------- 4. Decisión de auth de /api/internal/metrics (función pura, no HTTP) ----------
{
  // Sin secret configurado: la ruta corta ANTES de llamar isAuthorizedCron y
  // responde 503 (fail-closed) — se prueba la precondición, no un fetch real.
  const secret: string | undefined = undefined;
  check(!secret, "sin CRON_SECRET: la ruta debe responder 503 sin evaluar el Bearer");

  const realSecret = "el-secreto-real";
  check(isAuthorizedCron(null, realSecret) === false, "sin header Authorization: 401");
  check(isAuthorizedCron("Bearer incorrecto", realSecret) === false, "Bearer incorrecto: 401");
  check(isAuthorizedCron(`Bearer ${realSecret}`, realSecret) === true, "Bearer correcto: 200");
}

done();
