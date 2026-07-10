import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

// Retomar conversación: devuelve la última conversación del usuario para que el
// cliente ofrezca "¿Seguimos donde quedamos?". NUNCA expone safetyFlag ni datos
// de otros usuarios (el where filtra por userId de la sesión).
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

// Endpoint autenticado de LECTURA: mismo tope holgado por usuario que el resto
// de las lecturas (conversations, safety-events) contra scraping/scripting.
const READ_RATE_LIMIT_PER_MINUTE = 60;

export async function GET(req: Request) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json(
      { error: "No autenticado" },
      { status: 401, headers: NO_STORE },
    );
  }

  const rl = await checkRateLimit(
    `chat:resume:${session.user.id}`,
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

  const conversation = await prisma.conversation.findFirst({
    where: { userId: session.user.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      updatedAt: true,
      messages: {
        // Los 40 mensajes MÁS RECIENTES (desc + take), no los 40 más viejos:
        // en una charla larga se retoma el final, no el principio. Se revierten
        // a orden cronológico (asc) más abajo, que es lo que espera el cliente
        // (chat.tsx renderiza el array en orden, viejo → nuevo).
        orderBy: { createdAt: "desc" },
        take: 40,
        select: { id: true, role: true, content: true },
      },
    },
  });

  // Solo se retoman turnos de conversación reales ("user"/"assistant"), en orden
  // cronológico (se revierte el desc de la query).
  const messages = (conversation?.messages ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .reverse();

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
