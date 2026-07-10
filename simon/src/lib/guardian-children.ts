/**
 * Decisión HTTP pura del alta de un menor (POST /api/guardian/children).
 *
 * La ruta es un CAMINO CRÍTICO (auth + datos de menores) cuya secuencia de I/O
 * (pre-check de username → signUpEmail → traer fila canónica → transacción
 * promoción+consentimiento) no puede volverse pura, pero SÍ el mapeo de cada
 * desenlace a status/mensaje. Extraerlo acá le da cobertura de test y garantiza
 * la invariante clave: los TRES orígenes de "username en uso" (pre-check,
 * carrera post-signup, y el unique P2002 de Guardian) devuelven EXACTAMENTE el
 * mismo 409 y mensaje — un atacante no distingue en cuál de las tres etapas se
 * detectó el duplicado. `guardian.ts` se mantiene sin dependencia de Prisma;
 * el clasificador del error vive acá porque necesita el tipo generado.
 */
import { Prisma } from "@/generated/prisma/client";

export const USERNAME_TAKEN_MESSAGE =
  "Ese nombre de usuario ya está en uso. Probá con otro.";
export const CHILD_CREATE_FAILED_MESSAGE =
  "No se pudo crear la cuenta del menor. Probá de nuevo.";

/**
 * Desenlaces terminales del alta, en el orden en que la ruta los detecta:
 *  - duplicate-precheck     el pre-check de disponibilidad ya vio el username.
 *  - signup-failed          `signUpEmail` (o authorizeChildSignup) lanzó.
 *  - no-canonical-user      tras el signup no se encontró la fila canónica.
 *  - race-already-child     la fila ya era role="child" (carrera con otro alta).
 *  - tx-duplicate-guardian  la transacción violó el unique de Guardian (P2002).
 *  - tx-failed              cualquier otro fallo de la transacción.
 *  - ok                     alta completa.
 */
export type ChildSignupOutcome =
  | "duplicate-precheck"
  | "signup-failed"
  | "no-canonical-user"
  | "race-already-child"
  | "tx-duplicate-guardian"
  | "tx-failed"
  | "ok";

export type ChildSignupHttp = { status: number; error?: string };

/**
 * Mapea el desenlace a su respuesta HTTP. Los tres orígenes de duplicado
 * colapsan en el MISMO 409 + mensaje (anti-diferenciación de etapa); los fallos
 * genéricos comparten el mensaje neutro (400 para el signup, 500 para el resto).
 */
export function childSignupResponse(outcome: ChildSignupOutcome): ChildSignupHttp {
  switch (outcome) {
    case "duplicate-precheck":
    case "race-already-child":
    case "tx-duplicate-guardian":
      return { status: 409, error: USERNAME_TAKEN_MESSAGE };
    case "signup-failed":
      return { status: 400, error: CHILD_CREATE_FAILED_MESSAGE };
    case "no-canonical-user":
    case "tx-failed":
      return { status: 500, error: CHILD_CREATE_FAILED_MESSAGE };
    case "ok":
      return { status: 201 };
  }
}

/**
 * ¿El error de la transacción es el unique de `Guardian.childUserId` (P2002)?
 * Es la carrera en la que el menor ya tenía tutor/a → mismo 409 que un username
 * en uso. Cualquier otro error → tx-failed (500).
 */
export function isGuardianDuplicateError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/** Clasifica el error de la transacción en su desenlace terminal. */
export function classifyChildTxError(
  err: unknown,
): "tx-duplicate-guardian" | "tx-failed" {
  return isGuardianDuplicateError(err) ? "tx-duplicate-guardian" : "tx-failed";
}
