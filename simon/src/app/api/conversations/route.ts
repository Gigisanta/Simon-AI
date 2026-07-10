import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Listado de conversaciones del usuario autenticado (B1).
 *
 * Contrato: 200 { conversations: [{ id, title, updatedAt, messageCount }], truncated }.
 * - Auth requerida (401 si no).
 * - Solo conversaciones del usuario de la sesión (ownership por userId).
 * - Solo las que tienen al menos un mensaje (messageCount > 0).
 * - orderBy updatedAt desc, máximo 50.
 * - NUNCA expone safetyFlag ni el contenido de los mensajes.
 *
 * PAGINACIÓN (decisión #21-4): NO se implementa cursor pagination. En el modelo
 * tutor-first (un menor por cuenta, o el tutor/a) superar 50 conversaciones es un
 * caso raro, y la lista ya agrupa por día. En vez de complejidad API+cliente para
 * ese borde (YAGNI), se pide `take: 51` para detectar el corte y se expone
 * `truncated: true`; el cliente avisa que hay más y no las muestra en silencio. Si
 * el uso real superara esto seguido, migrar al patrón cursor de safety-events.ts.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

// Listado (lectura): tope holgado por usuario contra scraping/scripting.
// Key propia (`conversations:list:`) — NO se comparte con el detalle de una
// conversación (`conversations:detail:` en [id]/route.ts): abrir varios hilos
// seguidos consumía la misma cuota y disparaba 429 sorpresivos.
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
    `conversations:list:${session.user.id}`,
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

  const PAGE_SIZE = 50;
  const rows = await prisma.conversation.findMany({
    // `messages: { some: {} }` → solo conversaciones con ≥1 mensaje.
    where: { userId: session.user.id, messages: { some: {} } },
    orderBy: { updatedAt: "desc" },
    // 51 para detectar si hay más allá del tope sin un count() extra.
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      _count: { select: { messages: true } },
    },
  });

  const truncated = rows.length > PAGE_SIZE;
  const conversations = (truncated ? rows.slice(0, PAGE_SIZE) : rows).map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    messageCount: c._count.messages,
  }));

  return Response.json({ conversations, truncated }, { headers: NO_STORE });
}
