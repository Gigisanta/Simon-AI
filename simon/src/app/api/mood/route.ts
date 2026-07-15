/**
 * "Mi diario" — registro de ánimo del menor (check-in de valencia 1–3).
 *
 * POST → el usuario autenticado registra SU propio ánimo (nunca el de otro).
 * GET  → devuelve la tendencia reciente: la propia, o —si es tutor/a y pasa
 *        ?childId=— la de un menor A SU CARGO (findOwnedChild evita IDOR).
 *
 * Psicoeducación, no diagnóstico: es un diario de bienestar, no una escala
 * clínica. Sin PII en `note` (texto corto y opcional del propio menor).
 */
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { findOwnedChild } from "@/lib/guardian-auth";
import { sameOriginOk } from "@/lib/env-check";
import { z } from "zod";

const POST_RATE_LIMIT_PER_MINUTE = 30;
const MAX_ENTRIES = 30;

const moodSchema = z.object({
  // 1 = mal · 2 = más o menos · 3 = bien.
  value: z.number().int().min(1).max(3),
  context: z.enum(["session_start", "session_close", "manual"]),
  note: z.string().trim().max(200).optional(),
});

export async function POST(req: Request) {
  // Defensa CSRF en profundidad (M3): Origin cross-site → 403.
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const { session, response } = await requireSession(req);
  if (!session) return response;

  const rl = await checkRateLimit(
    `mood:post:${session.user.id}`,
    POST_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: "Esperá un momento antes de registrar de nuevo." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = moodSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Datos inválidos", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  await prisma.moodEntry.create({
    data: {
      userId: session.user.id,
      value: parsed.data.value,
      context: parsed.data.context,
      note: parsed.data.note ?? null,
    },
  });

  return Response.json({ ok: true }, { status: 201 });
}

export async function GET(req: Request) {
  const { session, response } = await requireSession(req);
  if (!session) return response;

  const childId = new URL(req.url).searchParams.get("childId")?.trim();

  // Tutor/a mirando la tendencia de un menor A SU CARGO (mismo guard anti-IDOR
  // que el resto de las rutas del tutor/a).
  let targetUserId = session.user.id;
  if (childId) {
    if (session.user.role !== "guardian") {
      return Response.json({ error: "No autorizado" }, { status: 403 });
    }
    const link = await findOwnedChild(session.user.id, childId, { id: true });
    if (!link) {
      return Response.json({ error: "Menor no encontrado." }, { status: 404 });
    }
    targetUserId = childId;
  }

  const rows = await prisma.moodEntry.findMany({
    where: { userId: targetUserId },
    select: { value: true, context: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: MAX_ENTRIES,
  });

  return Response.json({ entries: rows });
}
