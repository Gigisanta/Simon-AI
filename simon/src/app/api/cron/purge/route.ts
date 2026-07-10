import { prisma } from "@/lib/prisma";
import {
  isAuthorizedCron,
  PURGE_LOCK_NAME,
  purgeExpiredData,
  purgeUnderLock,
} from "@/lib/retention";

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
 *   - Menores HUÉRFANOS pasado el período de gracia: filas User role "child" sin
 *     vínculo de tutela (el cascade de Guardian dejó al menor sin ruta de borrado
 *     al eliminarse la cuenta del tutor/a). Cascade de User arrastra toda su data
 *     (Conversation/Message/UserMemory/SafetyEvent/InteractionLog). Ley 25.326.
 * La orquestación (incluido el orden anti-deadlock) vive en retention.ts
 * (purgeExpiredData); acá solo va la auth + el manejo de respuesta/errores.
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
// Holgura para el batch TTL + el barrido de huérfanos (con cascade) sobre tablas
// potencialmente grandes.
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
  const startedAt = Date.now();
  try {
    // Lock distribuido para evitar corridas CONCURRENTES del cron (Vercel puede
    // reintentar/solapar invocaciones). pg_try_advisory_xact_lock NO bloquea: si
    // otra corrida tiene el lock devuelve false y esta salta (200 skipped). El
    // lock + la purga van en UNA transacción interactiva → misma conexión (el
    // adapter de Neon usa Pool/WebSocket) y liberación automática en el commit,
    // sin unlock manual ni riesgo de rotación de conexión.
    const result = await prisma.$transaction(async (tx) => {
      return purgeUnderLock({
        tryLock: async () => {
          const rows = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(hashtext(${PURGE_LOCK_NAME})) AS locked`;
          return rows[0]?.locked === true;
        },
        purge: () => purgeExpiredData(tx, now),
      });
    });

    if (result.skipped) {
      console.log("[cron/purge] otra corrida tiene el lock — se saltea");
      return Response.json(
        { ok: true, skipped: true, purgedAt: now.toISOString() },
        { headers: NO_STORE },
      );
    }

    // Métrica: conteos por tabla + duración total. El detalle por tabla ya venía
    // en `result.deleted`; se agrega la duración para detectar crecimiento del
    // backlog (una corrida que borra mucho más de lo habitual o que tarda de más).
    const durationMs = Date.now() - startedAt;
    console.log(`[cron/purge] purga TTL OK (${durationMs}ms)`, result.deleted);
    return Response.json(
      { ok: true, deleted: result.deleted, durationMs, purgedAt: now.toISOString() },
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
