/**
 * Suite del transporte de email transaccional (src/lib/email.ts) — foco en el
 * reseteo de contraseña del tutor/a (ciclo 13 L2). Sin framework — tsx.
 *
 *   pnpm test email
 *
 * Camino crítico (no filtrar tokens de reseteo a los logs de producción). Testea
 * de forma determinística, capturando console.log/error (sin red, sin proveedor):
 *
 *   1. DEV (NODE_ENV != production, sin RESEND_API_KEY): deliverResetPasswordEmail
 *      devuelve true y loguea el cuerpo para probar local (incluye la URL).
 *   2. PRODUCCIÓN (NODE_ENV=production, sin RESEND_API_KEY): devuelve false y
 *      NUNCA loguea la URL con el token (solo un error genérico). Gate NODE_ENV.
 *   3. El asunto/cuerpo del reseteo mencionan el reseteo y NO son los de la
 *      verificación (no se cruzan las plantillas).
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
// El transporte elige el branch por RESEND_API_KEY: sin la key, no toca la red.
delete process.env.RESEND_API_KEY;

import { createChecker } from "./suite-helpers";
import {
  deliverResetPasswordEmail,
  deliverVerificationEmail,
  deliverCrisisAlert,
  isResendErrorTransient,
} from "../src/lib/email";

const { check, done } = createChecker("Email suite");

const RESET_URL = "https://simon.example.com/reset-password/tok_SECRETO_123?callbackURL=";

// Captura de consola: junta todo lo que se loguearía en un array por nivel.
function withCapturedConsole<T>(fn: () => Promise<T>): Promise<{
  result: T;
  logs: string[];
  errors: string[];
}> {
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  console.error = (...args: unknown[]) => errors.push(args.join(" "));
  return fn()
    .then((result) => ({ result, logs, errors }))
    .finally(() => {
      console.log = origLog;
      console.error = origErr;
    });
}

async function testDevLogsBody() {
  const prevEnv = process.env.NODE_ENV;
  // NODE_ENV != production → fallback de desarrollo (loguea el cuerpo).
  (process.env as Record<string, string>).NODE_ENV = "development";
  const { result, logs } = await withCapturedConsole(() =>
    deliverResetPasswordEmail("tutora@gmail.com", RESET_URL),
  );
  (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;

  check(result === true, "reset dev: sin proveedor devuelve true (fallback de dev)");
  const joined = logs.join("\n");
  check(joined.includes("tutora@gmail.com"), "reset dev: loguea el destinatario (probar local)");
  check(joined.includes(RESET_URL), "reset dev: el fallback de dev SÍ incluye la URL (para probar local)");
  check(/restablec/i.test(joined), "reset dev: el cuerpo habla de restablecer la contraseña");
}

async function testProdNeverLeaksToken() {
  const prevEnv = process.env.NODE_ENV;
  // NODE_ENV=production sin RESEND_API_KEY → NO envía y NO loguea el cuerpo.
  (process.env as Record<string, string>).NODE_ENV = "production";
  const { result, logs, errors } = await withCapturedConsole(() =>
    deliverResetPasswordEmail("tutora@gmail.com", RESET_URL),
  );
  (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;

  check(result === false, "reset prod sin proveedor: devuelve false (no se envió)");
  const all = [...logs, ...errors].join("\n");
  // INVARIANTE DE SEGURIDAD: el token de reseteo jamás aparece en los logs de prod.
  check(!all.includes("tok_SECRETO_123"), "reset prod: NUNCA loguea el token de reseteo");
  check(!all.includes(RESET_URL), "reset prod: NUNCA loguea la URL con el token");
  check(
    errors.some((e) => /RESEND_API_KEY/.test(e)),
    "reset prod: deja constancia del fallo (sin filtrar el token)",
  );
}

async function testTemplateDistinctFromVerification() {
  const prevEnv = process.env.NODE_ENV;
  (process.env as Record<string, string>).NODE_ENV = "development";
  const reset = await withCapturedConsole(() =>
    deliverResetPasswordEmail("tutora@gmail.com", "https://x/reset"),
  );
  const verify = await withCapturedConsole(() =>
    deliverVerificationEmail("tutora@gmail.com", "https://x/verify"),
  );
  (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;

  const resetBody = reset.logs.join("\n");
  const verifyBody = verify.logs.join("\n");
  check(/Restablec/i.test(resetBody), "reset: asunto/cuerpo de restablecer contraseña");
  check(/Confirmá tu email/i.test(verifyBody), "verify: asunto de confirmar email");
  check(
    !/Confirmá tu email/i.test(resetBody),
    "las plantillas no se cruzan (reset no usa el texto de verificación)",
  );
}

// ---------- 4. isResendErrorTransient: qué se reintenta (ciclo 15 L2a) ----------
function testResendTransientClassifier() {
  // 5xx → transitorio.
  for (const s of [500, 502, 503, 504]) {
    check(
      isResendErrorTransient({ statusCode: s, name: "application_error" }) === true,
      `resend ${s} → transitorio`,
    );
  }
  // 4xx → NO transitorio (credenciales/cuota/validación).
  for (const s of [400, 401, 403, 422, 429]) {
    check(
      isResendErrorTransient({ statusCode: s, name: "rate_limit_exceeded" }) === false,
      `resend ${s} → NO transitorio`,
    );
  }
  // Fallo de red/timeout: Resend lo colapsa en statusCode null + application_error.
  check(
    isResendErrorTransient({ statusCode: null, name: "application_error" }) === true,
    "resend statusCode null + application_error (timeout/red) → transitorio",
  );
  // statusCode null pero otro name (no el shape de red de Resend) → NO transitorio.
  check(
    isResendErrorTransient({ statusCode: null, name: "validation_error" }) === false,
    "resend statusCode null con otro name → NO transitorio (no es el caso de red)",
  );
}

// ---------- 5. deliverEmail: reintento real sobre Resend (mock de fetch) ----------
// Emula el contrato HTTP de Resend v6 (fetchRequest): !ok → response.text() +
// JSON.parse → { error }; ok → response.json() → { data }. Verifica que un 5xx se
// reintenta y un 4xx no, sin tocar la red.
async function testResendRetryIntegration() {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFetch = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_test_key";

  const errBody = (statusCode: number, name: string) =>
    ({
      ok: false,
      status: statusCode,
      text: async () => JSON.stringify({ statusCode, name, message: "boom" }),
      headers: new Headers(),
    }) as unknown as Response;
  const okBody = () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ id: "email_123" }),
      headers: new Headers(),
    }) as unknown as Response;

  // (a) 5xx en el 1er intento, éxito en el 2do → deliver true, fetch 2 veces.
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return calls === 1 ? errBody(503, "application_error") : okBody();
    }) as typeof fetch;
    const ok = await deliverCrisisAlert("tutora@gmail.com", {
      childName: "Ana",
      signal: "angustia intensa",
    });
    check(ok === true && calls === 2, "resend 5xx→retry→éxito: deliver true, 2 llamadas");
  }

  // (b) 4xx (422 validación) → NO se reintenta, deliver false, fetch 1 vez.
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return errBody(422, "validation_error");
    }) as typeof fetch;
    const ok = await deliverCrisisAlert("tutora@gmail.com", {
      childName: "Ana",
      signal: "angustia intensa",
    });
    check(ok === false && calls === 1, "resend 4xx: sin retry, deliver false, 1 llamada");
  }

  // (c) 5xx persistente → agota el reintento y devuelve false (fallo final).
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return errBody(500, "application_error");
    }) as typeof fetch;
    const ok = await deliverCrisisAlert("tutora@gmail.com", {
      childName: "Ana",
      signal: "angustia intensa",
    });
    check(ok === false && calls === 2, "resend 5xx persistente: 2 llamadas (1 retry) y deliver false");
  }

  globalThis.fetch = prevFetch;
  if (prevKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = prevKey;
}

async function main() {
  await testDevLogsBody();
  await testProdNeverLeaksToken();
  await testTemplateDistinctFromVerification();
  testResendTransientClassifier();
  await testResendRetryIntegration();
  done();
}

main();
