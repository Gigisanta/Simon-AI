/**
 * Suite ejecutable de alertas de crisis al tutor/a (sin framework — tsx).
 *
 *   pnpm alerts-suite
 *
 * Testea SOLO lógica pura, sin DB ni email:
 *   1. shouldAlert() — quién recibe alerta y cuándo (M-P2), incluido el
 *      dedupe de 1 alerta por hora por menor.
 *   2. humanCategory() — categoría técnica → lenguaje humano no alarmista.
 *   3. Umbral de categorías: solo crisis/abuso alertan.
 *
 * Camino crítico: un error acá manda alertas de crisis al tutor equivocado,
 * las duplica, o las silencia. Sale con código 1 si algún caso falla.
 */
import {
  ALERT_CATEGORIES,
  ALERT_DEDUPE_WINDOW_MS,
  humanCategory,
  shouldAlert,
} from "../src/lib/alerts";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

const now = new Date("2026-07-08T12:00:00Z");
const consented = { consentAt: new Date("2026-07-01T00:00:00Z"), alertsEnabled: true };

// ---------- 1. shouldAlert ----------
{
  // Adultos nunca generan alerta (aunque tuvieran vínculo por error).
  check(
    shouldAlert({ role: "guardian", guardian: consented, lastNotifiedAt: null, now }) === false,
    "shouldAlert: guardian adulto → false",
  );
  check(
    shouldAlert({ role: undefined, guardian: consented, lastNotifiedAt: null, now }) === false,
    "shouldAlert: rol indefinido → false",
  );

  // Menor sin vínculo Guardian → no hay a quién alertar.
  check(
    shouldAlert({ role: "child", guardian: null, lastNotifiedAt: null, now }) === false,
    "shouldAlert: child sin Guardian → false",
  );

  // Menor con vínculo pero sin consentimiento registrado → false.
  check(
    shouldAlert({
      role: "child",
      guardian: { consentAt: null, alertsEnabled: true },
      lastNotifiedAt: null,
      now,
    }) === false,
    "shouldAlert: child sin consentAt → false",
  );

  // Tutor/a apagó las alertas → false.
  check(
    shouldAlert({
      role: "child",
      guardian: { consentAt: consented.consentAt, alertsEnabled: false },
      lastNotifiedAt: null,
      now,
    }) === false,
    "shouldAlert: alertsEnabled=false → false",
  );

  // Dedupe: ya se notificó hace 30 minutos → false.
  check(
    shouldAlert({
      role: "child",
      guardian: consented,
      lastNotifiedAt: new Date(now.getTime() - 30 * 60 * 1000),
      now,
    }) === false,
    "shouldAlert: notificado hace 30min → false (dedupe 1/hora)",
  );
  // Borde: hace exactamente 1 hora ya NO está dentro de la ventana → true.
  check(
    shouldAlert({
      role: "child",
      guardian: consented,
      lastNotifiedAt: new Date(now.getTime() - ALERT_DEDUPE_WINDOW_MS),
      now,
    }) === true,
    "shouldAlert: notificado hace exactamente 1h → true",
  );
  check(
    shouldAlert({
      role: "child",
      guardian: consented,
      lastNotifiedAt: new Date(now.getTime() - ALERT_DEDUPE_WINDOW_MS + 1),
      now,
    }) === false,
    "shouldAlert: notificado hace 59:59.999 → false",
  );
  check(
    shouldAlert({
      role: "child",
      guardian: consented,
      lastNotifiedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      now,
    }) === true,
    "shouldAlert: notificado hace 2h → true",
  );

  // Caso válido completo: menor + consentimiento + alertas on + sin dedupe.
  check(
    shouldAlert({ role: "child", guardian: consented, lastNotifiedAt: null, now }) === true,
    "shouldAlert: caso válido (nunca notificado) → true",
  );
}

// ---------- 2. humanCategory ----------
{
  check(
    humanCategory("crisis") === "angustia intensa",
    'humanCategory: "crisis" → "angustia intensa"',
  );
  check(
    humanCategory("abuso") === "posible situación de abuso",
    'humanCategory: "abuso" → "posible situación de abuso"',
  );
  // Categorías crudas de la Moderation API caen al genérico.
  check(
    humanCategory("self-harm/intent") === "posible situación de riesgo",
    'humanCategory: categoría de moderación → "posible situación de riesgo"',
  );
  check(
    humanCategory("cualquier-otra") === "posible situación de riesgo",
    "humanCategory: categoría desconocida → genérico",
  );
}

// ---------- 3. Umbral de categorías ----------
{
  // Solo crisis/abuso alertan: "riesgo" y "alimentario" quedan afuera por
  // diseño (evitar sobre-alertar; ver lib/alerts.ts).
  check(
    ALERT_CATEGORIES.length === 2 &&
      ALERT_CATEGORIES.includes("crisis") &&
      ALERT_CATEGORIES.includes("abuso"),
    'umbral: ALERT_CATEGORIES es exactamente ["crisis", "abuso"]',
  );
  check(
    !(ALERT_CATEGORIES as readonly string[]).includes("riesgo") &&
      !(ALERT_CATEGORIES as readonly string[]).includes("alimentario"),
    "umbral: riesgo/alimentario NO alertan",
  );
}

const total = passed + failures.length;
console.log(`\nAlerts suite: ${passed}/${total} casos OK`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
  process.exit(1);
}
console.log("Todos los casos pasaron.\n");
