/**
 * Suite ejecutable de la validación de contraseña (sin framework — tsx).
 *
 *   pnpm test password
 *
 * Testea la lógica PURA de src/lib/password.ts: los límites de longitud
 * (min 8 / max 128, que espejan lo que better-auth aplica server-side en el
 * signup y el reseteo del tutor/a) y el chequeo de confirmación del flujo de
 * reseteo. Camino crítico de auth: una regresión que afloje el mínimo dejaría
 * pasar contraseñas que el server igual rechaza (mala UX) o, peor, desalinearía
 * el feedback del reseteo.
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
import { createChecker } from "./suite-helpers";
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  validatePasswordRule,
  validateNewPassword,
} from "../src/lib/password";

const { check, done } = createChecker("Password suite");

// ---------- validatePasswordRule: longitud ----------
{
  // Borde exacto: 7 falla, 8 pasa (off-by-one del mínimo).
  check(validatePasswordRule("a".repeat(MIN_PASSWORD_LENGTH - 1)) !== null, "7 chars → error");
  check(validatePasswordRule("a".repeat(MIN_PASSWORD_LENGTH)) === null, "8 chars (mínimo exacto) → OK");
  check(validatePasswordRule("") !== null, "vacía → error");

  // Borde exacto del máximo: 128 pasa, 129 falla.
  check(validatePasswordRule("a".repeat(MAX_PASSWORD_LENGTH)) === null, "128 chars (máximo exacto) → OK");
  check(validatePasswordRule("a".repeat(MAX_PASSWORD_LENGTH + 1)) !== null, "129 chars → error");

  // El mensaje es en voseo/español y menciona el mínimo (no jerga en inglés).
  const short = validatePasswordRule("abc") ?? "";
  check(short.includes(String(MIN_PASSWORD_LENGTH)), "mensaje corto menciona el mínimo");
  check(!/password|short|long/i.test(short), "mensaje corto no filtra texto en inglés");
}

// ---------- validateNewPassword: confirmación ----------
{
  const valid = "unaClaveSegura1";
  check(validateNewPassword(valid, valid) === null, "coinciden y válida → OK");

  // Longitud manda ANTES que la coincidencia: una contraseña corta reporta el
  // error de longitud aunque la confirmación no coincida (un solo error a la vez).
  const shortErr = validateNewPassword("abc", "otra");
  check(shortErr !== null && shortErr.includes(String(MIN_PASSWORD_LENGTH)), "corta → error de longitud primero");

  // Válida en longitud pero no coincide → error de coincidencia.
  const mismatch = validateNewPassword(valid, `${valid}x`);
  check(mismatch !== null && mismatch.toLowerCase().includes("coincid"), "no coinciden → error de coincidencia");
}

done();
