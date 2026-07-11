/**
 * Suite de consent.ts (M-P1, Ley 25.326) — gate del acceso al chat del menor.
 *
 *   pnpm consent-suite
 *
 * Testea SOLO lógica pura y determinística (sin DB, sin red): la decisión de
 * `canChat`, el mapeo `blockedChatMessage`, y la clasificación de errores de
 * Prisma (`isRaceDeletionError`, `isUniqueConstraintError`). El wrapper con DB
 * `canUserChat` queda fuera (necesitaría Prisma real). El import es seguro sin
 * DATABASE_URL: `@/lib/prisma` es lazy vía Proxy y acá no se dispara ninguna query.
 *
 * Camino crítico de seguridad: un menor sin consentimiento verificable —o con el
 * consentimiento revocado— NO debe poder chatear. La distinción de errores de
 * carrera (borrado del menor mid-request) vs. constraint única (doble submit)
 * gobierna si la respuesta del LLM se entrega o se descarta. Sale con código 1 si
 * algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import { Prisma } from "../src/generated/prisma/client";
import {
  canChat,
  blockedChatMessage,
  isRaceDeletionError,
  isUniqueConstraintError,
  NO_GUARDIAN_CHAT_REPLY,
} from "../src/lib/consent";

const { check, done } = createChecker("Consent suite");

const NOW = new Date("2026-01-01T00:00:00Z");

// Construye un error conocido de Prisma con un código dado (shape real del SDK).
function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: "test",
  });
}

// ---------- 1. canChat: política de acceso ----------
{
  // No-menores pasan siempre, con o sin guardian.
  check(canChat("guardian", null).ok === true, "guardian → ok (no requiere consentimiento)");
  check(canChat(null, null).ok === true, "role null → ok");
  check(canChat(undefined, null).ok === true, "role undefined → ok");
  check(canChat("admin", null).ok === true, "otro rol → ok");

  // Menor sin vínculo de tutela → no-guardian (huérfano).
  {
    const d = canChat("child", null);
    check(d.ok === false && !d.ok && d.reason === "no-guardian", "child sin guardian → no-guardian");
  }

  // Menor con guardian pero sin consentimiento registrado → no-consent.
  {
    const d = canChat("child", { consentAt: null });
    check(d.ok === false && !d.ok && d.reason === "no-consent", "child con consentAt null → no-consent");
  }

  // Menor con consentimiento válido → ok.
  {
    const d = canChat("child", { consentAt: NOW });
    check(d.ok === true, "child con consentAt → ok");
  }

  // Consentimiento revocado GANA sobre consentAt presente → consent-revoked.
  {
    const d = canChat("child", { consentAt: NOW, consentRevokedAt: NOW });
    check(
      d.ok === false && !d.ok && d.reason === "consent-revoked",
      "child con consentAt + consentRevokedAt → consent-revoked (revocación gana)",
    );
  }

  // Sin consentAt PERO con revocación: no-consent se evalúa primero.
  {
    const d = canChat("child", { consentAt: null, consentRevokedAt: NOW });
    check(
      d.ok === false && !d.ok && d.reason === "no-consent",
      "child sin consentAt (aunque haya revocación) → no-consent (precede)",
    );
  }

  // consentRevokedAt null explícito no bloquea.
  {
    const d = canChat("child", { consentAt: NOW, consentRevokedAt: null });
    check(d.ok === true, "child con consentAt y consentRevokedAt null → ok");
  }
}

// ---------- 2. blockedChatMessage: mapeo a texto amable ----------
{
  check(
    blockedChatMessage("no-guardian") === NO_GUARDIAN_CHAT_REPLY,
    "no-guardian → mensaje explicativo del huérfano",
  );
  check(blockedChatMessage("no-consent") === null, "no-consent → null (cae al 403 genérico)");
  check(blockedChatMessage("consent-revoked") === null, "consent-revoked → null (403 genérico)");
  check(blockedChatMessage("cualquier-otra") === null, "motivo desconocido → null");
}

// ---------- 3. isRaceDeletionError: borrado del menor mid-request ----------
{
  check(isRaceDeletionError(prismaError("P2003")) === true, "P2003 (FK) → carrera de borrado");
  check(isRaceDeletionError(prismaError("P2025")) === true, "P2025 (no existe) → carrera de borrado");
  check(isRaceDeletionError(prismaError("P2002")) === false, "P2002 (unique) → NO es carrera de borrado");
  check(isRaceDeletionError(new Error("boom")) === false, "Error genérico → NO es carrera de borrado");
  check(isRaceDeletionError(null) === false, "null → NO es carrera de borrado");
  check(isRaceDeletionError(undefined) === false, "undefined → NO es carrera de borrado");
  check(isRaceDeletionError("P2025") === false, "string con código → NO (debe ser instancia de Prisma)");
}

// ---------- 4. isUniqueConstraintError: doble submit del primer mensaje ----------
{
  check(isUniqueConstraintError(prismaError("P2002")) === true, "P2002 → constraint única");
  check(isUniqueConstraintError(prismaError("P2003")) === false, "P2003 → NO es constraint única");
  check(isUniqueConstraintError(prismaError("P2025")) === false, "P2025 → NO es constraint única");
  check(isUniqueConstraintError(new Error("duplicate")) === false, "Error genérico → NO");
  check(isUniqueConstraintError(null) === false, "null → NO");
}

done();
