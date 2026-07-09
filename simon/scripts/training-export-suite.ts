/**
 * Suite ejecutable del export de entrenamiento (sin framework — tsx).
 *
 *   pnpm training-export-suite
 *
 * Testea SOLO la lógica pura de filtrado/corte/anonimización (src/lib/training-
 * export.ts), sin DB ni LLM.
 *
 * Camino crítico (Ley 25.326 — datos de menores): un error acá puede filtrar
 * PII o material de crisis al dataset. Se cubre cada rama. Sale con código 1 si
 * algún caso falla (gate en CI).
 */
import {
  buildTrainingExample,
  countPairs,
  createdAtMonth,
  dropLeadingNonUser,
  hasBlockingSafetyEvent,
  isBlockingSafetyCategory,
  metaSidecarPath,
  MIN_PAIRS_FLOOR,
  parseRoleFilter,
  qualityTier,
  TRAINING_SYSTEM_PROMPT,
  truncateAtFirstFlag,
  trimToLastAssistant,
  type ExportMessage,
} from "../src/lib/training-export";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

const u = (content: string, flag: string | null = null): ExportMessage => ({
  role: "user",
  content,
  safetyFlag: flag,
});
const a = (content: string, flag: string | null = null): ExportMessage => ({
  role: "assistant",
  content,
  safetyFlag: flag,
});

// ---------- 1. Categorías bloqueantes ----------
{
  check(isBlockingSafetyCategory("crisis") === true, "block: 'crisis' bloquea");
  check(isBlockingSafetyCategory("abuso") === true, "block: 'abuso' bloquea");
  check(isBlockingSafetyCategory("self-harm") === true, "block: 'self-harm' (moderación) bloquea");
  check(isBlockingSafetyCategory("sexual/minors") === true, "block: 'sexual/minors' bloquea");
  check(isBlockingSafetyCategory("riesgo") === false, "block: 'riesgo' NO bloquea");
  check(isBlockingSafetyCategory("alimentario") === false, "block: 'alimentario' NO bloquea");
  check(hasBlockingSafetyEvent(["riesgo", "abuso"]) === true, "block: lista con abuso bloquea");
  check(hasBlockingSafetyEvent(["riesgo"]) === false, "block: solo riesgo no bloquea");
  check(hasBlockingSafetyEvent([]) === false, "block: sin eventos no bloquea");
}

// ---------- 2. Corte en la primera señal de seguridad ----------
{
  const msgs = [u("hola"), a("¡hola!"), u("me siento mal", "riesgo"), a("plantilla")];
  const cut = truncateAtFirstFlag(msgs);
  check(cut.length === 2, "cut: descarta desde el primer safetyFlag != null");
  check(cut[cut.length - 1].content === "¡hola!", "cut: conserva lo previo intacto");
  check(
    truncateAtFirstFlag([u("a"), a("b")]).length === 2,
    "cut: sin flags no recorta nada",
  );
}

// ---------- 3. Abrir en user / cerrar en assistant ----------
{
  check(
    dropLeadingNonUser([a("saludo"), u("hola"), a("hey")]).length === 2,
    "shape: descarta assistant inicial",
  );
  check(
    dropLeadingNonUser([u("hola"), a("hey")])[0].role === "user",
    "shape: si ya abre en user no toca",
  );
  const trimmed = trimToLastAssistant([u("a"), a("b"), u("c")]);
  check(
    trimmed.length === 2 && trimmed[trimmed.length - 1].role === "assistant",
    "shape: recorta el user final colgado",
  );
  check(
    trimToLastAssistant([u("a")]).length === 0,
    "shape: sin ningún assistant → vacío",
  );
}

// ---------- 4. Conteo de pares ----------
{
  check(countPairs([u("a"), a("b"), u("c"), a("d")]) === 2, "pairs: 2 pares completos");
  check(countPairs([u("a"), a("b"), a("c")]) === 1, "pairs: assistant doble = 1 par");
  check(countPairs([a("b"), u("a")]) === 0, "pairs: sin transición user→assistant = 0");
}

// ---------- 5. Mes y tier ----------
{
  check(createdAtMonth(new Date("2026-03-09T22:00:00Z")) === "2026-03", "month: YYYY-MM (UTC)");
  check(createdAtMonth(new Date("2026-12-31T23:59:59Z")) === "2026-12", "month: diciembre");
  check(qualityTier(3) === "medium", "tier: 3 pares → medium");
  check(qualityTier(6) === "high", "tier: 6 pares → high");
  check(qualityTier(10) === "high", "tier: 10 pares → high");
}

// ---------- 6. buildTrainingExample ----------
{
  // Conversación válida de 3 pares → ejemplo con system genérico.
  const good = buildTrainingExample({
    id: "c1",
    createdAt: new Date("2026-05-01T00:00:00Z"),
    messages: [u("hola"), a("¡hola!"), u("¿qué es el CUD?"), a("es..."), u("gracias"), a("de nada")],
    safetyEventCategories: [],
  });
  check(good !== null, "build: conversación de 3 pares se incluye");
  check(good?.record.messages[0].role === "system", "build: primer mensaje es system");
  check(
    good?.record.messages[0].content === TRAINING_SYSTEM_PROMPT,
    "build: system es la persona genérica",
  );
  check(
    !(good?.record.messages[0].content ?? "").includes("se llama"),
    "build: system NO incluye userName (anonimización)",
  );
  check(good?.record.messages[1].role === "user", "build: abre en user tras el system");
  check(
    good?.record.messages[good.record.messages.length - 1].role === "assistant",
    "build: cierra en assistant",
  );
  check(good?.meta.conversationId === "c1", "build: meta.conversationId");
  check(good?.meta.turnCount === 3, "build: meta.turnCount = pares");
  check(good?.meta.createdAtMonth === "2026-05", "build: meta.createdAtMonth");
  check(good?.meta.qualityTier === "medium", "build: meta.qualityTier (3 → medium)");

  // Menos de 3 pares → null.
  const tooShort = buildTrainingExample({
    id: "c2",
    createdAt: new Date(),
    messages: [u("hola"), a("hey"), u("chau"), a("chau")],
    safetyEventCategories: [],
  });
  check(tooShort === null, "build: menos de 3 pares → null");

  // SafetyEvent de crisis → excluida entera aunque sea larga.
  const crisisConv = buildTrainingExample({
    id: "c3",
    createdAt: new Date(),
    messages: [u("a"), a("b"), u("c"), a("d"), u("e"), a("f")],
    safetyEventCategories: ["crisis"],
  });
  check(crisisConv === null, "build: conversación con SafetyEvent crisis → null");

  // El corte en la primera señal puede dejarla por debajo del mínimo → null.
  const cutBelowMin = buildTrainingExample({
    id: "c4",
    createdAt: new Date(),
    messages: [u("a"), a("b"), u("mal", "riesgo"), a("plantilla"), u("x"), a("y")],
    safetyEventCategories: [],
  });
  check(cutBelowMin === null, "build: si el corte deja <3 pares → null");

  // --min-turns eleva el piso; nunca baja de MIN_PAIRS_FLOOR.
  const raised = buildTrainingExample(
    {
      id: "c5",
      createdAt: new Date(),
      messages: [u("a"), a("b"), u("c"), a("d"), u("e"), a("f")],
      safetyEventCategories: [],
    },
    { minTurns: 4 },
  );
  check(raised === null, "build: --min-turns 4 excluye una charla de 3 pares");
  check(MIN_PAIRS_FLOOR === 3, "build: piso duro = 3 pares");
}

// ---------- 7. Flags CLI ----------
{
  check(parseRoleFilter("child") === "child", "role: child");
  check(parseRoleFilter("guardian") === "guardian", "role: guardian");
  check(parseRoleFilter("all") === "all", "role: all");
  check(parseRoleFilter(undefined) === "all", "role: sin flag → all");
  check(parseRoleFilter("basura") === "all", "role: valor inválido → all");
  check(metaSidecarPath("data/x.jsonl") === "data/x.meta.jsonl", "meta: .jsonl → .meta.jsonl");
  check(metaSidecarPath("x") === "x.meta.jsonl", "meta: sin extensión → +.meta.jsonl");
}

const total = passed + failures.length;
console.log(`\nTraining export suite: ${passed}/${total} casos OK`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
  process.exit(1);
}
console.log("Todos los casos pasaron.\n");
