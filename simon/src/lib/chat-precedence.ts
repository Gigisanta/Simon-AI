/**
 * Precedencia de respuesta del handler de /api/chat (#32) — función PURA.
 *
 * El orden de precedencia es una INVARIANTE DE SEGURIDAD: una crisis SIEMPRE
 * gana sobre el límite de sesión, la moderación de salida y la generación
 * normal. Ese orden vivía solo entrelazado con los efectos (persistencia,
 * alertas, logging) del handler y no tenía cobertura propia. Acá se extrae la
 * DECISIÓN (no la ejecución) para testearla exhaustivamente y para que el
 * handler la use como fuente única del orden.
 *
 * Orden (de mayor a menor prioridad):
 *   1. crisis/abuso por REGEX (capa 1, pre-LLM)            → "crisis-template"
 *   2. crisis/abuso por MODERACIÓN de entrada (capa 2)     → "crisis-template"
 *   3. sesión vencida (M-S7)                               → "session-limit"
 *   4. IA no configurada (sin generación posible)          → "no-ai"
 *   5. error de generación (fallback amable)               → "fallback-error"
 *   6. moderación de SALIDA flaggeó → sustitución segura    → "moderation-replaced-output"
 *   7. moderación de salida caída + fail-closed             → "moderation-unavailable"
 *   8. salida validada                                     → "normal"
 */

export type ResponsePath =
  | "crisis-template"
  | "session-limit"
  | "no-ai"
  | "fallback-error"
  | "moderation-replaced-output"
  | "moderation-unavailable"
  | "normal";

export interface PrecedenceInputs {
  /** regexFlag ∈ {crisis, abuso, alimentario} — capa 1 dispara plantilla fija. */
  regexCrisis: boolean;
  /** inputMod.mappedFlag ∈ {crisis, abuso} — capa 2 (moderación de entrada). */
  moderationInputCrisis: boolean;
  /** sessionState === "over" (solo menores). */
  sessionOver: boolean;
  /** aiConfigured() && hubo generación paralela (parallelGen != null). */
  aiReady: boolean;
  /** La generación terminó OK (generateReply devolvió ok:true). */
  generationOk: boolean;
  /** Moderación de salida disponible Y flaggeada. */
  outputFlagged: boolean;
  /** Moderación de salida NO disponible Y la decisión fail-closed no es "show". */
  outputUnavailableReplace: boolean;
}

/**
 * Resuelve el path de respuesta desde inputs YA resueltos. Determinística y sin
 * efectos. Los campos post-generación se ignoran si un corte anterior gana
 * (short-circuit por precedencia), lo que permite usarla también para la sola
 * decisión PRE-generación pasando los post-gen en su valor "continuar"
 * (generationOk:true, outputFlagged:false, outputUnavailableReplace:false):
 * en ese caso devuelve el corte temprano o "normal" = "seguir a generación".
 */
export function decideResponsePath(i: PrecedenceInputs): ResponsePath {
  if (i.regexCrisis) return "crisis-template";
  if (i.moderationInputCrisis) return "crisis-template";
  if (i.sessionOver) return "session-limit";
  if (!i.aiReady) return "no-ai";
  if (!i.generationOk) return "fallback-error";
  if (i.outputFlagged) return "moderation-replaced-output";
  if (i.outputUnavailableReplace) return "moderation-unavailable";
  return "normal";
}

/**
 * Sub-decisión POST-generación (paths 5–8 de decideResponsePath) como función
 * PURA propia, para que el handler la use como fuente única del orden de las
 * ramas que antes vivían inline entrelazadas con la moderación de salida.
 *
 * INVARIANTE DE SEGURIDAD (por qué este orden y no otro):
 *   1. un error de generación se resuelve ANTES de moderar — no se puede (ni se
 *      debe) moderar un texto que no existe; el fallback amable gana.
 *   2. la moderación de SALIDA se evalúa ANTES de responder: si la API está
 *      disponible y flaggeó, se SUSTITUYE el output del LLM (nunca se muestra).
 *   3. si la API de salida está caída, la política fail-closed (resolveUnmoderated
 *      Output) puede forzar una sustitución igual.
 *   4. solo si nada de lo anterior corta, se muestra la salida validada.
 *
 * `generationOk:false` ⇒ "fallback-error" sin importar el resto (short-circuit):
 * en el handler esta rama corta ANTES de llamar a moderate(), por eso los
 * campos de moderación de salida van en su valor neutro cuando se consulta el
 * resto. Determinística y sin efectos.
 */
export type PostGenPath =
  | "fallback-error"
  | "moderation-replaced-output"
  | "moderation-unavailable"
  | "normal";

export interface PostGenInputs {
  /** generateReply devolvió ok:true. */
  generationOk: boolean;
  /** La moderación de salida pudo evaluar (API disponible). */
  outputModAvailable: boolean;
  /** Disponible Y flaggeada → sustituir output. */
  outputModFlagged: boolean;
  /** No disponible Y resolveUnmoderatedOutput(...).action !== "show". */
  unmoderatedReplace: boolean;
}

export function decidePostGenPath(i: PostGenInputs): PostGenPath {
  if (!i.generationOk) return "fallback-error";
  if (i.outputModAvailable && i.outputModFlagged) return "moderation-replaced-output";
  if (!i.outputModAvailable && i.unmoderatedReplace) return "moderation-unavailable";
  return "normal";
}
