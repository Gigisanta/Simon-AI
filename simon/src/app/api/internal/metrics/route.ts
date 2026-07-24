import { isAuthorizedCron } from "@/lib/retention";
import { snapshotMetrics } from "@/lib/metrics";

/**
 * Observabilidad mínima (objetivo b): snapshot de las métricas in-process
 * (metrics.ts) por stage/proveedor. Mismo patrón fail-closed que /api/cron/*
 * (isAuthorizedCron, retention.ts): sin CRON_SECRET → 503, Bearer inválido/
 * ausente → 401. No es una ruta de cron (no dispara ningún job), pero
 * reutiliza el mismo secreto/mecanismo porque ya es el único bearer "interno"
 * del proyecto — evita introducir un segundo secreto para una superficie
 * igual de sensible (expone conteos de errores del proveedor de IA).
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("[internal/metrics] CRON_SECRET no configurado — 503 (fail-closed)");
    return Response.json(
      { error: "No configurado" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!isAuthorizedCron(req.headers.get("authorization"), secret)) {
    return Response.json(
      { error: "No autorizado" },
      { status: 401, headers: NO_STORE },
    );
  }

  return Response.json(
    { ok: true, generatedAt: new Date().toISOString(), stages: snapshotMetrics() },
    { headers: NO_STORE },
  );
}
