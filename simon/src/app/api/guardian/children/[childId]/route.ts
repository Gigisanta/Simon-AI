/**
 * Gestión de UN menor por su tutor/a.
 *
 * DELETE → derecho de supresión (Ley 25.326 art. 16): borra la cuenta del
 *          menor y TODOS sus datos (conversaciones, mensajes, memorias,
 *          eventos de seguridad, sesiones y vínculo de tutela) vía cascade.
 * PATCH  → activa/desactiva las alertas de crisis (Guardian.alertsEnabled) y/o
 *          suspende/reanuda el consentimiento (Guardian.consentRevokedAt) sin
 *          borrar datos (derecho de oposición). Suspender corta las sesiones
 *          activas del menor para que el bloqueo tenga efecto de inmediato.
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
import { rateLimitMessage } from "@/lib/ui-messages";
import { requireGuardian, findOwnedChild } from "@/lib/guardian-auth";
import { isRecordNotFoundError } from "@/lib/guardian-children";
import { sameOriginOk } from "@/lib/env-check";
import { revokeUserSessions } from "@/lib/auth-secondary-storage";
import type { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

// Borrado: irreversible → límite bajo contra scripting/errores en ráfaga.
const DELETE_RATE_LIMIT_PER_MINUTE = 5;
const PATCH_RATE_LIMIT_PER_MINUTE = 20;

const deleteSchema = z.object({
  // Literal obligatorio: el cliente debe afirmar la confirmación explícita.
  confirm: z.literal(true, { error: "Falta la confirmación explícita." }),
});

// Al menos uno de los dos campos. `alertsEnabled` (alertas de crisis) y
// `consentRevoked` (suspender/reanudar el consentimiento) son independientes: se
// pueden mandar por separado o juntos.
const patchSchema = z
  .object({
    alertsEnabled: z.boolean().optional(),
    // true = suspender el consentimiento (bloquea el chat, sin borrar datos);
    // false = reanudarlo.
    consentRevoked: z.boolean().optional(),
  })
  .refine(
    (d) => d.alertsEnabled !== undefined || d.consentRevoked !== undefined,
    { error: "Nada para actualizar (alertsEnabled o consentRevoked)." },
  );

const NOT_FOUND = () =>
  Response.json({ error: "Menor no encontrado." }, { status: 404 });

// Proyección de este endpoint: el id del vínculo (para PATCH) + datos básicos del
// menor. La autorización (where con los tres constraints) vive en findOwnedChild.
const OWNED_CHILD_SELECT = {
  id: true,
  childUser: { select: { id: true, name: true } },
} as const;

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
      { error: rateLimitMessage("intentos", "m") },
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
  const link = await findOwnedChild(guard.user.id, childId, OWNED_CHILD_SELECT);
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
    // Doble-submit concurrente: dos requests pasan findOwnedChild casi a la vez,
    // el primero borra y el segundo choca con P2025 (registro inexistente). El
    // efecto deseado ya se cumplió → éxito IDEMPOTENTE, no un 500 espurio.
    if (isRecordNotFoundError(err)) {
      return Response.json({ ok: true, alreadyDeleted: true });
    }
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

  // L4: el cascade borró las filas de Session en DB, pero las copias en Redis
  // secondaryStorage seguirían autenticando al menor hasta su TTL. Se invalidan
  // explícitamente (no-op si no hay Upstash configurado).
  await revokeUserSessions(childId);

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
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Datos inválidos", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }

  const { childId } = await params;
  const link = await findOwnedChild(guard.user.id, childId, OWNED_CHILD_SELECT);
  if (!link) return NOT_FOUND();

  const { alertsEnabled, consentRevoked } = parsed.data;
  const data: Prisma.GuardianUpdateInput = {};
  if (alertsEnabled !== undefined) data.alertsEnabled = alertsEnabled;
  if (consentRevoked !== undefined) {
    // Suspender = fijar el instante de revocación; reanudar = volver a null.
    data.consentRevokedAt = consentRevoked ? new Date() : null;
  }

  await prisma.guardian.update({ where: { id: link.id }, data });

  // Suspensión: cortar las sesiones activas del menor para que el bloqueo tenga
  // efecto YA (no espera a que su sesión expire). No hay cascade acá (el menor NO
  // se borra), así que se borran en DB (deleteMany) Y en Redis secondaryStorage
  // (revokeUserSessions) — si solo se borra en DB, la copia en Redis seguiría
  // autenticando al menor hasta su TTL.
  // L3 (ciclo 15): revokeUserSessions es fail-closed y devuelve una señal. Si
  // Redis quedó inalcanzable tras el reintento, la copia cacheada podría seguir
  // válida: se loguea (nivel error, ruta crítica) y se propaga sessionsRevoked:
  // false en el body para visibilidad, SIN romper la respuesta al tutor/a (la
  // revocación en DB ya se aplicó: consentRevokedAt + session.deleteMany).
  let sessionsRevoked: boolean | undefined;
  if (consentRevoked === true) {
    await prisma.session.deleteMany({ where: { userId: childId } });
    sessionsRevoked = await revokeUserSessions(childId);
    if (!sessionsRevoked) {
      console.error(
        `[guardian] consent-revoked ${childId}: no se pudieron invalidar las copias de sesión en Redis ` +
          "(Upstash inalcanzable tras el reintento). La sesión cacheada del menor podría seguir válida hasta su TTL.",
      );
    }
  }

  return Response.json({
    ok: true,
    ...(alertsEnabled !== undefined ? { alertsEnabled } : {}),
    ...(consentRevoked !== undefined ? { consentRevoked } : {}),
    ...(sessionsRevoked !== undefined ? { sessionsRevoked } : {}),
  });
}
