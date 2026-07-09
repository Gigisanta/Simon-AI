import { PERSONA } from "@/lib/ai/system-prompt";

/**
 * Lógica PURA de armado del dataset de fine-tuning (B4.4).
 *
 * El script scripts/export-training.ts hace el I/O (query a la DB, escritura de
 * JSONL); acá vive todo el filtrado/corte/anonimización como funciones puras,
 * testeadas en scripts/training-export-suite.ts (sin DB, sin red).
 *
 * CAMINO CRÍTICO (Ley 25.326 — datos de menores): el dataset NUNCA incluye
 * userName, memorias ni ningún dato personal en el system prompt (se usa la
 * persona genérica). Se excluyen conversaciones que tocaron crisis/abuso y se
 * corta el ejemplo en la primera señal de seguridad.
 */

/** Mensaje tal como sale de la DB (rol + contenido + flag de seguridad). */
export type ExportMessage = { role: string; content: string; safetyFlag: string | null };

/** Rol en formato chat-completions. */
export type ChatRole = "system" | "user" | "assistant";

export interface TrainingExample {
  /** Línea JSONL en formato chat-completions. */
  record: { messages: { role: ChatRole; content: string }[] };
  /** Sidecar de metadatos (una línea por ejemplo). */
  meta: {
    conversationId: string;
    turnCount: number;
    createdAtMonth: string; // "YYYY-MM"
    qualityTier: "high" | "medium";
  };
}

/**
 * System prompt genérico del dataset: la persona base de Simón, SIN userName ni
 * memorias (anonimización). Reutiliza la persona canónica (única fuente).
 */
export const TRAINING_SYSTEM_PROMPT = PERSONA;

/**
 * Categorías de SafetyEvent que EXCLUYEN toda la conversación del dataset:
 * crisis y abuso (más sus equivalentes crudos de la Moderation API). Una
 * conversación que tocó estos temas no se distribuye como material de
 * entrenamiento.
 */
const BLOCKING_SAFETY_CATEGORIES = new Set([
  "crisis",
  "abuso",
  "self-harm",
  "self-harm/intent",
  "self-harm/instructions",
  "sexual/minors",
]);

export function isBlockingSafetyCategory(category: string): boolean {
  return BLOCKING_SAFETY_CATEGORIES.has(category);
}

/** ¿Alguna de las categorías de SafetyEvent de la conversación bloquea el export? */
export function hasBlockingSafetyEvent(categories: string[]): boolean {
  return categories.some(isBlockingSafetyCategory);
}

/**
 * Corta la conversación en el PRIMER mensaje con safetyFlag != null (exclusivo):
 * ese mensaje y todo lo posterior se descartan. Así el ejemplo nunca incluye
 * plantillas de crisis, sustituciones de moderación, avisos de sesión, etc.
 */
export function truncateAtFirstFlag(messages: ExportMessage[]): ExportMessage[] {
  const idx = messages.findIndex((m) => m.safetyFlag != null);
  return idx === -1 ? messages : messages.slice(0, idx);
}

/** Descarta mensajes iniciales que no sean del usuario (el ejemplo abre con user). */
export function dropLeadingNonUser(messages: ExportMessage[]): ExportMessage[] {
  let start = 0;
  while (start < messages.length && messages[start].role !== "user") start++;
  return messages.slice(start);
}

/** Recorta la cola hasta que el último mensaje sea del asistente. */
export function trimToLastAssistant(messages: ExportMessage[]): ExportMessage[] {
  let end = messages.length;
  while (end > 0 && messages[end - 1].role !== "assistant") end--;
  return messages.slice(0, end);
}

/** Cuenta pares user→assistant (un user seguido inmediatamente de un assistant). */
export function countPairs(messages: ExportMessage[]): number {
  let pairs = 0;
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === "assistant" && messages[i - 1].role === "user") {
      pairs++;
    }
  }
  return pairs;
}

/** "YYYY-MM" (UTC) de una fecha, para segmentar el dataset por mes. */
export function createdAtMonth(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Tier de calidad heurístico por longitud de la charla: conversaciones largas
 * (≥6 pares) son "high"; el resto "medium". Simple y determinístico; sirve para
 * ponderar/filtrar el dataset después.
 */
export function qualityTier(pairs: number): "high" | "medium" {
  return pairs >= 6 ? "high" : "medium";
}

/** Piso duro de pares user/assistant para incluir una conversación. */
export const MIN_PAIRS_FLOOR = 3;

/**
 * Convierte una conversación en un ejemplo de entrenamiento, o null si no
 * califica (tocó crisis/abuso, o quedó con menos de `minTurns` pares tras el
 * corte). `minTurns` nunca baja del piso duro `MIN_PAIRS_FLOOR`.
 */
export function buildTrainingExample(
  conv: {
    id: string;
    createdAt: Date;
    messages: ExportMessage[];
    safetyEventCategories: string[];
  },
  opts: { minTurns?: number } = {},
): TrainingExample | null {
  if (hasBlockingSafetyEvent(conv.safetyEventCategories)) return null;

  const minTurns = Math.max(MIN_PAIRS_FLOOR, opts.minTurns ?? MIN_PAIRS_FLOOR);

  // Solo turnos conversacionales, corte en la primera señal, abrir en user y
  // cerrar en assistant.
  let msgs = conv.messages.filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  msgs = truncateAtFirstFlag(msgs);
  msgs = dropLeadingNonUser(msgs);
  msgs = trimToLastAssistant(msgs);

  const pairs = countPairs(msgs);
  if (pairs < minTurns) return null;

  return {
    record: {
      messages: [
        { role: "system", content: TRAINING_SYSTEM_PROMPT },
        ...msgs.map((m) => ({ role: m.role as ChatRole, content: m.content })),
      ],
    },
    meta: {
      conversationId: conv.id,
      turnCount: pairs,
      createdAtMonth: createdAtMonth(conv.createdAt),
      qualityTier: qualityTier(pairs),
    },
  };
}

/** Path del sidecar de metadatos: `foo.jsonl` → `foo.meta.jsonl`. */
export function metaSidecarPath(out: string): string {
  return out.endsWith(".jsonl")
    ? out.replace(/\.jsonl$/, ".meta.jsonl")
    : `${out}.meta.jsonl`;
}

/** Roles válidos para el flag CLI --role. */
export type RoleFilter = "child" | "guardian" | "all";

export function parseRoleFilter(value: string | undefined): RoleFilter {
  if (value === "child" || value === "guardian") return value;
  return "all";
}
