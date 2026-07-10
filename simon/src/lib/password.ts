/**
 * Validación de contraseña compartida por los flujos de tutor/a (signup y
 * reseteo). Lógica PURA (sin DB ni framework) → testeable en
 * scripts/password-suite.ts.
 *
 * Los límites ESPEJAN lo que better-auth aplica server-side en estos flujos
 * (emailAndPassword.minPasswordLength: 8 en lib/auth.ts; maxPasswordLength cae al
 * default 128 de better-auth — ver node_modules/.../create-context.mjs). Validar
 * en el cliente da feedback inmediato antes del round-trip, pero NO reemplaza al
 * server: `resetPassword`/`signUpEmail` revalidan y devuelven PASSWORD_TOO_SHORT/
 * PASSWORD_TOO_LONG igual (defensa en profundidad).
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Devuelve un mensaje de error en voseo si la contraseña no cumple, o `null` si
 * es válida. Solo valida longitud: mismo criterio que el signup existente (no se
 * imponen reglas de complejidad que better-auth no aplica).
 */
export function validatePasswordRule(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH)
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  if (password.length > MAX_PASSWORD_LENGTH)
    return `La contraseña es demasiado larga (máximo ${MAX_PASSWORD_LENGTH} caracteres).`;
  return null;
}

/**
 * Valida la contraseña nueva + su confirmación (flujo de reseteo). Devuelve el
 * primer error aplicable (voseo) o `null`. La confirmación se chequea solo si la
 * contraseña base ya es válida, para no mostrar dos errores a la vez.
 */
export function validateNewPassword(
  password: string,
  confirm: string,
): string | null {
  const ruleError = validatePasswordRule(password);
  if (ruleError) return ruleError;
  if (password !== confirm) return "Las contraseñas no coinciden.";
  return null;
}
