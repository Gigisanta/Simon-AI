/**
 * Authz compartida de las rutas del tutor/a. Un route file de Next solo puede
 * exportar handlers HTTP, por eso esto vive en lib y no en la ruta.
 */
import { auth } from "@/lib/auth";

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
