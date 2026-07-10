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
  PATTERN_ALERT_THRESHOLD,
  PATTERN_CATEGORIES,
  PATTERN_WINDOW_MS,
  humanPatternCategory,
  shouldPatternAlert,
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

// ---------- 4. shouldPatternAlert (acumulación riesgo/alimentario) ----------
{
  // Cuenta events dentro de la ventana de 7 días (mismo criterio que la query).
  const recentCount = (dates: Date[]) =>
    dates.filter((d) => now.getTime() - d.getTime() < PATTERN_WINDOW_MS).length;

  const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  // Umbral: 2 no dispara, 3 dispara.
  check(
    shouldPatternAlert({
      role: "child",
      guardian: consented,
      recentCount: 2,
      lastPatternNotifiedAt: null,
      now,
    }) === false,
    "patrón: umbral 2 → false",
  );
  check(
    shouldPatternAlert({
      role: "child",
      guardian: consented,
      recentCount: PATTERN_ALERT_THRESHOLD,
      lastPatternNotifiedAt: null,
      now,
    }) === true,
    "patrón: umbral 3 → true",
  );

  // Ventana de 7 días: un evento viejo NO cuenta. 3 eventos pero 1 fuera de la
  // ventana → recentCount 2 → no dispara. Los 3 dentro → dispara.
  check(
    recentCount([days(8), days(2), days(1)]) === 2 &&
      shouldPatternAlert({
        role: "child",
        guardian: consented,
        recentCount: recentCount([days(8), days(2), days(1)]),
        lastPatternNotifiedAt: null,
        now,
      }) === false,
    "patrón: ventana 7d excluye el evento viejo → count 2 → false",
  );
  check(
    recentCount([days(6), days(2), days(1)]) === 3 &&
      shouldPatternAlert({
        role: "child",
        guardian: consented,
        recentCount: recentCount([days(6), days(2), days(1)]),
        lastPatternNotifiedAt: null,
        now,
      }) === true,
    "patrón: 3 eventos dentro de la ventana → true",
  );

  // Dedupe semanal: ya se avisó hace 3 días → false; hace 8 días → true.
  check(
    shouldPatternAlert({
      role: "child",
      guardian: consented,
      recentCount: 5,
      lastPatternNotifiedAt: days(3),
      now,
    }) === false,
    "patrón: dedupe semanal (avisado hace 3d) → false",
  );
  check(
    shouldPatternAlert({
      role: "child",
      guardian: consented,
      recentCount: 5,
      lastPatternNotifiedAt: days(8),
      now,
    }) === true,
    "patrón: dedupe expiró (avisado hace 8d) → true",
  );

  // Tutor/a apagó las alertas → nunca envía, aunque haya acumulación.
  check(
    shouldPatternAlert({
      role: "child",
      guardian: { consentAt: consented.consentAt, alertsEnabled: false },
      recentCount: 5,
      lastPatternNotifiedAt: null,
      now,
    }) === false,
    "patrón: alertsEnabled=false → false",
  );

  // Mismas puertas de autorización que shouldAlert.
  check(
    shouldPatternAlert({
      role: "guardian",
      guardian: consented,
      recentCount: 5,
      lastPatternNotifiedAt: null,
      now,
    }) === false,
    "patrón: guardian adulto → false",
  );
  check(
    shouldPatternAlert({
      role: "child",
      guardian: null,
      recentCount: 5,
      lastPatternNotifiedAt: null,
      now,
    }) === false,
    "patrón: child sin Guardian → false",
  );
  check(
    shouldPatternAlert({
      role: "child",
      guardian: { consentAt: null, alertsEnabled: true },
      recentCount: 5,
      lastPatternNotifiedAt: null,
      now,
    }) === false,
    "patrón: child sin consentAt → false",
  );

  // crisis/abuso NO pasan por el camino de patrón: son categorías de alerta
  // inmediata, jamás de acumulación.
  check(
    (PATTERN_CATEGORIES as readonly string[]).includes("riesgo") &&
      (PATTERN_CATEGORIES as readonly string[]).includes("alimentario"),
    'patrón: PATTERN_CATEGORIES es ["riesgo", "alimentario"]',
  );
  check(
    !(PATTERN_CATEGORIES as readonly string[]).includes("crisis") &&
      !(PATTERN_CATEGORIES as readonly string[]).includes("abuso"),
    "patrón: crisis/abuso NO pasan por el camino de patrón",
  );
  // No hay solapamiento entre alerta inmediata y alerta de patrón.
  check(
    ALERT_CATEGORIES.every(
      (c) => !(PATTERN_CATEGORIES as readonly string[]).includes(c),
    ),
    "patrón: ALERT_CATEGORIES y PATTERN_CATEGORIES son disjuntas",
  );

  // humanPatternCategory: lenguaje humano, no alarmista, sin contenido.
  check(
    humanPatternCategory("alimentario").includes("comida"),
    "patrón: humanPatternCategory(alimentario) legible",
  );
  check(
    humanPatternCategory("riesgo").length > 0,
    "patrón: humanPatternCategory(riesgo) legible",
  );
}

const total = passed + failures.length;
console.log(`\nAlerts suite: ${passed}/${total} casos OK`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
  process.exit(1);
}
console.log("Todos los casos pasaron.\n");
