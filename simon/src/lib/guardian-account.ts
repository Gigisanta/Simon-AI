/**
 * Núcleo puro de la autoeliminación de la cuenta del tutor/a + sus menores
 * (DELETE /api/guardian/account). Un route file de Next solo puede exportar
 * handlers HTTP, así que la ORQUESTACIÓN de la supresión (verificar contraseña →
 * borrar en transacción → verificar que no quedaron restos → revocar sesiones)
 * vive acá, con sus dependencias de I/O INYECTADAS. Eso permite testear cada
 * desenlace del camino crítico (contraseña incorrecta, éxito con/sin hijos,
 * doble-submit idempotente P2025, borrado incompleto) de forma determinística y
 * sin DB, preservando exactamente el comportamiento de la ruta.
 *
 * CAMINO CRÍTICO (borrado irreversible de datos de menores): ver la ruta.
 */
import { z } from "zod";
import { isRecordNotFoundError } from "@/lib/guardian-children";

// Mensajes de respuesta (constantes para que los tests validen el contrato exacto).
export const PASSWORD_INCORRECT_MESSAGE = "La contraseña no es correcta.";
export const ACCOUNT_DELETE_FAILED_MESSAGE =
  "No se pudo eliminar la cuenta. Probá de nuevo.";
export const ACCOUNT_DELETE_INCOMPLETE_MESSAGE =
  "La eliminación quedó incompleta. Contactá al soporte.";

/**
 * Body del DELETE: confirmación explícita + contraseña actual (re-auth). Nunca
 * confiar en el cliente: `confirm` debe ser el literal `true` y la contraseña
 * viene acotada al mismo rango que el alta (la valida better-auth aparte).
 */
export const accountDeleteSchema = z.object({
  confirm: z.literal(true, { error: "Falta la confirmación explícita." }),
  password: z
    .string()
    .min(1, "Ingresá tu contraseña.")
    .max(72, "Contraseña inválida."),
});

/** Restos post-borrado: deben ser todos 0 o la supresión no fue real. */
export type AccountLeftovers = {
  guardian: number;
  children: number;
  links: number;
};

/**
 * Dependencias de I/O de la supresión, inyectadas por la ruta (prisma/better-auth
 * reales) o por los tests (dobles determinísticos). El orden en que
 * {@link deleteGuardianAccount} las invoca es parte del contrato (p.ej. en el
 * doble-submit P2025 NO se revocan sesiones: la primera request ya lo hizo).
 */
export type AccountDeleteDeps = {
  guardianUserId: string;
  /** Re-auth: rechaza (throw) si la contraseña actual no verifica. */
  verifyPassword: () => Promise<void>;
  /** IDs de los menores a cargo del tutor/a (se borran en la misma transacción). */
  findChildIds: () => Promise<string[]>;
  /** Borrado atómico (menores + tutor/a). Puede lanzar P2025 en doble-submit. */
  deleteAccounts: (childIds: string[]) => Promise<void>;
  /** Conteo post-borrado de tutor/a, menores y vínculos restantes. */
  countLeftovers: (childIds: string[]) => Promise<AccountLeftovers>;
  /** Invalida las sesiones en secondaryStorage de un usuario (no-op sin Upstash). */
  revokeSessions: (userId: string) => Promise<void>;
};

export type AccountDeleteResult = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Decide la respuesta HTTP de la supresión ejecutando las dependencias en el
 * orden del camino crítico. Comportamiento idéntico al de la ruta original:
 *  - contraseña incorrecta (verifyPassword lanza) → 401.
 *  - transacción OK (con o sin hijos) → 200 { ok, deleted } + revoca sesiones.
 *  - P2025 en el borrado (doble-submit) → 200 { ok, alreadyDeleted } SIN revocar.
 *  - otro error de la transacción → 500.
 *  - restos post-borrado (> 0) → 500 (supresión incompleta).
 */
export async function deleteGuardianAccount(
  deps: AccountDeleteDeps,
): Promise<AccountDeleteResult> {
  // RE-AUTH: cualquier fallo del verificador → 401 genérico (no se distingue
  // "contraseña incorrecta" de otros fallos del verificador).
  try {
    await deps.verifyPassword();
  } catch {
    return { status: 401, body: { error: PASSWORD_INCORRECT_MESSAGE } };
  }

  const childIds = await deps.findChildIds();

  try {
    await deps.deleteAccounts(childIds);
  } catch (err) {
    // Doble-submit concurrente: la otra request ya borró al tutor/a → P2025. El
    // efecto deseado ya se cumplió → éxito IDEMPOTENTE (la primera request ya
    // revocó las sesiones; no se repite acá).
    if (isRecordNotFoundError(err)) {
      return { status: 200, body: { ok: true, alreadyDeleted: true } };
    }
    console.error(
      "[guardian] error borrando la cuenta del tutor/a y sus menores:",
      err,
    );
    return { status: 500, body: { error: ACCOUNT_DELETE_FAILED_MESSAGE } };
  }

  // Verificación post-borrado (Ley 25.326: la supresión tiene que ser real).
  const left = await deps.countLeftovers(childIds);
  if (left.guardian > 0 || left.children > 0 || left.links > 0) {
    console.error(
      `[guardian] BORRADO INCOMPLETO de cuenta ${deps.guardianUserId}: [guardian, children, links] = ${left.guardian}, ${left.children}, ${left.links}`,
    );
    return {
      status: 500,
      body: { error: ACCOUNT_DELETE_INCOMPLETE_MESSAGE },
    };
  }

  // L4: invalidar las copias de sesión en Redis (tutor/a + cada menor).
  await Promise.all([
    deps.revokeSessions(deps.guardianUserId),
    ...childIds.map((id) => deps.revokeSessions(id)),
  ]);

  return {
    status: 200,
    body: { ok: true, deleted: { guardian: 1, children: childIds.length } },
  };
}
