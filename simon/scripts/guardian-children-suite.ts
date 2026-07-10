/**
 * Suite de la decisión HTTP del alta de menores (POST /api/guardian/children).
 * Sin framework — tsx.
 *
 *   pnpm test guardian-children
 *
 * CAMINO CRÍTICO (auth + datos de menores). Cubre la lógica pura extraída en
 * src/lib/guardian-children.ts:
 *
 *   (1) 409 "username en uso" desde los TRES orígenes (pre-check, carrera
 *       post-signup, unique P2002 de Guardian) → EXACTAMENTE el mismo status y
 *       mensaje (un atacante no distingue en qué etapa se detectó el duplicado).
 *   (2) clasificación del error de la transacción: P2002 → 409, resto → 500.
 *   (3) los desenlaces de fallo genérico comparten el mensaje neutro.
 *
 * El token de autorización de un solo uso (authorizeChildSignup /
 * consumeChildSignupAuthorization) ya está cubierto exhaustivamente en
 * guardian-suite.ts (un solo uso, TTL, case-insensitive, barrido); acá se agrega
 * solo el borde exacto now === expiresAt, que ahí no se testeaba explícito.
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import { Prisma } from "../src/generated/prisma/client";
import {
  childSignupResponse,
  classifyChildTxError,
  isGuardianDuplicateError,
  USERNAME_TAKEN_MESSAGE,
  CHILD_CREATE_FAILED_MESSAGE,
  type ChildSignupOutcome,
} from "../src/lib/guardian-children";
import {
  authorizeChildSignup,
  consumeChildSignupAuthorization,
  childEmail,
} from "../src/lib/guardian";

const { check, done } = createChecker("Guardian-children suite");

// ---------- (1) Los TRES orígenes de duplicado → mismo 409 + mensaje ----------
const DUPLICATE_ORIGINS: ChildSignupOutcome[] = [
  "duplicate-precheck",
  "race-already-child",
  "tx-duplicate-guardian",
];
for (const origin of DUPLICATE_ORIGINS) {
  const r = childSignupResponse(origin);
  check(r.status === 409, `${origin} → status 409`);
  check(
    r.error === USERNAME_TAKEN_MESSAGE,
    `${origin} → mensaje "username en uso" (no delata la etapa)`,
  );
}
// Invariante anti-diferenciación: las tres respuestas son idénticas byte a byte.
const responses = DUPLICATE_ORIGINS.map((o) => JSON.stringify(childSignupResponse(o)));
check(
  new Set(responses).size === 1,
  "los tres 409 son indistinguibles entre sí (mismo status + mensaje)",
);

// ---------- (2) Fallos genéricos: status correcto y mensaje neutro ----------
{
  const signup = childSignupResponse("signup-failed");
  check(signup.status === 400, "signup-failed → 400");
  check(signup.error === CHILD_CREATE_FAILED_MESSAGE, "signup-failed → mensaje neutro");

  const noUser = childSignupResponse("no-canonical-user");
  check(noUser.status === 500, "no-canonical-user → 500");
  check(noUser.error === CHILD_CREATE_FAILED_MESSAGE, "no-canonical-user → mensaje neutro");

  const txFailed = childSignupResponse("tx-failed");
  check(txFailed.status === 500, "tx-failed → 500");
  check(txFailed.error === CHILD_CREATE_FAILED_MESSAGE, "tx-failed → mensaje neutro");

  // El mensaje neutro NO revela nada del username (no es el de duplicado).
  check(
    (CHILD_CREATE_FAILED_MESSAGE as string) !== USERNAME_TAKEN_MESSAGE,
    "el mensaje de fallo genérico es distinto del de duplicado",
  );
}

// ---------- (3) Éxito ----------
{
  const ok = childSignupResponse("ok");
  check(ok.status === 201, "ok → 201");
  check(ok.error === undefined, "ok → sin campo error");
}

// ---------- (4) classifyChildTxError / isGuardianDuplicateError ----------
{
  // P2002 real de Prisma → duplicado (409).
  const p2002 = new Prisma.PrismaClientKnownRequestError("unique violation", {
    code: "P2002",
    clientVersion: "test",
  });
  check(isGuardianDuplicateError(p2002) === true, "P2002 → isGuardianDuplicateError true");
  check(
    classifyChildTxError(p2002) === "tx-duplicate-guardian",
    "P2002 → clasifica como tx-duplicate-guardian (409)",
  );

  // Otro código conocido de Prisma (p.ej. P2025) → NO es duplicado → 500.
  const p2025 = new Prisma.PrismaClientKnownRequestError("not found", {
    code: "P2025",
    clientVersion: "test",
  });
  check(isGuardianDuplicateError(p2025) === false, "P2025 → no es duplicado");
  check(classifyChildTxError(p2025) === "tx-failed", "P2025 → tx-failed (500)");

  // Error genérico (no-Prisma) → tx-failed.
  check(isGuardianDuplicateError(new Error("boom")) === false, "Error común → no duplicado");
  check(classifyChildTxError(new Error("boom")) === "tx-failed", "Error común → tx-failed");
  check(classifyChildTxError(null) === "tx-failed", "null → tx-failed (no crashea)");
  check(
    classifyChildTxError({ code: "P2002" }) === "tx-failed",
    "objeto duck-typed con code P2002 pero no-instanceof → tx-failed (no se confunde)",
  );

  // Cierre del ciclo P2002 → misma respuesta 409 que el pre-check.
  check(
    JSON.stringify(childSignupResponse(classifyChildTxError(p2002))) ===
      JSON.stringify(childSignupResponse("duplicate-precheck")),
    "P2002 en la transacción produce el MISMO 409 que el pre-check de duplicado",
  );
}

// ---------- (5) Token de un solo uso: borde exacto now === expiresAt ----------
// Gap no cubierto en guardian-suite: la entrada sigue siendo válida en el
// instante exacto de expiración (consume usa now <= expiresAt).
{
  const email = childEmail("borde_ttl");
  const t0 = 2_000_000;
  authorizeChildSignup(email, t0); // expira en t0 + 30_000
  check(
    consumeChildSignupAuthorization(email, t0 + 30_000) === true,
    "token: now === expiresAt sigue siendo válido (borde inclusivo)",
  );
  // Y un microsegundo después ya no (y de todos modos era de un solo uso).
  authorizeChildSignup(email, t0);
  check(
    consumeChildSignupAuthorization(email, t0 + 30_001) === false,
    "token: now === expiresAt + 1 → vencido",
  );
}

done();
