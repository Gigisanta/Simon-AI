import { prisma } from "@/lib/prisma";
import { memoryTtlCutoff } from "@/lib/ai/memory";
import { interactionLogTtlCutoff, isAuthorizedCron } from "@/lib/retention";

/**
 * Purga TTL por cron — INDEPENDIENTE del tráfico (#9 + #12).
 *
 * El path lazy de /api/chat purga UserMemory/InteractionLog del usuario ACTIVO
 * dentro de `after()`. Un usuario inactivo (que nunca vuelve a chatear) dejaba
 * sus datos vencidos sin purgar; y las Session de better-auth vencidas — con
 * ipAddress/userAgent — no las tocaba nadie. Este cron corre a diario y purga:
 *   - UserMemory vencida (updatedAt < corte 90d — mismo helper que el path lazy).
 *   - InteractionLog vencido (createdAt < corte 180d — mismo helper compartido).
 *   - Session vencida (expiresAt < now) → borra ipAddress/userAgent colgados.
 * Cero duplicación de constantes: reusa memoryTtlCutoff / interactionLogTtlCutoff.
 *
 * SEGURIDAD: protegido con CRON_SECRET (header Authorization: Bearer, comparación
 * timing-safe). Sin CRON_SECRET en runtime → 503 (fail-closed, NUNCA abierto).
 *
 * BATCHING: cada purga es UN `deleteMany` por rango (una sola sentencia DELETE
 * ... WHERE en Postgres, no N+1). Con cadencia diaria el volumen por corrida está
 * acotado (backlog de un día), así que no hace falta paginar/loopear: una query
 * por tabla es lo más eficiente y atómico. Si en el futuro el volumen creciera,
 * se puede acotar con `deleteMany` en lotes por `id`, pero hoy es YAGNI.
 */
export const dynamic = "force-dynamic";
// Holgura para tres deleteMany en secuencia sobre tablas potencialmente grandes.
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

async function handlePurge(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  // Fail-closed: sin secret configurado no se ejecuta NUNCA (no queda abierto).
  if (!secret) {
    console.error(
      "[cron/purge] CRON_SECRET no configurado — 503 (la purga no corre; nunca abierta)",
    );
    return Response.json(
      { error: "Cron no configurado" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!isAuthorizedCron(req.headers.get("authorization"), secret)) {
    return Response.json(
      { error: "No autorizado" },
      { status: 401, headers: NO_STORE },
    );
  }

  const now = new Date();
  try {
    // Independientes entre sí → en paralelo. Cada uno es un solo DELETE por rango.
    const [userMemory, interactionLog, sessions] = await Promise.all([
      prisma.userMemory.deleteMany({
        where: { updatedAt: { lt: memoryTtlCutoff(now) } },
      }),
      prisma.interactionLog.deleteMany({
        where: { createdAt: { lt: interactionLogTtlCutoff(now) } },
      }),
      prisma.session.deleteMany({
        where: { expiresAt: { lt: now } },
      }),
    ]);

    const deleted = {
      userMemory: userMemory.count,
      interactionLog: interactionLog.count,
      sessions: sessions.count,
    };
    console.log("[cron/purge] purga TTL OK", deleted);
    return Response.json(
      { ok: true, deleted, purgedAt: now.toISOString() },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[cron/purge] error en la purga TTL:", err);
    return Response.json(
      { error: "Error en la purga" },
      { status: 500, headers: NO_STORE },
    );
  }
}

// Vercel Cron dispara con GET + Authorization: Bearer $CRON_SECRET.
export async function GET(req: Request) {
  return handlePurge(req);
}
