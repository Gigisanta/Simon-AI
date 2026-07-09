/**
 * Gestión de UN menor por su tutor/a.
 *
 * DELETE → derecho de supresión (Ley 25.326 art. 16): borra la cuenta del
 *          menor y TODOS sus datos (conversaciones, mensajes, memorias,
 *          eventos de seguridad, sesiones y vínculo de tutela) vía cascade.
 * PATCH  → activa/desactiva las alertas de crisis (Guardian.alertsEnabled).
 *
 * CAMINO CRÍTICO (borrado irreversible de datos de un menor):
 * - Solo el tutor/a del menor: si el childId no es un menor SUYO → 404 (nunca
 *   se revela si la cuenta existe).
 * - DELETE exige `{ confirm: true }` literal en el body (400 si falta).
 * - Las relaciones tienen onDelete: Cascade en schema + migraciones; la DB es
 *   Postgres (Neon), que aplica las FK con ON DELETE CASCADE siempre; igual se
 *   re-verifica post-borrado que no queden restos.
 */
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireGuardian } from "@/lib/guardian-auth";
import { sameOriginOk } from "@/lib/env-check";
import { z } from "zod";

// Borrado: irreversible → límite bajo contra scripting/errores en ráfaga.
const DELETE_RATE_LIMIT_PER_MINUTE = 5;
const PATCH_RATE_LIMIT_PER_MINUTE = 20;

const deleteSchema = z.object({
  // Literal obligatorio: el cliente debe afirmar la confirmación explícita.
  confirm: z.literal(true, { error: "Falta la confirmación explícita." }),
});

const patchSchema = z.object({
  alertsEnabled: z.boolean(),
});

const NOT_FOUND = () =>
  Response.json({ error: "Menor no encontrado." }, { status: 404 });

/**
 * Vínculo de tutela del par (tutor de la sesión, childId). Devuelve null si el
 * childId no existe, no es un menor, o no está a cargo de este tutor/a — los
 * tres casos colapsan en 404 para no revelar existencia de cuentas ajenas.
 */
async function findOwnedChild(guardianUserId: string, childId: string) {
  return prisma.guardian.findFirst({
    where: {
      guardianUserId,
      childUserId: childId,
      childUser: { role: "child" },
    },
    select: { id: true, childUser: { select: { id: true, name: true } } },
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ childId: string }> },
) {
  // Defensa CSRF en profundidad (M3): Origin cross-site → 403.
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  // Supresión = derecho del titular (art. 16): no se bloquea por email sin
  // verificar. La identidad la garantiza la sesión.
  const guard = await requireGuardian(req, { requireVerifiedEmail: false });
  if (!guard.ok) return guard.response;

  const rl = await checkRateLimit(
    `guardian:child-delete:${guard.user.id}`,
    DELETE_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: "Demasiados intentos seguidos. Esperá un momento." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  // Confirmación explícita en el body (nunca confiar en el cliente).
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!deleteSchema.safeParse(json).success) {
    return Response.json(
      { error: "Falta la confirmación explícita ({ confirm: true })." },
      { status: 400 },
    );
  }

  const { childId } = await params;
  const link = await findOwnedChild(guard.user.id, childId);
  if (!link) return NOT_FOUND();

  // Resumen de lo que se va a borrar (para informar al tutor/a).
  const where = { userId: childId };
  const [conversations, messages, memories, safetyEvents] = await Promise.all([
    prisma.conversation.count({ where }),
    prisma.message.count({ where: { conversation: { userId: childId } } }),
    prisma.userMemory.count({ where }),
    prisma.safetyEvent.count({ where }),
  ]);

  try {
    // Cascade borra Conversation→Message, UserMemory, SafetyEvent, Guardian,
    // Session y Account del menor.
    await prisma.user.delete({ where: { id: childId } });
  } catch (err) {
    console.error("[guardian] error borrando la cuenta del menor:", err);
    return Response.json(
      { error: "No se pudo eliminar la cuenta. Probá de nuevo." },
      { status: 500 },
    );
  }

  // Verificación post-borrado (Ley 25.326: la supresión tiene que ser real).
  const leftovers = await Promise.all([
    prisma.user.count({ where: { id: childId } }),
    prisma.conversation.count({ where }),
    prisma.userMemory.count({ where }),
    prisma.safetyEvent.count({ where }),
  ]);
  if (leftovers.some((n) => n > 0)) {
    console.error(
      `[guardian] BORRADO INCOMPLETO para ${childId}: [user, conv, mem, safety] = ${leftovers.join(", ")}`,
    );
    return Response.json(
      { error: "La eliminación quedó incompleta. Contactá al soporte." },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    deleted: { conversations, messages, memories, safetyEvents },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ childId: string }> },
) {
  // Defensa CSRF en profundidad (M3): Origin cross-site → 403.
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const guard = await requireGuardian(req, { requireVerifiedEmail: false });
  if (!guard.ok) return guard.response;

  const rl = await checkRateLimit(
    `guardian:child-patch:${guard.user.id}`,
    PATCH_RATE_LIMIT_PER_MINUTE,
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
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Datos inválidos", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  const { childId } = await params;
  const link = await findOwnedChild(guard.user.id, childId);
  if (!link) return NOT_FOUND();

  await prisma.guardian.update({
    where: { id: link.id },
    data: { alertsEnabled: parsed.data.alertsEnabled },
  });

  return Response.json({ ok: true, alertsEnabled: parsed.data.alertsEnabled });
}
