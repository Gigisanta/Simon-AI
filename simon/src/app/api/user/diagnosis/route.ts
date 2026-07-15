import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitMessage } from "@/lib/ui-messages";
import { sameOriginOk } from "@/lib/env-check";
import { z } from "zod";

const RATE_LIMIT_PER_MINUTE = 10;

const bodySchema = z.object({
  hasDiagnosis: z.boolean(),
});

/**
 * PATCH /api/user/diagnosis
 *
 * El menor responde si tiene diagnóstico o no, durante su onboarding.
 * Solo accesible para usuarios con role="child". No requiere verificación
 * de email (el menor no tiene email real).
 */
export async function PATCH(req: Request) {
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const { session, response } = await requireSession(req);
  if (!session) return response;

  // Solo menores pueden responder esta pregunta desde su onboarding.
  if (session.user.role !== "child") {
    return Response.json({ error: "Solo disponible para menores" }, { status: 403 });
  }

  // Rate limit por usuario.
  const rl = await checkRateLimit(
    `user:diagnosis:${session.user.id}`,
    RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: rateLimitMessage("cambios", "m") },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Datos inválidos", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  const { hasDiagnosis } = parsed.data;

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { hasDiagnosis },
    });
    return Response.json({ ok: true, hasDiagnosis });
  } catch {
    return Response.json(
      { error: "No se pudo guardar. Probá de nuevo." },
      { status: 500 },
    );
  }
}
