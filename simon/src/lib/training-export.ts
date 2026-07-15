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
 * persona genérica). Se excluyen conversaciones que tocaron crisis/abuso, se
 * corta el ejemplo en la primera señal de seguridad, y TODO contenido pasa por
 * redacción de PII estructural (redactPII, ADR-5) antes de tocar el JSONL.
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

// ---------- Redacción de PII (ADR-5, Ley 25.326) ----------

/**
 * Patrones de PII ESTRUCTURAL que se redactan del contenido antes de escribir
 * el JSONL: `texto` → `[REDACTADO:<tipo>]`. Determinístico y auditable.
 *
 * ORDEN: importa. URLs con credenciales van primero (contienen otras formas);
 * email antes que teléfono (los emails traen dígitos); DNI con puntos/keyword
 * antes que teléfono (si no, un DNI pelado se etiquetaría como teléfono).
 *
 * LÍMITE DOCUMENTADO: regex ≠ NER. Detecta formas estructurales (email,
 * teléfono AR, DNI, dirección con altura, credenciales en URL), NO nombres
 * propios en texto libre. El sesgo es hacia SOBRE-redактar (p. ej. un monto
 * "1.500.000" cae como DNI con puntos): perder un número en un dataset de
 * entrenamiento es aceptable; filtrar el DNI de un menor, no.
 */
const PII_PATTERNS: readonly { tipo: string; re: RegExp }[] = [
  // URL con credenciales embebidas (esquema://user:pass@host/...).
  { tipo: "url-credenciales", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@]+:[^\s/@]+@\S+/gi },
  { tipo: "email", re: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  // DNI con keyword ("dni 40123456", "documento: 40.123.456").
  { tipo: "dni", re: /\b(?:dni|documento)[\s:.]*\d{1,2}\.?\d{3}\.?\d{3}(?!\d)/gi },
  // DNI con puntos de miles (12.345.678) — la forma escrita típica.
  { tipo: "dni", re: /(?<!\d)\d{1,2}\.\d{3}\.\d{3}(?!\d)/g },
  // Teléfono AR: +54 opcional, 9 opcional, característica opcional, 15
  // opcional, y 7–8 dígitos de línea (con separadores comunes).
  {
    tipo: "telefono",
    re: /(?<!\d)(?:\+?54[\s.-]?)?(?:9[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-])?(?:15[\s.-]?)?\d{3,4}[\s.-]?\d{4}(?!\d)/g,
  },
  // Dirección con altura: vía + nombre + número (calle San Martín 1234).
  {
    tipo: "direccion",
    re: /\b(?:calle|av\.?|avenida|pasaje|pje\.?|diagonal|ruta|bo?ulevard?|bv\.?)\s+[a-záéíóúñü][a-záéíóúñü0-9 .'-]{1,40}?\s+\d{1,5}\b/gi,
  },
];

/**
 * Redacta PII estructural: cada match se reemplaza por `[REDACTADO:<tipo>]`.
 * Pura y sin estado (los literales regex con /g se re-crean por llamada vía
 * el array, y `replace` no depende de lastIndex).
 */
export function redactPII(text: string): string {
  let out = text;
  for (const { tipo, re } of PII_PATTERNS) {
    out = out.replace(re, `[REDACTADO:${tipo}]`);
  }
  return out;
}

/**
 * Convierte una conversación en un ejemplo de entrenamiento, o null si no
 * califica (tocó crisis/abuso, o quedó con menos de `minTurns` pares tras el
 * corte). `minTurns` nunca baja del piso duro `MIN_PAIRS_FLOOR`. El contenido
 * de CADA mensaje pasa por redactPII (ADR-5) — el system prompt es la persona
 * genérica y no lo necesita.
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
        ...msgs.map((m) => ({ role: m.role as ChatRole, content: redactPII(m.content) })),
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
