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
import { isRecordNotFoundError } from "@/lib/guardian-children";
import { sameOriginOk } from "@/lib/env-check";
import { revokeUserSessions } from "@/lib/auth-secondary-storage";
import { z } from "zod";

// Borrado irreversible de varias cuentas → tope muy bajo contra errores/scripting.
const DELETE_RATE_LIMIT_PER_MINUTE = 3;

const deleteSchema = z.object({
  // Confirmación explícita (nunca confiar en el cliente).
  confirm: z.literal(true, { error: "Falta la confirmación explícita." }),
  // Re-auth: la contraseña actual del tutor/a. Se valida contra better-auth; acá
  // solo se acota el largo (mismo rango que el alta) para no procesar basura.
  password: z
    .string()
    .min(1, "Ingresá tu contraseña.")
    .max(72, "Contraseña inválida."),
});

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
  const parsed = deleteSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Falta la confirmación o la contraseña ({ confirm: true, password })." },
      { status: 400 },
    );
  }

  // RE-AUTH: la contraseña actual del tutor/a debe verificar (better-auth compara
  // contra el hash de su Account). Un fallo (o cualquier error del verificador) →
  // 401 genérico: no se distingue "contraseña incorrecta" de otros fallos.
  try {
    await auth.api.verifyPassword({
      headers: req.headers,
      body: { password: parsed.data.password },
    });
  } catch {
    return Response.json(
      { error: "La contraseña no es correcta." },
      { status: 401 },
    );
  }

  // Menores a cargo: se borran en la MISMA transacción que el tutor/a.
  const childLinks = await prisma.guardian.findMany({
    where: { guardianUserId },
    select: { childUserId: true },
  });
  const childIds = childLinks.map((l) => l.childUserId);

  try {
    // Transacción atómica: o se borran TODOS (menores + tutor/a) o ninguno. El
    // cascade de cada `user.delete`/`deleteMany` arrastra su data y sus vínculos
    // Guardian; se borran primero los menores y después el tutor/a.
    await prisma.$transaction([
      ...(childIds.length > 0
        ? [prisma.user.deleteMany({ where: { id: { in: childIds } } })]
        : []),
      prisma.user.delete({ where: { id: guardianUserId } }),
    ]);
  } catch (err) {
    // Doble-submit concurrente: otra request ya borró al tutor/a (y a sus menores)
    // casi a la vez → el `user.delete` del tutor/a choca con P2025. El efecto
    // deseado ya se cumplió (la cuenta no existe) → éxito IDEMPOTENTE, no un 500.
    // La primera request ya revocó las sesiones; no hace falta repetirlo.
    if (isRecordNotFoundError(err)) {
      return Response.json({ ok: true, alreadyDeleted: true });
    }
    console.error("[guardian] error borrando la cuenta del tutor/a y sus menores:", err);
    return Response.json(
      { error: "No se pudo eliminar la cuenta. Probá de nuevo." },
      { status: 500 },
    );
  }

  // Verificación post-borrado (Ley 25.326: la supresión tiene que ser real).
  // No deben quedar ni el tutor/a, ni ninguno de sus menores, ni vínculos.
  const [guardianLeft, childrenLeft, linksLeft] = await Promise.all([
    prisma.user.count({ where: { id: guardianUserId } }),
    childIds.length > 0
      ? prisma.user.count({ where: { id: { in: childIds } } })
      : Promise.resolve(0),
    prisma.guardian.count({ where: { guardianUserId } }),
  ]);
  if (guardianLeft > 0 || childrenLeft > 0 || linksLeft > 0) {
    console.error(
      `[guardian] BORRADO INCOMPLETO de cuenta ${guardianUserId}: [guardian, children, links] = ${guardianLeft}, ${childrenLeft}, ${linksLeft}`,
    );
    return Response.json(
      { error: "La eliminación quedó incompleta. Contactá al soporte." },
      { status: 500 },
    );
  }

  // L4: el cascade borró las Session en DB (tutor/a + menores), pero las copias en
  // Redis secondaryStorage seguirían autenticando hasta su TTL. Se invalidan
  // explícitamente para todos (no-op si no hay Upstash configurado).
  await Promise.all([
    revokeUserSessions(guardianUserId),
    ...childIds.map((id) => revokeUserSessions(id)),
  ]);

  return Response.json({
    ok: true,
    deleted: { guardian: 1, children: childIds.length },
  });
}
