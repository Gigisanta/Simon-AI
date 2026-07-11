/**
 * Export de datos del menor — derecho de acceso y portabilidad (Ley 25.326
 * arts. 14-15 / GDPR-K art. 15 y 20), ejercido por el tutor/a.
 *
 * GET → JSON descargable (Content-Disposition: attachment) con TODO lo que
 *       constituye datos personales del menor, en forma legible/portable.
 *
 * QUÉ SE INCLUYE (y por qué):
 *   - Perfil del menor: nombre, usuario, año de nacimiento, rol, alta. Son sus
 *     datos personales. NUNCA se incluyen password/hashes (viven en `account`,
 *     no se leen) ni el email sintético interno (no es un dato del titular, es
 *     una clave técnica de better-auth).
 *   - Conversaciones + mensajes (rol, contenido, fecha): el grueso del dato
 *     personal generado por el menor. Se arma por BATCHES por conversación
 *     (paginación interna) para no cargar un historial enorme de una sola query.
 *   - UserMemory (aprendizaje sobre el menor): kind, contenido, fechas.
 *   - SafetyEvents: SOLO metadata (category, layer, createdAt, notifiedAt), igual
 *     que el historial de seguridad — nunca texto del menor.
 *
 * QUÉ SE EXCLUYE (y por qué):
 *   - InteractionLog: telemetría interna (performance/moderación) — NO es un dato
 *     personal del titular en el sentido del derecho de acceso; es observabilidad
 *     y dataset técnico, anonimizado. Se omite deliberadamente.
 *   - Sesiones, accounts, tokens y password: credenciales/seguridad, no datos del
 *     titular exportables; exponerlos sería un riesgo, no un derecho.
 *   - Datos de cualquier otro usuario: el export está estrictamente scopeado al
 *     childId autorizado.
 *
 * AUTORIZACIÓN (mismo patrón exacto que ../route.ts): sesión de guardian +
 * vínculo de tutela. Si el childId no es un menor SUYO → 404.
 */
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitMessage } from "@/lib/ui-messages";
import { requireGuardian, findOwnedChild } from "@/lib/guardian-auth";
import { buildExportedConversations } from "@/lib/export-conversations";
import {
  EXPORT_CHILD_SELECT,
  buildChildProfile,
  exportFilename,
} from "@/lib/export-child";

// El export recorre N conversaciones paginando mensajes por cursor (varios
// round-trips a la DB), así que puede tardar más que un handler corriente. Se le
// da un techo explícito y razonable, en línea con otras rutas pesadas del repo
// (/api/chat usa 90, cron/purge 60). NO se hace streaming/NDJSON ni job async: si
// el volumen por menor crece hasta acercarse a este techo, esa es la vía futura
// (responder un 202 + generar el JSON en background y entregarlo por descarga).
export const maxDuration = 60;

// Export = varias queries a la DB de datos de un menor. Límite bajo contra abuso
// y contra scripting de exports en ráfaga.
const RATE_LIMIT_PER_MINUTE = 5;

// Tamaño de batch para paginar mensajes por conversación (evita un findMany sin
// límite del historial completo del menor).
const MESSAGE_BATCH = 500;

const NOT_FOUND = () =>
  Response.json({ error: "Menor no encontrado." }, { status: 404 });

/**
 * Trae todos los mensajes de una conversación paginando por cursor en batches,
 * para no materializar un historial enorme en una sola query.
 */
async function collectMessages(conversationId: string) {
  const out: { role: string; content: string; createdAt: Date }[] = [];
  let cursor: string | undefined;
  for (;;) {
    const batch = await prisma.message.findMany({
      where: { conversationId },
      select: { id: true, role: true, content: true, createdAt: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MESSAGE_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const m of batch) {
      out.push({ role: m.role, content: m.content, createdAt: m.createdAt });
    }
    if (batch.length < MESSAGE_BATCH) break;
    cursor = batch[batch.length - 1]!.id;
  }
  return out;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ childId: string }> },
) {
  // Acceso/portabilidad = derecho del titular: no se bloquea por email sin
  // verificar (misma lógica que el borrado en ../route.ts). La sesión garantiza
  // la identidad.
  const guard = await requireGuardian(req, { requireVerifiedEmail: false });
  if (!guard.ok) return guard.response;

  const rl = await checkRateLimit(
    `guardian:child-export:${guard.user.id}`,
    RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: rateLimitMessage("descargas", "f") },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  const { childId } = await params;
  const link = await findOwnedChild(guard.user.id, childId, EXPORT_CHILD_SELECT);
  if (!link) return NOT_FOUND();

  const child = link.childUser;

  // Conversaciones (metadata) primero; los mensajes se traen por batches abajo.
  const conversations = await prisma.conversation.findMany({
    where: { userId: childId },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });

  // Mensajes por conversación EN PARALELO, preservando el orden (Promise.all +
  // Array.map). El endpoint está rate-limited (5/min), así que N es acotado.
  const conversationsWithMessages = await buildExportedConversations(
    conversations,
    collectMessages,
  );

  // UserMemory y SafetyEvents (metadata) — bajo volumen (TTL/minimización).
  const [memories, safetyEvents] = await Promise.all([
    prisma.userMemory.findMany({
      where: { userId: childId },
      select: { kind: true, content: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.safetyEvent.findMany({
      where: { userId: childId },
      // SOLO metadata, nunca texto del menor (idéntico al historial de seguridad).
      select: { category: true, layer: true, createdAt: true, notifiedAt: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const exportedAt = new Date();
  const profile = buildChildProfile(child, link.consentAt);
  const payload = {
    exportedAt,
    subject: "datos personales del menor",
    profile,
    conversations: conversationsWithMessages,
    memories,
    safetyEvents,
  };

  // Nombre de archivo con el usuario saneado (nunca dejar que un valor guiado por
  // datos rompa el header Content-Disposition).
  const filename = exportFilename(profile.username, exportedAt);

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // Datos sensibles de un menor: nunca cachear en proxies/navegador.
      "cache-control": "no-store",
    },
  });
}
