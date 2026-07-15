/**
 * Cascada de guardrails generalizada (ADR-2).
 *
 * Generaliza la cascada ad-hoc de `moderation.ts` en una primitiva reutilizable:
 * una lista ORDENADA de checks cheapest-first (regex → clasificador → LLM). La
 * cascada corta en el PRIMER veredicto CONCLUYENTE (`available:true`) y expone
 * `source` por capa (para el `SafetyEvent`).
 *
 * FAIL-CLOSED ante error/timeout: un check que lanza —o agota su timeout— se
 * trata como "no concluyente", NUNCA como un veredicto limpio. La cascada no
 * lanza y jamás fabrica un `available:true, flagged:false` a partir de un fallo;
 * la política fail-closed del caller (p.ej. `resolveUnmoderatedOutput` en
 * `safety.ts`) decide sobre el resultado inconcluso final.
 *
 * EXTENSIBLE sin reescritura: para enchufar un clasificador propio (research §4)
 * se agrega UN `GuardrailCheck` más en el lugar que corresponda del array; la
 * primitiva no cambia. Ese clasificador HOY no existe — no se especula con su
 * implementación (YAGNI declarado, ADR-10).
 */
import type { SafetyFlag } from "../safety";

/** Veredicto de una capa de la cascada. */
export interface GuardrailVerdict {
  /**
   * true si la capa clasificó con ÉXITO (veredicto CONCLUYENTE → corta la
   * cascada). false = "no concluyente / capa no disponible": cae a la siguiente
   * capa y, si es la última, dispara la política fail-closed del caller.
   */
  available: boolean;
  /** true si la capa marcó el input como problemático. */
  flagged: boolean;
  /** Flag interno mapeado por la capa (null si nada). */
  mappedFlag: SafetyFlag;
  /** Categoría top de la capa (logging anonimizado; opcional). */
  topCategory?: string;
  /** Qué capa produjo el veredicto — observabilidad + `SafetyEvent`. */
  source: string;
}

/**
 * Un check de la cascada. `run` intenta clasificar `input`:
 *   - devuelve un veredicto CONCLUYENTE (`available:true`) → corta la cascada;
 *   - devuelve `null`, o un veredicto `available:false` → "no concluyente / no
 *     aplica" → cae a la siguiente capa.
 *
 * CONTRATO FAIL-CLOSED: ante error/timeout un check NUNCA debe devolver un
 * veredicto "limpio" (`available:true, flagged:false`); debe devolver `null` (o
 * dejar que lance — la cascada lo captura y lo trata como no concluyente).
 */
export interface GuardrailCheck<I, V extends GuardrailVerdict = GuardrailVerdict> {
  /** Nombre de la capa (source del veredicto). Trazabilidad. */
  readonly source: string;
  run(input: I, signal?: AbortSignal): Promise<V | null>;
}

/**
 * Corre `checks` en orden (cheapest-first) sobre `input` y devuelve el PRIMER
 * veredicto concluyente (`available:true`). Si ninguno concluye, devuelve
 * `inconclusive` (el veredicto "no disponible" canónico del dominio). Nunca
 * lanza: un check que lanza se captura y se trata como no concluyente
 * (fail-closed), pasando a la siguiente capa.
 */
export async function runGuardrailCascade<I, V extends GuardrailVerdict>(
  checks: ReadonlyArray<GuardrailCheck<I, V>>,
  input: I,
  inconclusive: V,
  signal?: AbortSignal,
): Promise<V> {
  for (const check of checks) {
    let verdict: V | null;
    try {
      verdict = await check.run(input, signal);
    } catch {
      // FAIL-CLOSED: un throw NO es un veredicto limpio. Se pasa a la próxima
      // capa; si era la última, cae al `inconclusive` (que dispara la política
      // fail-closed del caller). Nunca se convierte un fallo en "todo OK".
      verdict = null;
    }
    // Solo un veredicto CONCLUYENTE corta la cascada. Un `available:false`
    // (capa caída/no aplica) NO corta: sigue a la siguiente capa.
    if (verdict !== null && verdict.available) return verdict;
  }
  return inconclusive;
}
