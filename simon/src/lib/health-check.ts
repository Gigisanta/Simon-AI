/**
 * Health-check sintético (cron `/api/cron/health`) — agregación PURA.
 *
 * Este módulo NO hace I/O (sin red, sin DB): los probes reales (DB, Upstash,
 * proveedores LLM) viven en la route (necesitan `prisma`, `fetch`, `generateText`).
 * Acá solo vive la función que decide el veredicto agregado a partir de los
 * resultados YA obtenidos — testeable con fakes en scripts/health-suite.ts.
 *
 * REGLA (dada por el objetivo, no inventada): crítico (503) si la DB falló, O
 * si AMBOS proveedores LLM quedaron en estado "fail". Cualquier otra
 * combinación (un proveedor caído, redis caído/sin configurar, fallback no
 * configurado → "skip") es degradado pero sirve: 200 con el detalle por
 * componente para que quien mire el JSON vea QUÉ está caído.
 */

export type ComponentStatus = "ok" | "fail" | "skip";

export interface ComponentResult {
  status: ComponentStatus;
  latencyMs: number;
}

export interface HealthComponents {
  db: ComponentResult;
  redis: ComponentResult;
  providerPrimary: ComponentResult;
  providerFallback: ComponentResult;
}

export interface HealthVerdict {
  ok: boolean;
  httpStatus: 200 | 503;
}

/** Agregación pura: componentes ya resueltos → veredicto (ok + status HTTP). */
export function aggregateHealth(components: HealthComponents): HealthVerdict {
  const bothProvidersFailed =
    components.providerPrimary.status === "fail" &&
    components.providerFallback.status === "fail";
  const critical = components.db.status === "fail" || bothProvidersFailed;
  return { ok: !critical, httpStatus: critical ? 503 : 200 };
}
