/**
 * Autoeliminación de la cuenta del tutor/a (derecho de supresión, Ley 25.326
 * art. 16) — y, con ella, la de TODOS los menores a su cargo.
 *
 * DELETE → en UNA transacción atómica borra sincrónicamente:
 *          (1) la cuenta de cada menor del tutor/a (cascade arrastra sus
 *              conversaciones/mensajes/memorias/eventos/sesiones + el vínculo
 *              Guardian), y
 *          (2) la cuenta del propio tutor/a (cascade arrastra sus sesiones,
 *              cuentas, conversaciones y cualquier vínculo Guardian restante).
 *
 * MOTIVO (CRÍTICO — supervisión de menores): el cascade de `Guardian` al borrar
 * un tutor/a elimina SOLO la fila del vínculo, no la del menor. Sin este endpoint,
 * un tutor/a que se da de baja dejaría a sus hijos como filas `User` role "child"
 * HUÉRFANAS, activas y sin supervisión (el barrido de retention.ts recién las
 * purga a los 30 días). Acá se borran de inmediato y en la misma transacción, de
 * modo que nunca queda un menor chateando sin adulto responsable.
 *
 * CAMINO CRÍTICO (borrado irreversible de datos de menores + re-auth):
 *  - Sesión de tutor/a requerida (requireGuardian). Supresión = derecho del
 *    titular: NO se bloquea por email sin verificar.
 *  - RE-AUTH: exige la contraseña actual del tutor/a (verificada por better-auth,
 *    `auth.api.verifyPassword`) + `{ confirm: true }` literal en el body. Una
 *    acción irreversible que borra varias cuentas no puede depender solo de la
 *    cookie de sesión.
 *  - Rate-limit estricto (ráfaga/scripting).
 *  - Verificación post-borrado: la supresión tiene que ser REAL (sin restos).
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitMessage } from "@/lib/ui-messages";
import { requireGuardian } from "@/lib/guardian-auth";
import { sameOriginOk } from "@/lib/env-check";
import { revokeUserSessions } from "@/lib/auth-secondary-storage";
import { accountDeleteSchema, deleteGuardianAccount } from "@/lib/guardian-account";

// Borrado irreversible de varias cuentas → tope muy bajo contra errores/scripting.
const DELETE_RATE_LIMIT_PER_MINUTE = 3;

export async function DELETE(req: Request) {
  // Defensa CSRF en profundidad (M3): Origin cross-site → 403.
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  // Supresión = derecho del titular (art. 16): no se bloquea por email sin
  // verificar. La identidad la garantiza la sesión + la re-auth por contraseña.
  const guard = await requireGuardian(req, { requireVerifiedEmail: false });
  if (!guard.ok) return guard.response;
  const guardianUserId = guard.user.id;

  const rl = await checkRateLimit(
    `guardian:account-delete:${guardianUserId}`,
    DELETE_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: rateLimitMessage("intentos", "m") },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  // Body: confirmación + contraseña (nunca confiar en el cliente).
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = accountDeleteSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Falta la confirmación o la contraseña ({ confirm: true, password })." },
      { status: 400 },
    );
  }

  // La orquestación (re-auth → transacción → verificación post-borrado → revoca
  // sesiones) vive en @/lib/guardian-account (puro y testeable). Acá se inyectan
  // las dependencias de I/O reales (better-auth + prisma + secondaryStorage). El
  // cascade de cada `user.delete`/`deleteMany` arrastra su data y sus vínculos
  // Guardian; se borran primero los menores y después el tutor/a.
  const result = await deleteGuardianAccount({
    guardianUserId,
    verifyPassword: async () => {
      await auth.api.verifyPassword({
        headers: req.headers,
        body: { password: parsed.data.password },
      });
    },
    findChildIds: async () => {
      const childLinks = await prisma.guardian.findMany({
        where: { guardianUserId },
        select: { childUserId: true },
      });
      return childLinks.map((l) => l.childUserId);
    },
    deleteAccounts: async (childIds) => {
      await prisma.$transaction([
        ...(childIds.length > 0
          ? [prisma.user.deleteMany({ where: { id: { in: childIds } } })]
          : []),
        prisma.user.delete({ where: { id: guardianUserId } }),
      ]);
    },
    countLeftovers: async (childIds) => {
      const [guardian, children, links] = await Promise.all([
        prisma.user.count({ where: { id: guardianUserId } }),
        childIds.length > 0
          ? prisma.user.count({ where: { id: { in: childIds } } })
          : Promise.resolve(0),
        prisma.guardian.count({ where: { guardianUserId } }),
      ]);
      return { guardian, children, links };
    },
    revokeSessions: async (userId) => {
      await revokeUserSessions(userId);
    },
  });

  return Response.json(result.body, { status: result.status });
}
