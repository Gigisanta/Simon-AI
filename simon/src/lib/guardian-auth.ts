/**
 * Authz compartida de las rutas del tutor/a. Un route file de Next solo puede
 * exportar handlers HTTP, por eso esto vive en lib y no en la ruta.
 */
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

export type GuardianSessionUser = {
  id: string;
  role?: string | null;
  emailVerified: boolean;
};

/**
 * Sesión de tutor/a, o una Response de error lista para devolver.
 *
 * `requireVerifiedEmail` (default true) exige email verificado — necesario
 * para dar de alta menores. Las operaciones que ejercen DERECHOS del titular
 * (supresión de datos, Ley 25.326 art. 16) lo pasan en false: un derecho no
 * puede quedar bloqueado por un email sin verificar.
 */
export async function requireGuardian(
  req: Request,
  { requireVerifiedEmail = true }: { requireVerifiedEmail?: boolean } = {},
): Promise<
  | { ok: true; user: GuardianSessionUser }
  | { ok: false; response: Response }
> {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: "No autenticado" }, { status: 401 }),
    };
  }
  const user = session.user;
  if (user.role !== "guardian") {
    return {
      ok: false,
      response: Response.json(
        { error: "Solo un tutor/a puede gestionar menores." },
        { status: 403 },
      ),
    };
  }
  if (requireVerifiedEmail && !user.emailVerified) {
    return {
      ok: false,
      response: Response.json(
        { error: "Verificá tu email antes de dar de alta a un menor." },
        { status: 403 },
      ),
    };
  }
  return { ok: true, user };
}

/**
 * Cliente mínimo (solo el delegate `guardian.findFirst`) que necesita
 * {@link findOwnedChild}. Tiparlo así permite inyectar un fake determinístico en
 * los tests sin arrastrar el tipo completo (y muy complejo) de `PrismaClient`.
 */
export type GuardianOwnershipClient = {
  guardian: {
    findFirst: (args: {
      where: {
        guardianUserId: string;
        childUserId: string;
        childUser: { role: "child" };
      };
      select: Prisma.GuardianSelect;
    }) => Promise<unknown>;
  };
};

/**
 * Vínculo de tutela del par (tutor de la sesión, childId), o null si el childId
 * no existe, no es un menor, o no está a cargo de este tutor/a — los tres casos
 * colapsan en null (y el caller responde 404) para no revelar la existencia de
 * cuentas ajenas.
 *
 * INVARIANTE DE AUTORIZACIÓN (idéntica en las tres rutas del tutor/a): el `where`
 * exige SIEMPRE los tres constraints juntos — `guardianUserId` (dueño),
 * `childUserId` (el menor pedido) y `childUser.role === "child"` (que sea un
 * menor, no otro rol). Quitar cualquiera abriría un IDOR. El `select` es lo único
 * que varía por ruta (de ahí el parámetro `select` genérico), sin tocar la
 * autorización.
 *
 * @param select  proyección de campos por ruta (id, perfil para export, etc.).
 * @param client  inyectable solo para tests; en producción usa el `prisma` real.
 */
export function findOwnedChild<S extends Prisma.GuardianSelect>(
  guardianUserId: string,
  childId: string,
  select: S,
  client?: GuardianOwnershipClient,
): Promise<Prisma.GuardianGetPayload<{ select: S }> | null> {
  const db = client ?? (prisma as unknown as GuardianOwnershipClient);
  return db.guardian.findFirst({
    where: {
      guardianUserId,
      childUserId: childId,
      childUser: { role: "child" },
    },
    select,
  }) as Promise<Prisma.GuardianGetPayload<{ select: S }> | null>;
}
