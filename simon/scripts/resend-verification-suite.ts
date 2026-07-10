/**
 * Suite del CTA de reenvío del email de verificación (lib/resend-verification.ts)
 * — hallazgo del ciclo 25. Sin framework (tsx); prueba la lógica pura extraída del
 * componente TutorPanel inyectando un `send` falso y grabando las transiciones de
 * estado y el mensaje mostrado.
 *
 *   pnpm resend-verification-suite
 *
 * Cubre lo que decide la UI del CTA:
 *   1. mapResendError: 429 → copy de rate-limit; cualquier otro (EMAIL_MISMATCH,
 *      ya verificado, red) → genérico.
 *   2. runResendFlow: éxito → loading→sent (+ onSent para el cooldown, sin
 *      mensaje de error); error 429 → loading→error con el copy de rate-limit;
 *      error EMAIL_MISMATCH → loading→error con el copy genérico.
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import {
  mapResendError,
  runResendFlow,
  type ResendError,
  type ResendState,
} from "../src/lib/resend-verification";
import {
  rateLimitMessage,
  RESEND_VERIFICATION_GENERIC_ERROR,
} from "../src/lib/ui-messages";

const { check, done } = createChecker("Resend-verification suite");

const RATE_LIMIT_COPY = rateLimitMessage("emails", "m");

// Corre un flujo grabando cada setState/setMessage en orden, con el `send` dado.
async function drive(send: () => Promise<{ error: ResendError }>) {
  const states: ResendState[] = [];
  const messages: (string | null)[] = [];
  let sentCalls = 0;
  await runResendFlow({
    send,
    setState: (s) => states.push(s),
    setMessage: (m) => messages.push(m),
    onSent: () => {
      sentCalls += 1;
    },
  });
  return { states, messages, sentCalls };
}

async function main() {
  // ---------- 1. mapResendError ----------
  check(
    mapResendError({ status: 429 }) === RATE_LIMIT_COPY,
    "mapResendError: status 429 → copy de rate-limit",
  );
  check(
    mapResendError({ statusCode: 429 }) === RATE_LIMIT_COPY,
    "mapResendError: statusCode 429 (fallback) → copy de rate-limit",
  );
  check(
    mapResendError({ status: 400, code: "EMAIL_MISMATCH" }) ===
      RESEND_VERIFICATION_GENERIC_ERROR,
    "mapResendError: EMAIL_MISMATCH (400) → copy genérico",
  );
  check(
    mapResendError({ status: 500 }) === RESEND_VERIFICATION_GENERIC_ERROR,
    "mapResendError: 5xx → copy genérico",
  );
  check(
    mapResendError(undefined) === RESEND_VERIFICATION_GENERIC_ERROR,
    "mapResendError: sin status → copy genérico",
  );
  // El copy de rate-limit y el genérico son distintos (no colapsan a lo mismo).
  check(
    RATE_LIMIT_COPY !== RESEND_VERIFICATION_GENERIC_ERROR,
    "mapResendError: rate-limit y genérico son mensajes distintos",
  );

  // ---------- 2. runResendFlow: éxito → loading → sent ----------
  {
    const { states, messages, sentCalls } = await drive(async () => ({
      error: null,
    }));
    check(
      JSON.stringify(states) === JSON.stringify(["loading", "sent"]),
      "éxito: transición loading → sent",
    );
    check(
      messages.length === 1 && messages[0] === null,
      "éxito: limpia el mensaje (null) y no muestra error",
    );
    check(sentCalls === 1, "éxito: dispara onSent (arranca el cooldown) una vez");
  }

  // ---------- 2b. error rate-limit (429) → loading → error ----------
  {
    const { states, messages, sentCalls } = await drive(async () => ({
      error: { status: 429, message: "Too many requests" },
    }));
    check(
      JSON.stringify(states) === JSON.stringify(["loading", "error"]),
      "rate-limit: transición loading → error",
    );
    check(
      messages[messages.length - 1] === RATE_LIMIT_COPY,
      "rate-limit: muestra el copy de rate-limit específico",
    );
    check(sentCalls === 0, "rate-limit: NO dispara onSent (no hubo envío OK)");
  }

  // ---------- 2c. error EMAIL_MISMATCH → loading → error (genérico) ----------
  {
    const { states, messages, sentCalls } = await drive(async () => ({
      error: { status: 400, code: "EMAIL_MISMATCH" },
    }));
    check(
      JSON.stringify(states) === JSON.stringify(["loading", "error"]),
      "EMAIL_MISMATCH: transición loading → error",
    );
    check(
      messages[messages.length - 1] === RESEND_VERIFICATION_GENERIC_ERROR,
      "EMAIL_MISMATCH: muestra el copy genérico (nunca el de rate-limit)",
    );
    check(sentCalls === 0, "EMAIL_MISMATCH: NO dispara onSent");
  }

  done();
}

main();
