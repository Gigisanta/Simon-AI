import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Retomar conversación: devuelve la última conversación del usuario para que el
// cliente ofrezca "¿Seguimos donde quedamos?". NUNCA expone safetyFlag ni datos
// de otros usuarios (el where filtra por userId de la sesión).
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

  const conversation = await prisma.conversation.findFirst({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 40,
        select: { id: true, role: true, content: true },
      },
    },
  });

  // Solo se retoman turnos de conversación reales ("user"/"assistant").
  const messages = (conversation?.messages ?? []).filter(
    (m) => m.role === "user" || m.role === "assistant",
  );

  // Sin conversación o demasiado corta para valer la pena retomarla.
  if (!conversation || messages.length < 2) {
    return Response.json({ resumable: null }, { headers: NO_STORE });
  }

  return Response.json(
    {
      resumable: {
        id: conversation.id,
        updatedAt: conversation.updatedAt,
        messages,
      },
    },
    { headers: NO_STORE },
  );
}
