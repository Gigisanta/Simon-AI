/**
 * Suite de context-budget.ts (B2.6) — recorte por presupuesto del contexto que
 * se arma para el modelo.
 *
 *   pnpm context-budget-suite
 *
 * Testea SOLO lógica pura y determinística (sin DB, sin red): estimación de
 * tokens, política de recorte por bucket (fichas/memorias: conservar el frente;
 * historial: conservar lo más reciente; resúmenes: filtrar vacíos), truncado del
 * rolling summary por límite de oración, y el invariante duro de `assembleContext`
 * (el mensaje ACTUAL del usuario nunca se recorta).
 *
 * Los tamaños de las fixtures se eligen para que `estimateTokens` (~4 chars/token)
 * dé costos exactos y los bordes de presupuesto sean determinísticos. Sale con
 * código 1 si algún caso falla (gate de CI).
 */
import type { KnowledgeCard, UserMemory } from "../src/generated/prisma/client";
import { createChecker } from "./suite-helpers";
import {
  estimateTokens,
  trimCards,
  trimMemories,
  trimPastSummaries,
  trimRollingSummary,
  trimHistory,
  assembleContext,
  type HistoryMsg,
} from "../src/lib/ai/context-budget";

const { check, done } = createChecker("Context-budget suite");

// --- Fixtures de costo controlado (cada una = 5 tokens estimados) ---
// Ficha: cardText = `${title}\n${body}` (source vacío). title de 1 char + "\n" +
// body → longitud total 20 → ceil(20/4) = 5 tokens.
function card(id: string): KnowledgeCard {
  return {
    title: id,
    body: "x".repeat(20 - 1 - id.length),
    source: "",
  } as KnowledgeCard;
}
// Memoria: cost = estimateTokens(content). content de 20 chars → 5 tokens.
function mem(id: string): UserMemory {
  return { content: id + "x".repeat(20 - id.length) } as UserMemory;
}
// Mensaje de historial: cost = estimateTokens(content). 20 chars → 5 tokens.
function msg(id: string, role = "user"): HistoryMsg {
  return { role, content: id + "x".repeat(20 - id.length) };
}

// ---------- 1. estimateTokens ----------
{
  check(estimateTokens("") === 0, "'' → 0 tokens");
  check(estimateTokens("abcd") === 1, "'abcd' (4 chars) → 1 token");
  check(estimateTokens("abcde") === 2, "'abcde' (5 chars) → 2 tokens (ceil)");
  check(estimateTokens("x".repeat(20)) === 5, "20 chars → 5 tokens");
  check(estimateTokens(123 as unknown as string) === 0, "no-string → 0 tokens");
}

// ---------- 2. trimCards: conserva el FRENTE (más relevante), descarta la cola ----------
{
  const cards = [card("a"), card("b"), card("c")]; // 5 + 5 + 5 = 15
  const kept = trimCards(cards, 10);
  check(kept.length === 2 && kept[0].title === "a" && kept[1].title === "b", "budget 10 → conserva las 2 primeras");
  // Presupuesto menor que una sola ficha → igual conserva la primera (mejor una que ninguna).
  const one = trimCards(cards, 4);
  check(one.length === 1 && one[0].title === "a", "budget 4 (< 1 ficha) → conserva la primera");
  check(trimCards([], 100).length === 0, "sin fichas → vacío");
}

// ---------- 3. trimMemories: conserva las más nuevas (frente), descarta las viejas ----------
{
  const memories = [mem("a"), mem("b"), mem("c")];
  const kept = trimMemories(memories, 10);
  check(kept.length === 2 && kept[0].content.startsWith("a") && kept[1].content.startsWith("b"), "budget 10 → 2 más nuevas");
  check(trimMemories(memories, 1).length === 1, "budget < 1 memoria → conserva 1");
}

// ---------- 4. trimPastSummaries: filtra vacíos y conserva el frente ----------
{
  const s = "s".repeat(20); // 5 tokens
  const summaries = ["", "   ", s, s, s];
  const kept = trimPastSummaries(summaries, 10);
  check(kept.length === 2, "filtra vacíos/whitespace y conserva 2 dentro del budget");
  check(kept.every((x) => x.trim().length > 0), "no quedan strings vacíos");
  check(trimPastSummaries(["", "  "], 100).length === 0, "solo vacíos → resultado vacío");
}

// ---------- 5. trimRollingSummary ----------
{
  check(trimRollingSummary(undefined) === undefined, "undefined → undefined");
  check(trimRollingSummary("   ") === undefined, "whitespace → undefined");
  check(trimRollingSummary("Hola.") === "Hola.", "corto → verbatim");

  // Largo con límite de oración dentro del tope (budget 5 → 20 code points).
  const long = "Uno dos tres. Cuatro cinco seis.";
  check(
    trimRollingSummary(long, 5) === "Uno dos tres.",
    "largo → corta en el último fin de oración dentro del tope",
  );

  // Largo SIN puntuación → corte crudo por caracteres (budget*4 code points).
  const noPunct = "a".repeat(30);
  const cut = trimRollingSummary(noPunct, 5);
  check(cut !== undefined && cut.length === 20 && /^a+$/.test(cut), "largo sin puntuación → corte crudo a budget*4 chars");
}

// ---------- 6. trimHistory: conserva lo MÁS RECIENTE (cola), orden preservado ----------
{
  const history = [msg("h1"), msg("h2"), msg("h3")]; // cronológico: viejo→nuevo, 5 c/u
  // total 15 ≤ budget 15 → intacto (histéresis: mientras entra, NO se toca).
  const all = trimHistory(history, 15);
  check(
    all.length === 3 && all[0].content.startsWith("h1"),
    "total ≤ budget → historial intacto (sin recorte, prefijo cacheable)",
  );
  // total 15 > budget 10 → recorta al target (10 * 0.6 = 6): entra solo h3 (5 tok).
  const kept = trimHistory(history, 10);
  check(
    kept.length === 1 && kept[0].content.startsWith("h3"),
    "excede budget → recorta al target (60%), conserva lo más reciente",
  );
  const one = trimHistory(history, 1);
  check(one.length === 1 && one[0].content.startsWith("h3"), "budget < 1 msg → conserva el más reciente");
  check(trimHistory([], 100).length === 0, "sin historial → vacío");
  // Histéresis: la ventana recortada absorbe mensajes nuevos SIN re-recortar
  // mientras no vuelva a exceder el budget (la ventana queda fija entre busts).
  const window = [...trimHistory(history, 12), msg("h4")]; // trim → [h3]; + h4 = 10 tok
  const stable = trimHistory(window, 12);
  check(
    stable.length === 2 && stable[0].content.startsWith("h3") && stable[1].content.startsWith("h4"),
    "histéresis: ventana recortada + msg nuevo ≤ budget → no re-recorta",
  );
}

// ---------- 7. assembleContext: el mensaje ACTUAL nunca se recorta ----------
{
  const currentUserText = "¿".repeat(5000); // enorme, muy por encima de cualquier budget
  const out = assembleContext({
    cards: [card("a")],
    memories: [mem("a")],
    pastSummaries: ["s".repeat(20)],
    rollingSummary: "resumen corto.",
    history: [msg("h1")],
    currentUserText,
  });
  check(out.currentUserText === currentUserText, "INVARIANTE: currentUserText pasa verbatim (jamás recortado)");
  // Con budgets por defecto (grandes) y fixtures chicas, nada se descarta.
  check(out.cards.length === 1 && out.memories.length === 1, "buckets chicos entran completos con budgets por defecto");
  check(out.history.length === 1 && out.pastSummaries.length === 1, "historial y resúmenes chicos entran completos");
  check(out.rollingSummary === "resumen corto.", "rolling summary corto pasa verbatim");
}

done();
