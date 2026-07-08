/**
 * Modelo tutor-first: el menor NUNCA se registra solo. El tutor/a lo da de
 * alta desde su panel. El menor no tiene email real: se le arma un email
 * sintético determinístico en el dominio `.invalid` (RFC 6761: nunca ruteable),
 * y se loguea con "usuario" + contraseña que fija el tutor/a.
 *
 * Este módulo es lógica pura (sin DB): validación del alta + construcción del
 * email sintético. Se testea en scripts/guardian-suite.ts.
 */
import { z } from "zod";

/** Dominio sintético para menores. `.invalid` jamás resuelve ni es ruteable. */
export const CHILD_EMAIL_DOMAIN = "ninos.simon.invalid";

/**
 * Arma el email sintético determinístico del menor a partir del usuario.
 * El menor nunca ve ni usa este email: es solo la clave interna de better-auth.
 */
export function childEmail(username: string): string {
  return `${username}@${CHILD_EMAIL_DOMAIN}`;
}

/** Deriva el "usuario" visible a partir del email sintético guardado. */
export function usernameFromEmail(email: string): string {
  const suffix = `@${CHILD_EMAIL_DOMAIN}`;
  return email.endsWith(suffix) ? email.slice(0, -suffix.length) : email;
}

/**
 * True si el email pertenece al dominio sintético de menores.
 * Case-insensitive a propósito: un atacante podría intentar
 * "x@NINOS.SIMON.INVALID" para eludir el guard de signup (F1).
 */
export function isChildEmail(email: string): boolean {
  return email.toLowerCase().endsWith(`@${CHILD_EMAIL_DOMAIN}`);
}

// ---------------------------------------------------------------------------
// Autorización interna de alta de menores (C1 — bloqueo de signup público).
//
// El hook `databaseHooks.user.create.before` de better-auth (lib/auth.ts)
// RECHAZA toda creación de usuario con email sintético de menor, SALVO que el
// email haya sido autorizado acá por el flujo server-side del tutor/a
// (app/api/guardian/children/route.ts) inmediatamente antes de llamar a
// `auth.api.signUpEmail`.
//
// Mecanismo: registro en memoria del proceso, de un solo uso y con TTL corto.
// Como `auth.api.signUpEmail` es una llamada in-process (no HTTP), el endpoint
// y el hook comparten SIEMPRE el mismo proceso/módulo, incluso en serverless.
// Un cliente externo NO puede replicar esta señal: no viaja en headers ni en
// el body — solo existe en la memoria del servidor.
//
// - Un solo uso: `consume` borra la entrada (una autorización = un alta).
// - TTL corto: si signUpEmail falla después de autorizar, la entrada muere
//   sola y no queda una autorización colgada explotable.
// ---------------------------------------------------------------------------

const CHILD_SIGNUP_AUTH_TTL_MS = 30_000;

/** email (lowercase) → expiración (epoch ms). */
const authorizedChildSignups = new Map<string, number>();

/**
 * Autoriza UN alta del email sintético dado. Llamar SOLO desde el flujo
 * server-side del tutor/a, justo antes de `auth.api.signUpEmail`.
 * `now` se inyecta para poder testear de forma determinística.
 */
export function authorizeChildSignup(email: string, now: number = Date.now()): void {
  authorizedChildSignups.set(email.toLowerCase(), now + CHILD_SIGNUP_AUTH_TTL_MS);
}

/**
 * Consume (de forma atómica y de un solo uso) la autorización del email.
 * Devuelve true si estaba autorizado y vigente. La entrada se borra siempre
 * que exista (vencida o no): nunca queda reutilizable.
 */
export function consumeChildSignupAuthorization(
  email: string,
  now: number = Date.now(),
): boolean {
  const key = email.toLowerCase();
  const expiresAt = authorizedChildSignups.get(key);
  if (expiresAt === undefined) return false;
  authorizedChildSignups.delete(key);
  return now <= expiresAt;
}

// Franja etaria razonable para Simón (6–18 con holgura): edad 4..19.
export const MIN_CHILD_AGE = 4;
export const MAX_CHILD_AGE = 19;

/**
 * Valida el body de alta de un menor. `currentYear` se inyecta para poder
 * testear de forma determinística (por defecto, el año actual).
 */
export function buildCreateChildSchema(currentYear: number = new Date().getFullYear()) {
  // edad = currentYear - birthYear ∈ [MIN_CHILD_AGE, MAX_CHILD_AGE]
  const minYear = currentYear - MAX_CHILD_AGE;
  const maxYear = currentYear - MIN_CHILD_AGE;
  return z.object({
    name: z.string().trim().min(1, "Ingresá un nombre").max(60, "El nombre es muy largo"),
    username: z
      .string()
      .regex(
        /^[a-z0-9_]{3,24}$/,
        "El usuario debe tener 3 a 24 caracteres: minúsculas, números o guion bajo.",
      ),
    birthYear: z
      .number()
      .int("Año inválido")
      .min(minYear, `El año de nacimiento debe ser ${minYear} o posterior`)
      .max(maxYear, `El año de nacimiento debe ser ${maxYear} o anterior`),
    password: z
      .string()
      .min(8, "La contraseña debe tener al menos 8 caracteres")
      .max(72, "La contraseña es demasiado larga"),
    consent: z.literal(true, {
      error: "Necesitás confirmar el consentimiento como tutor/a legal.",
    }),
  });
}

/** Schema con el año actual (uso en runtime del endpoint). */
export const createChildSchema = buildCreateChildSchema();

export type CreateChildInput = z.infer<typeof createChildSchema>;
