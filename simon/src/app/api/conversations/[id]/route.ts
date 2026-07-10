import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { sameOriginOk } from "@/lib/env-check";

/**
 * Una conversación del usuario (B1): leer sus mensajes o borrarla.
 *
 * GET    → 200 { id, title, updatedAt, messages: [{ id, role, content }] }
 *          (solo roles user/assistant, los 200 MÁS RECIENTES en orden cronológico).
 * DELETE → 200 { ok: true }. Cascade borra los mensajes (schema).
 *
 * OWNERSHIP (invariante de seguridad): TODA query filtra por el userId de la
 * sesión. Si la conversación no existe o no es del usuario → 404 (mismo status
 * para ambos casos: no se revela la existencia de conversaciones ajenas). NUNCA
 * se expone safetyFlag.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

// Borrado: acotado por usuario contra scripting/errores en ráfaga.
const DELETE_RATE_LIMIT_PER_MINUTE = 20;
// Lectura de una conversación: tope holgado por usuario contra scraping/scripting.
// Key propia (`conversations:detail:`) — NO se comparte con el listado
// (`conversations:list:` en ../route.ts): abrir varios hilos seguidos consumía
// la misma cuota que el listado y disparaba 429 sorpresivos.
const READ_RATE_LIMIT_PER_MINUTE = 60;

const UNAUTHENTICATED = () =>
  Response.json({ error: "No autenticado" }, { status: 401, headers: NO_STORE });

const NOT_FOUND = () =>
  Response.json(
    { error: "Conversación no encontrada" },
    { status: 404, headers: NO_STORE },
  );

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return UNAUTHENTICATED();

  const rl = await checkRateLimit(
    `conversations:detail:${session.user.id}`,
    READ_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: "Demasiadas consultas seguidas. Esperá un momento." },
      {
        status: 429,
        headers: { ...NO_STORE, "retry-after": String(rl.retryAfterSeconds) },
      },
    );
  }

  const { id } = await params;
  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        where: { role: { in: ["user", "assistant"] } },
        // Los 200 mensajes MÁS RECIENTES (desc + take), no los 200 más viejos:
        // en una charla larga interesa el final. Se revierten a orden cronológico
        // (asc) abajo — mismo patrón que chat/resume/route.ts — porque el cliente
        // (conversation-list → chat) espera el array viejo → nuevo.
        orderBy: { createdAt: "desc" },
        take: 200,
        select: { id: true, role: true, content: true },
      },
    },
  });
  if (!conversation) return NOT_FOUND();

  return Response.json(
    {
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messages: [...conversation.messages].reverse(),
    },
    { headers: NO_STORE },
  );
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Defensa CSRF en profundidad (M3): Origin cross-site → 403 (igual que /api/chat).
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return UNAUTHENTICATED();

  const rl = await checkRateLimit(
    `conversation:delete:${session.user.id}`,
    DELETE_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: "Demasiados borrados seguidos. Esperá un momento." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  const { id } = await params;
  // deleteMany con el par (id, userId): atómico y sin TOCTOU — jamás borra una
  // conversación ajena. count 0 = no existe o no es del usuario → 404. El
  // cascade del schema borra Message (e InteractionLog referenciados).
  const res = await prisma.conversation.deleteMany({
    where: { id, userId: session.user.id },
  });
  if (res.count === 0) return NOT_FOUND();

  return Response.json({ ok: true });
}
