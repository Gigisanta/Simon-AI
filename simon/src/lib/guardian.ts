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

/**
 * email (lowercase) → expiración (epoch ms).
 *
 * INVARIANTE SINGLE-PROCESS (a propósito, no un bug): este Map vive en la memoria
 * de UN proceso. Funciona porque emisor y consumidor SIEMPRE comparten proceso:
 * el endpoint del tutor/a llama `authorizeChildSignup(email)` e inmediatamente
 * después `auth.api.signUpEmail`, que es una llamada IN-PROCESS (no HTTP) — el
 * hook `databaseHooks.user.create.before` que consume corre en el mismo módulo,
 * incluso en serverless (una sola invocación atiende ambos). No cruza instancias
 * ni sobrevive a un reinicio, y no hace falta que lo haga: la ventana emitir→
 * consumir es de microsegundos dentro de la misma request, con TTL de 30s como
 * red de seguridad. NO migrar esto a Redis/secondaryStorage: sería complejidad
 * innecesaria (y una señal que un cliente externo NO puede replicar es justo el
 * punto — ver C1 abajo). Si alguna vez el consumo dejara de ser in-process, esta
 * invariante se rompería y habría que repensar el mecanismo.
 */
const authorizedChildSignups = new Map<string, number>();

/**
 * Barrido oportunista de entradas vencidas. Sin esto, un alta que falla DESPUÉS
 * de autorizar pero ANTES de consumir (p.ej. `signUpEmail` lanza) dejaría la
 * entrada colgada para siempre: el TTL se chequea al consumir, pero si nadie
 * consume nunca, nunca se evicta y el Map crece sin techo (fuga de memoria).
 *
 * Se hace en el propio flujo (no con setTimeout) a propósito: en serverless los
 * timers no sobreviven al fin de la request, y el volumen de altas de menores
 * es bajo, así que iterar el Map en cada llamada es trivial. Una entrada está
 * vencida cuando `now > expiresAt`; el borde exacto (`now === expiresAt`) sigue
 * siendo válido y NO se barre — misma semántica que `consume`.
 */
function sweepExpiredChildSignups(now: number): void {
  for (const [key, expiresAt] of authorizedChildSignups) {
    if (expiresAt < now) authorizedChildSignups.delete(key);
  }
}

/**
 * Autoriza UN alta del email sintético dado. Llamar SOLO desde el flujo
 * server-side del tutor/a, justo antes de `auth.api.signUpEmail`.
 * `now` se inyecta para poder testear de forma determinística.
 */
export function authorizeChildSignup(email: string, now: number = Date.now()): void {
  sweepExpiredChildSignups(now);
  authorizedChildSignups.set(email.toLowerCase(), now + CHILD_SIGNUP_AUTH_TTL_MS);
}

/**
 * Cantidad de autorizaciones pendientes en memoria. Solo para observabilidad y
 * para que las suites verifiquen la eviction del barrido; no es parte del flujo.
 */
export function pendingChildSignupCount(): number {
  return authorizedChildSignups.size;
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
  // Barrido oportunista del resto de entradas vencidas (evita la fuga de altas
  // autorizadas pero nunca consumidas). No altera la semántica de ESTA entrada:
  // se resuelve explícitamente abajo, borrándola siempre que exista.
  sweepExpiredChildSignups(now);
  if (expiresAt === undefined) return false;
  authorizedChildSignups.delete(key);
  return now <= expiresAt;
}

// Franja etaria razonable para Simón (6–18 con holgura): edad 4..19.
export const MIN_CHILD_AGE = 4;
export const MAX_CHILD_AGE = 19;

/**
 * Edad derivada del AÑO de nacimiento (minimización de datos), acotada a la
 * franja [MIN_CHILD_AGE, MAX_CHILD_AGE]; sin dato válido o fuera de rango →
 * undefined. Usa getUTCFullYear() a propósito: en runtime serverless el "año
 * actual" no debe depender del huso horario del proceso (getFullYear() daría un
 * año distinto cerca de fin de año según la TZ y correría la edad ±1).
 */
export function deriveChildAge(
  birthYear: number | null | undefined,
  now: Date,
): number | undefined {
  if (typeof birthYear !== "number" || !Number.isInteger(birthYear)) return undefined;
  const age = now.getUTCFullYear() - birthYear;
  return age >= MIN_CHILD_AGE && age <= MAX_CHILD_AGE ? age : undefined;
}

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
