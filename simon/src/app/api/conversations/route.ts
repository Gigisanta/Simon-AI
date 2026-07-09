import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Listado de conversaciones del usuario autenticado (B1).
 *
 * Contrato: 200 { conversations: [{ id, title, updatedAt, messageCount }] }.
 * - Auth requerida (401 si no).
 * - Solo conversaciones del usuario de la sesión (ownership por userId).
 * - Solo las que tienen al menos un mensaje (messageCount > 0).
 * - orderBy updatedAt desc, máximo 50.
 * - NUNCA expone safetyFlag ni el contenido de los mensajes.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json(
      { error: "No autenticado" },
      { status: 401, headers: NO_STORE },
    );
  }

  const rows = await prisma.conversation.findMany({
    // `messages: { some: {} }` → solo conversaciones con ≥1 mensaje.
    where: { userId: session.user.id, messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  const conversations = rows.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    messageCount: c._count.messages,
  }));

  return Response.json({ conversations }, { headers: NO_STORE });
}
