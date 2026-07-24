/**
 * Suite del health-check sintético (lib/health-check.ts) — cron `/api/cron/health`.
 *
 *   pnpm health-suite
 *
 * Testea SOLO la función de agregación PURA (`aggregateHealth`) con fakes —
 * sin red, sin DB, sin llamar al LLM real (los probes de I/O viven en la route
 * y no son deterministas: quedan fuera del gate de CI, igual que el resto de
 * las suites de este repo separan lógica pura de I/O).
 *
 * Casos (los 5 pedidos por el objetivo):
 *   1. Todo ok → 200, ok:true.
 *   2. DB caída → 503 crítico (sin importar el resto).
 *   3. UN proveedor caído (el otro ok) → 200 degradado, ok:true.
 *   4. AMBOS proveedores caídos → 503 crítico.
 *   5. Sin redis (skip, no configurado) → 200, no cuenta como fallo.
 *
 * Camino crítico (el cron decide si alertar por caída de servicio): sale con
 * código 1 si algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import { aggregateHealth, type HealthComponents } from "../src/lib/health-check";

const { check, done } = createChecker("Health-check suite");

const OK = { status: "ok" as const, latencyMs: 10 };
const FAIL = { status: "fail" as const, latencyMs: 10 };
const SKIP = { status: "skip" as const, latencyMs: 0 };

function components(overrides: Partial<HealthComponents>): HealthComponents {
  return {
    db: OK,
    redis: OK,
    providerPrimary: OK,
    providerFallback: OK,
    ...overrides,
  };
}

// ---------- 1. Todo ok ----------
{
  const v = aggregateHealth(components({}));
  check(v.ok === true, "todo ok: ok:true");
  check(v.httpStatus === 200, "todo ok: HTTP 200");
}

// ---------- 2. DB caída ----------
{
  const v = aggregateHealth(components({ db: FAIL }));
  check(v.ok === false, "DB caída: ok:false");
  check(v.httpStatus === 503, "DB caída: HTTP 503 (crítico)");
}

// DB caída domina aunque el resto esté perfecto (redis + ambos proveedores ok).
{
  const v = aggregateHealth(
    components({ db: FAIL, redis: OK, providerPrimary: OK, providerFallback: OK }),
  );
  check(v.httpStatus === 503, "DB caída con todo lo demás ok: sigue siendo 503");
}

// ---------- 3. Un proveedor caído (el otro ok) ----------
{
  const vPrimary = aggregateHealth(components({ providerPrimary: FAIL }));
  check(vPrimary.ok === true, "solo primario caído: ok:true (degradado, no crítico)");
  check(vPrimary.httpStatus === 200, "solo primario caído: HTTP 200");

  const vFallback = aggregateHealth(components({ providerFallback: FAIL }));
  check(vFallback.ok === true, "solo fallback caído: ok:true (degradado, no crítico)");
  check(vFallback.httpStatus === 200, "solo fallback caído: HTTP 200");
}

// ---------- 4. Ambos proveedores caídos ----------
{
  const v = aggregateHealth(
    components({ providerPrimary: FAIL, providerFallback: FAIL }),
  );
  check(v.ok === false, "ambos proveedores caídos: ok:false");
  check(v.httpStatus === 503, "ambos proveedores caídos: HTTP 503 (crítico)");
}

// ---------- 5. Sin redis (skip) ----------
{
  const v = aggregateHealth(components({ redis: SKIP }));
  check(v.ok === true, "redis sin configurar (skip): no cuenta como fallo, ok:true");
  check(v.httpStatus === 200, "redis sin configurar (skip): HTTP 200");
}

// Fallback sin configurar (skip, no "fail") + primario caído → NO es "ambos
// fallan" (uno de los dos está en skip, no fail): degradado, no crítico.
{
  const v = aggregateHealth(
    components({ providerPrimary: FAIL, providerFallback: SKIP }),
  );
  check(
    v.httpStatus === 200,
    "primario caído + fallback sin configurar (skip): degradado, no 503 (skip ≠ fail)",
  );
}

done();
