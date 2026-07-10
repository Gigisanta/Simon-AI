/**
 * Suite de la precedencia de respuesta del handler de /api/chat (#32).
 *
 *   pnpm chat-precedence-suite
 *
 * El orden crisis > límite de sesión > no-ai > error de generación > moderación
 * de salida > normal es una INVARIANTE DE SEGURIDAD que antes no tenía cobertura
 * (vivía entrelazada con los efectos del handler). Acá se testea EXHAUSTIVAMENTE
 * la función pura decideResponsePath: cada rama alcanzable + la DOMINANCIA de
 * cada nivel sobre los inferiores.
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
import {
  decideResponsePath,
  decidePostGenPath,
  type PrecedenceInputs,
  type PostGenInputs,
  type ResponsePath,
} from "../src/lib/chat-precedence";

let passed = 0;
const failures: string[] = [];
function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

// Base "todo continúa": sin ningún corte → "normal".
const CONT: PrecedenceInputs = {
  regexCrisis: false,
  moderationInputCrisis: false,
  sessionOver: false,
  aiReady: true,
  generationOk: true,
  outputFlagged: false,
  outputUnavailableReplace: false,
};

function decide(over: Partial<PrecedenceInputs>): ResponsePath {
  return decideResponsePath({ ...CONT, ...over });
}

// ---------- Cada rama alcanzable ----------
check(decide({}) === "normal", "todo OK → normal");
check(decide({ regexCrisis: true }) === "crisis-template", "regexCrisis → crisis-template");
check(
  decide({ moderationInputCrisis: true }) === "crisis-template",
  "moderationInputCrisis → crisis-template",
);
check(decide({ sessionOver: true }) === "session-limit", "sessionOver → session-limit");
check(decide({ aiReady: false }) === "no-ai", "aiReady false → no-ai");
check(decide({ generationOk: false }) === "fallback-error", "generationOk false → fallback-error");
check(
  decide({ outputFlagged: true }) === "moderation-replaced-output",
  "outputFlagged → moderation-replaced-output",
);
check(
  decide({ outputUnavailableReplace: true }) === "moderation-unavailable",
  "outputUnavailableReplace → moderation-unavailable",
);

// ---------- Dominancia (cada nivel gana sobre TODOS los inferiores) ----------
// regexCrisis gana sobre absolutamente todo lo demás activado.
check(
  decide({
    regexCrisis: true,
    moderationInputCrisis: true,
    sessionOver: true,
    aiReady: false,
    generationOk: false,
    outputFlagged: true,
    outputUnavailableReplace: true,
  }) === "crisis-template",
  "regexCrisis domina TODO",
);
// moderationInputCrisis gana sobre sesión/no-ai/gen/salida.
check(
  decide({
    moderationInputCrisis: true,
    sessionOver: true,
    aiReady: false,
    generationOk: false,
    outputFlagged: true,
  }) === "crisis-template",
  "moderationInputCrisis domina sesión/no-ai/gen/salida",
);
// sesión gana sobre no-ai/gen/salida (pero NO sobre crisis).
check(
  decide({ sessionOver: true, aiReady: false, generationOk: false, outputFlagged: true }) ===
    "session-limit",
  "sessionOver domina no-ai/gen/salida",
);
// no-ai gana sobre gen/salida.
check(
  decide({ aiReady: false, generationOk: false, outputFlagged: true }) === "no-ai",
  "no-ai domina gen-error/salida",
);
// fallback-error gana sobre la moderación de salida.
check(
  decide({ generationOk: false, outputFlagged: true, outputUnavailableReplace: true }) ===
    "fallback-error",
  "fallback-error domina moderación de salida",
);
// output flaggeado gana sobre output no-disponible.
check(
  decide({ outputFlagged: true, outputUnavailableReplace: true }) ===
    "moderation-replaced-output",
  "outputFlagged domina outputUnavailableReplace",
);

// ---------- Precedencia crisis entre ambas capas (regex y moderación) ----------
check(
  decide({ regexCrisis: true, moderationInputCrisis: true }) === "crisis-template",
  "ambas capas de crisis activas → crisis-template",
);
// Una crisis NUNCA queda enmascarada por sesión vencida (regresión clave).
check(
  decide({ regexCrisis: true, sessionOver: true }) === "crisis-template",
  "crisis por regex + sesión vencida → gana crisis (no enmascarada)",
);
check(
  decide({ moderationInputCrisis: true, sessionOver: true }) === "crisis-template",
  "crisis por moderación + sesión vencida → gana crisis (no enmascarada)",
);

// ---------- Uso PRE-generación del handler ("continuar = normal") ----------
// El handler pasa los post-gen en su valor "continuar"; un corte pre-gen debe
// devolver el corte, y sin corte debe devolver "normal" (= seguir a generación).
check(
  decide({ moderationInputCrisis: true }) === "crisis-template",
  "pre-gen: corte por crisis de moderación",
);
check(decide({ sessionOver: true }) === "session-limit", "pre-gen: corte por sesión");
check(decide({ aiReady: false }) === "no-ai", "pre-gen: corte por no-ai");
check(decide({}) === "normal", "pre-gen: sin corte → normal (seguir a generación)");

// ========== decidePostGenPath: sub-decisión POST-generación (Lote 3) ==========
// Orden fijo: fallback-error > moderation-replaced-output > moderation-unavailable
// > normal. Encoda "moderación antes de responder": una salida flaggeada (o una
// degradación fail-closed) SIEMPRE se resuelve antes de mostrar el output.
const PG_CONT: PostGenInputs = {
  generationOk: true,
  outputModAvailable: true,
  outputModFlagged: false,
  unmoderatedReplace: false,
};
function pg(over: Partial<PostGenInputs>): ReturnType<typeof decidePostGenPath> {
  return decidePostGenPath({ ...PG_CONT, ...over });
}

// Cada rama alcanzable.
check(pg({ generationOk: false }) === "fallback-error", "post-gen: generación falló → fallback-error");
check(
  pg({ outputModFlagged: true }) === "moderation-replaced-output",
  "post-gen: salida flaggeada (API ok) → moderation-replaced-output",
);
check(
  pg({ outputModAvailable: false, unmoderatedReplace: true }) === "moderation-unavailable",
  "post-gen: API de salida caída + fail-closed replace → moderation-unavailable",
);
check(pg({}) === "normal", "post-gen: sin corte → normal (mostrar salida validada)");

// DOMINANCIA del orden.
// fallback-error gana sobre cualquier estado de moderación de salida.
check(
  pg({ generationOk: false, outputModFlagged: true }) === "fallback-error",
  "post-gen: error de generación domina la moderación de salida (no se moderó texto inexistente)",
);
check(
  pg({ generationOk: false, outputModAvailable: false, unmoderatedReplace: true }) === "fallback-error",
  "post-gen: error de generación domina la degradación fail-closed",
);
// moderation-replaced (API disponible + flag) gana sobre la rama de no-disponible.
check(
  pg({ outputModFlagged: true, unmoderatedReplace: true }) === "moderation-replaced-output",
  "post-gen: flag con API disponible domina (unavailable solo aplica si !available)",
);
// Si la salida NO está disponible, outputModFlagged es irrelevante (no se pudo evaluar).
check(
  pg({ outputModAvailable: false, outputModFlagged: true, unmoderatedReplace: false }) === "normal",
  "post-gen: API caída sin replace fail-closed → normal (flag ignorado: no hubo evaluación real)",
);
// API caída con replace fail-closed → sustituye aunque flagged sea false.
check(
  pg({ outputModAvailable: false, outputModFlagged: false, unmoderatedReplace: true }) === "moderation-unavailable",
  "post-gen: API caída + fail-closed → sustituye sin depender de flagged",
);

const total = passed + failures.length;
console.log(`\nChat-precedence suite: ${passed}/${total} casos OK`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
  process.exit(1);
}
console.log("Todos los casos pasaron.\n");
