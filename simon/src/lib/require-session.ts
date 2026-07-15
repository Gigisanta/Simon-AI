/**
 * `requireSession()` — chequeo de sesión compartido (ADR-8, arch M5).
 *
 * Helper único para las rutas API autenticadas: elimina el par
 * `getSession + if (!session) 401` duplicado en 8+ handlers y garantiza un
 * 401 UNIFORME (mismo body, mismo status, `cache-control: no-store` para que
 * ningún intermediario cachee la respuesta de "no autenticado").
 *
 * Sin cambio de semántica: mismo `auth.api.getSession` sobre los headers del
 * request; la sesión devuelta queda tipada (narrowing por unión discriminada).
 *
 * Uso:
 *   const { session, response } = await requireSession(req);
 *   if (!session) return response;
 *   // acá `session` está narrowed (no-null) y tipada.
 */
import { auth } from "@/lib/auth";

/** Sesión no-nula tal como la tipa better-auth (user + session). */
export type AuthSession = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>;

export type SessionCheck =
  | { session: AuthSession; response: null }
  | { session: null; response: Response };

/** 401 uniforme para TODAS las rutas autenticadas (único punto de verdad). */
export function unauthenticatedResponse(): Response {
  return Response.json(
    { error: "No autenticado" },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}

/**
 * Resuelve la sesión del request o produce el 401 uniforme.
 * Nunca lanza: cualquier fallo de better-auth se traduce en 401 (fail-closed).
 */
export async function requireSession(req: Request): Promise<SessionCheck> {
  let session: AuthSession | null = null;
  try {
    session = await auth.api.getSession({ headers: req.headers });
  } catch {
    // Fail-closed: un error interno de auth NUNCA deja pasar sin sesión.
    session = null;
  }
  if (!session) return { session: null, response: unauthenticatedResponse() };
  return { session, response: null };
}
