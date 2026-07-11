/**
 * "Puente" — derivación asistida para el tutor/a.
 *
 * GET  → tarjetas del Puente (situación computada de los SafetyEvent + estado de
 *        seguimiento) de TODOS los menores del tutor/a. Solo metadata: nunca
 *        contenido del menor (M-P2).
 * POST → registra la RESPUESTA del tutor/a a una situación (contacted/resolved/
 *        dismissed) para un menor A SU CARGO. Upsert del followup activo.
 */
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireGuardian, findOwnedChild } from "@/lib/guardian-auth";
import { sameOriginOk } from "@/lib/env-check";
import { loadBridgeCards } from "@/lib/bridge-data";
import { z } from "zod";

const POST_RATE_LIMIT_PER_MINUTE = 20;

const followupSchema = z.object({
  childId: z.string().min(1),
  reason: z.enum(["crisis", "abuso", "riesgo", "alimentario"]),
  status: z.enum(["contacted", "resolved", "dismissed"]),
  resourceId: z.string().max(60).optional(),
  note: z.string().trim().max(300).optional(),
});

export async function GET(req: Request) {
  // Acción sobre la seguridad del propio menor: no se bloquea por email sin
  // verificar (mismo criterio que el resto de rutas de derechos del tutor/a).
  const guard = await requireGuardian(req, { requireVerifiedEmail: false });
  if (!guard.ok) return guard.response;

  const cards = await loadBridgeCards(guard.user.id);
  return Response.json({ cards });
}

export async function POST(req: Request) {
  // Defensa CSRF en profundidad (M3): Origin cross-site → 403.
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const guard = await requireGuardian(req, { requireVerifiedEmail: false });
  if (!guard.ok) return guard.response;

  const rl = await checkRateLimit(
    `guardian:bridge:${guard.user.id}`,
    POST_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: "Demasiados cambios seguidos. Esperá un momento." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = followupSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Datos inválidos", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const { childId, reason, status, resourceId, note } = parsed.data;

  // Anti-IDOR: el menor tiene que ser de este tutor/a (404 si no).
  const link = await findOwnedChild(guard.user.id, childId, { id: true });
  if (!link) {
    return Response.json({ error: "Menor no encontrado." }, { status: 404 });
  }

  await prisma.guardianFollowup.upsert({
    where: {
      guardianUserId_childUserId: {
        guardianUserId: guard.user.id,
        childUserId: childId,
      },
    },
    update: { reason, status, resourceId: resourceId ?? null, note: note ?? null },
    create: {
      guardianUserId: guard.user.id,
      childUserId: childId,
      reason,
      status,
      resourceId: resourceId ?? null,
      note: note ?? null,
    },
  });

  return Response.json({ ok: true, status });
}
