import type { KnowledgeCard, UserMemory } from "@/generated/prisma/client";

/**
 * Presupuesto de contexto (B2.6): recorta cada "bucket" del contexto que se
 * arma para el modelo a un tope de tokens, para no inflar el prompt (costo +
 * latencia + dilución de la señal) cuando una conversación se hace larga o hay
 * mucha memoria/fichas acumuladas.
 *
 * Es la contraparte del recorte grueso por cantidad (MAX_HISTORY_MESSAGES): acá
 * el recorte es por TAMAÑO estimado, por bucket, con una política de prioridad
 * explícita cuando algo sobra.
 *
 * INVARIANTE: el mensaje ACTUAL del usuario JAMÁS se recorta (pasa verbatim).
 *
 * Todo es lógica pura y determinística — testeada en scripts/memory-suite.ts
 * (sin DB, sin red).
 */

/**
 * Estimación barata de tokens: ~4 caracteres por token. No es exacta (no somos
 * un tokenizer), pero alcanza para presupuestar de forma conservadora.
 */
export function estimateTokens(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Presupuesto por bucket, en tokens estimados.
 *
 * INVARIANTE CROSS-FILE: `rollingSummary` * 4 (≈ chars) debe ser ≥
 * MAX_ROLLING_SUMMARY_CHARS (memory.ts, hoy 1200). Con 500 → 2000 ≥ 1200: el
 * rolling summary generado entra siempre en su presupuesto y trimRollingSummary
 * no lo recorta en el camino normal (solo actúa ante entradas anómalas).
 */
export const CONTEXT_BUDGETS = {
  pastSummaries: 600,
  memories: 400,
  rollingSummary: 500,
  cards: 800,
  history: 3000,
} as const;

/** Fila mínima de historial conversacional (misma forma que chat-messages). */
export type HistoryMsg = { role: string; content: string };

/** Texto que una ficha aporta al prompt (para estimar su costo en tokens). */
function cardText(card: KnowledgeCard): string {
  return `${card.title}\n${card.body}${card.source ? `\n${card.source}` : ""}`;
}

/**
 * Recorta una lista "de mayor a menor prioridad" a un presupuesto de tokens,
 * conservando desde el FRENTE (lo más prioritario) y descartando la cola. Se
 * mantiene siempre al menos el primer elemento aunque exceda por sí solo (mejor
 * un ítem grande que ninguno).
 */
function keepFromFront<T>(items: T[], budget: number, cost: (item: T) => number): T[] {
  const kept: T[] = [];
  let total = 0;
  for (const item of items) {
    const t = cost(item);
    if (kept.length > 0 && total + t > budget) break;
    kept.push(item);
    total += t;
  }
  return kept;
}

/**
 * Fichas: llegan rankeadas (mejor primero, selectRelevantCards). Se recorta la
 * cola (las menos relevantes) para entrar en el presupuesto.
 */
export function trimCards(
  cards: KnowledgeCard[],
  budget: number = CONTEXT_BUDGETS.cards,
): KnowledgeCard[] {
  return keepFromFront(cards, budget, (c) => estimateTokens(cardText(c)));
}

/**
 * Memorias: llegan ordenadas por updatedAt DESC (más nuevas primero). Se
 * conservan las más nuevas y se descartan las más viejas (recorte por updatedAt
 * ascendente) para entrar en el presupuesto.
 */
export function trimMemories(
  memories: UserMemory[],
  budget: number = CONTEXT_BUDGETS.memories,
): UserMemory[] {
  return keepFromFront(memories, budget, (m) => estimateTokens(m.content));
}

/** Resúmenes pasados: se conservan los primeros que entren en el presupuesto. */
export function trimPastSummaries(
  summaries: string[],
  budget: number = CONTEXT_BUDGETS.pastSummaries,
): string[] {
  const nonEmpty = summaries.filter((s) => typeof s === "string" && s.trim().length > 0);
  return keepFromFront(nonEmpty, budget, (s) => estimateTokens(s));
}

/**
 * Resumen incremental de la conversación activa: si excede el presupuesto se
 * trunca por caracteres (aprox. budget*4). Nunca se descarta entero.
 */
export function trimRollingSummary(
  summary: string | undefined,
  budget: number = CONTEXT_BUDGETS.rollingSummary,
): string | undefined {
  if (!summary || !summary.trim()) return undefined;
  if (estimateTokens(summary) <= budget) return summary;
  const hardCut = summary.slice(0, budget * 4);
  // Preferimos cortar en el último final de oración dentro del tope, para no
  // partir una palabra ni una idea a la mitad. Si el texto no tiene ningún
  // límite de oración (sin puntuación), se cae al corte crudo por caracteres.
  const boundary = Math.max(
    hardCut.lastIndexOf(". "),
    hardCut.lastIndexOf(".\n"),
    hardCut.lastIndexOf("! "),
    hardCut.lastIndexOf("? "),
    hardCut.lastIndexOf("… "),
  );
  return boundary > 0 ? hardCut.slice(0, boundary + 1) : hardCut;
}

/**
 * Historial: llega en orden cronológico (más viejo primero). Se conservan los
 * mensajes MÁS RECIENTES y se descartan los más viejos (desde el frente) para
 * entrar en el presupuesto. Se mantiene al menos el más reciente.
 */
export function trimHistory(
  history: HistoryMsg[],
  budget: number = CONTEXT_BUDGETS.history,
): HistoryMsg[] {
  const kept: HistoryMsg[] = [];
  let total = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const t = estimateTokens(history[i].content);
    if (kept.length > 0 && total + t > budget) break;
    kept.unshift(history[i]);
    total += t;
  }
  return kept;
}

/**
 * Arma el contexto recortado por presupuesto. Aplica cada bucket con su tope y
 * su política de recorte (fichas: cola; historial: lo más viejo; memorias: por
 * updatedAt ascendente; resúmenes: se preservan). El mensaje actual del usuario
 * se devuelve verbatim, JAMÁS recortado.
 */
export function assembleContext(input: {
  cards: KnowledgeCard[];
  memories: UserMemory[];
  pastSummaries: string[];
  rollingSummary?: string;
  history: HistoryMsg[];
  currentUserText: string;
}): {
  cards: KnowledgeCard[];
  memories: UserMemory[];
  pastSummaries: string[];
  rollingSummary?: string;
  history: HistoryMsg[];
  currentUserText: string;
} {
  return {
    cards: trimCards(input.cards),
    memories: trimMemories(input.memories),
    pastSummaries: trimPastSummaries(input.pastSummaries),
    rollingSummary: trimRollingSummary(input.rollingSummary),
    history: trimHistory(input.history),
    currentUserText: input.currentUserText, // invariante: nunca se recorta
  };
}
