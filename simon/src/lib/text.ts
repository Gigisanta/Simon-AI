/**
 * Utilidades de texto puras y compartidas. Testeadas en scripts/memory-suite.ts.
 */

/**
 * Trunca `text` a lo sumo `maxCodePoints` PUNTOS DE CÓDIGO Unicode.
 *
 * Un `.slice(0, n)` corta por UNIDADES de código (UTF-16), así que puede partir
 * un surrogate pair a la mitad y dejar una unidad suelta (emoji/carácter astral
 * roto → U+FFFD). Acá se corta por code points, que nunca parte un par.
 *
 * DECISIÓN — code points, NO grapheme clusters: cortar por graphemes
 * (Intl.Segmenter) evitaría además partir secuencias ZWJ (familias de emoji,
 * banderas), pero rompería una GARANTÍA de camino crítico: `MAX_FACT_CHARS`
 * (memory.ts) acota `UserMemory.content`, texto del índice btree único
 * `@@unique([userId, kind, content])`, cuyo límite de fila (~2704 bytes) se
 * respeta porque N code points ≤ 4·N bytes UTF-8 (300 → ≤1200 bytes). Un cluster
 * ZWJ puede pesar decenas de bytes, así que truncar por graphemes reventaría esa
 * cota. Por code points la cota se mantiene y, de yapa, se arregla el bug del
 * surrogate. Trade-off aceptado: un ZWJ podría cortarse en un punto de código
 * intermedio (queda un emoji base válido, nunca una unidad suelta) — cosmético.
 */
export function safeTruncate(text: string, maxCodePoints: number): string {
  if (typeof text !== "string") return "";
  if (maxCodePoints <= 0) return "";
  // Fast path: la longitud en unidades es cota superior de los code points
  // (points ≤ units). Si ya entra por unidades, entra por points y ningún corte
  // es posible → se evita el Array.from.
  if (text.length <= maxCodePoints) return text;
  const points = Array.from(text); // el iterador de string va por code point
  if (points.length <= maxCodePoints) return text;
  return points.slice(0, maxCodePoints).join("");
}

// Caracteres invisibles de ancho cero / formato que `String.prototype.trim()` NO
// elimina (no son whitespace): ZWSP, ZWNJ, ZWJ, word joiner y BOM/ZWNBSP. Un
// mensaje compuesto solo por estos NO es contenido real y debe tratarse vacío.
const ZERO_WIDTH = /[\u200B\u200C\u200D\u2060\uFEFF]/g;

/**
 * ¿El texto tiene contenido visible? `!text.trim()` deja pasar mensajes hechos
 * solo de caracteres de ancho cero (p.ej. "​‍"). Acá se quitan esos
 * invisibles ANTES de recortar espacios para el chequeo de vacío. NO muta el
 * texto original (que se guarda/mostra verbatim): es solo un predicado.
 */
export function hasVisibleContent(text: string): boolean {
  if (typeof text !== "string") return false;
  return text.replace(ZERO_WIDTH, "").trim().length > 0;
}
