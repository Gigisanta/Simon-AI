import { generateText } from "ai";
import { prisma } from "@/lib/prisma";
import { aiConfigured, generationTimeoutMs, smallModel } from "./provider";
import { stripDelimiterSequences } from "./system-prompt";

/**
 * Capa 2 de memoria (docs/research-architecture.md §4.1): resumen lazy de la
 * última conversación "cerrada" + extracción de hechos atómicos SIN PII.
 *
 * Camino crítico (datos de menores, §4.2): minimización estricta —
 *   - El prompt PROHÍBE nombres, direcciones, escuelas y teléfonos.
 *   - Los hechos van a UserMemory con TTL de 90 días (MEMORY_TTL_DAYS).
 *   - Nada de lo que falle acá puede romper el chat: todo va en try/catch.
 */

// M-D (research §4.2): TTL de todo registro de memoria extraída. Se aplica
// lazy en el query-path del chat (route.ts hace deleteMany antes de leer
// UserMemory), sin cron: la primera interacción pasada la ventana purga.
export const MEMORY_TTL_DAYS = 90;

/** Fecha de corte del TTL: memorias con updatedAt anterior se borran. */
export function memoryTtlCutoff(now: Date): Date {
  return new Date(now.getTime() - MEMORY_TTL_DAYS * 24 * 60 * 60 * 1000);
}

const STALE_AFTER_MS = 60 * 60 * 1000; // 1h sin actividad = conversación cerrada
const MIN_MESSAGES_TO_SUMMARIZE = 4;
const MAX_FACTS = 5;
const MAX_TRANSCRIPT_MESSAGES = 30; // ventana enviada al modelo small
const MAX_CHARS_PER_MESSAGE = 500;
const MAX_SUMMARY_CHARS = 900; // tope defensivo ~120 palabras

// --- Rolling summary (B2): resumen incremental de la conversación EN CURSO ---
// Se dispara cuando el hilo ya es largo (>60 mensajes) y quedó atrasado (>20
// mensajes posteriores al último cubierto): así el prompt no manda todo el
// historial. Umbrales pensados para no gastar el modelo small en hilos cortos.
export const ROLLING_TRIGGER_TOTAL = 60;
export const ROLLING_TRIGGER_UNCOVERED = 20;
const MAX_ROLLING_TRANSCRIPT_MESSAGES = 40; // ventana incremental al modelo small
const MAX_ROLLING_SUMMARY_CHARS = 1200; // tope defensivo ~150 palabras

/**
 * Parseo defensivo de la salida del modelo small. Espera
 * `{"resumen": "...", "hechos": ["...", ...]}` (con o sin fence de código).
 * Si el JSON viene roto o con tipos inesperados, se descarta lo inválido sin
 * lanzar jamás: JSON roto → { summary: null, facts: [] }.
 * Función pura — testeada en scripts/memory-suite.ts.
 */
export function parseSummaryAndFacts(raw: string): {
  summary: string | null;
  facts: string[];
} {
  const none = { summary: null, facts: [] as string[] };
  if (typeof raw !== "string" || !raw.trim()) return none;
  // El modelo puede envolver el JSON en ```json ... ``` o agregar texto
  // alrededor: nos quedamos con el primer objeto {...} plausible.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return none;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return none;
  }
  const obj = parsed as Record<string, unknown>;
  const summary =
    typeof obj.resumen === "string" && obj.resumen.trim()
      ? obj.resumen.trim().slice(0, MAX_SUMMARY_CHARS)
      : null;
  const facts = Array.isArray(obj.hechos)
    ? obj.hechos
        .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
        .map((f) => f.trim())
        .slice(0, MAX_FACTS)
    : [];
  return { summary, facts };
}

function summaryPrompt(transcript: string): string {
  return `Analizá la siguiente conversación entre una persona y el asistente Simón.

Reglas ESTRICTAS (privacidad de menores — sin excepciones):
- "resumen": resumen en TERCERA persona ("la persona contó que..."), máximo 120 palabras. PROHIBIDO incluir nombres propios, apellidos, direcciones, escuelas, teléfonos, redes sociales o cualquier dato que permita identificar a alguien.
- "hechos": hasta 5 hechos atómicos y cortos, útiles para acompañar mejor a la persona en futuras charlas (temas que le preocupan, gustos, situación general). PROHIBIDO incluir nombres, direcciones, escuelas, teléfonos o datos identificables. Si no hay hechos útiles, devolvé una lista vacía.
- Respondé SOLO con JSON válido, sin texto adicional:
{"resumen": "...", "hechos": ["...", "..."]}

Conversación:
${transcript}`;
}

/**
 * Resume la conversación MÁS RECIENTE del usuario que quedó "cerrada"
 * (summarizedAt null, ≥4 mensajes, sin actividad hace >1h) y extrae hasta 5
 * hechos sin PII hacia UserMemory (kind "fact", sin duplicados exactos).
 *
 * Lazy: se dispara fire-and-forget al crear una conversación nueva (route.ts
 * la invoca vía `after()` de next/server, así nunca bloquea la respuesta).
 * Las conversaciones demasiado cortas se marcan summarizedAt sin summary para
 * no reprocesarlas. Un error del LLM deja summarizedAt en null (se reintenta
 * en la próxima conversación nueva). Nunca lanza: cualquier error se loguea.
 */
export async function summarizeStaleConversation(userId: string): Promise<void> {
  try {
    if (!aiConfigured()) return;
    const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
    // Hasta 5 candidatas por pasada: las cortas se marcan y se sigue.
    const candidates = await prisma.conversation.findMany({
      where: { userId, summarizedAt: null, updatedAt: { lt: staleBefore } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });

    for (const conv of candidates) {
      if (conv._count.messages < MIN_MESSAGES_TO_SUMMARIZE) {
        // Nada que resumir: se marca procesada (preservando updatedAt para no
        // reordenar el listado de conversaciones) y se pasa a la siguiente.
        await prisma.conversation.update({
          where: { id: conv.id },
          data: { summarizedAt: new Date(), updatedAt: conv.updatedAt },
        });
        continue;
      }

      const messages = await prisma.message.findMany({
        where: { conversationId: conv.id },
        orderBy: { createdAt: "desc" },
        take: MAX_TRANSCRIPT_MESSAGES,
        select: { role: true, content: true },
      });
      const transcript = messages
        .reverse()
        .map(
          (m) =>
            `${m.role === "user" ? "Persona" : "Simón"}: ${m.content.slice(0, MAX_CHARS_PER_MESSAGE)}`,
        )
        .join("\n");

      const generated = await generateText({
        model: smallModel(),
        prompt: summaryPrompt(transcript),
        temperature: 0.2,
        maxOutputTokens: 500,
        // M3: acota la generación del resumen; si el modelo se cuelga se aborta
        // y el catch de esta función lo traga (la memoria nunca rompe el chat).
        abortSignal: AbortSignal.timeout(generationTimeoutMs()),
      });
      const { summary, facts } = parseSummaryAndFacts(generated.text);

      // Aunque el parseo falle (summary null), se marca summarizedAt para no
      // reintentar en loop una salida que el modelo no sabe formatear.
      await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          summary: summary ? stripDelimiterSequences(summary) : null,
          summarizedAt: new Date(),
          updatedAt: conv.updatedAt, // preservar orden del listado
        },
      });

      if (facts.length > 0) {
        // Dedupe exacto contra los hechos ya guardados del usuario.
        const existing = await prisma.userMemory.findMany({
          where: { userId, kind: "fact" },
          select: { content: true },
        });
        const known = new Set(existing.map((e) => e.content));
        const fresh = facts
          .map((f) => stripDelimiterSequences(f).trim())
          .filter((f) => f.length > 0 && !known.has(f));
        if (fresh.length > 0) {
          await prisma.userMemory.createMany({
            data: fresh.map((content) => ({ userId, kind: "fact", content })),
          });
        }
      }
      return; // una conversación resumida por pasada alcanza (lazy)
    }
  } catch (err) {
    // Nunca romper el chat por la memoria: log y listo.
    console.error("[memory] error resumiendo conversación:", err);
  }
}

/**
 * Decide si toca regenerar el rolling summary de una conversación activa: el
 * hilo ya es largo Y quedó atrasado. Función pura — testeada en memory-suite.
 */
export function rollingSummaryDue(totalMessages: number, uncovered: number): boolean {
  return totalMessages > ROLLING_TRIGGER_TOTAL && uncovered > ROLLING_TRIGGER_UNCOVERED;
}

function rollingSummaryPrompt(previous: string | null, transcript: string): string {
  const prev = previous?.trim()
    ? `Resumen previo de ESTA misma conversación (actualizalo integrándolo con lo nuevo, no lo repitas literal):\n${previous.trim()}\n\n`
    : "";
  return `Estás resumiendo una conversación EN CURSO entre una persona y el asistente Simón, para no perder el contexto de lo ya hablado en esta misma charla.

${prev}Reglas ESTRICTAS (privacidad de menores — sin excepciones):
- Devolvé UN solo resumen actualizado (resumen previo + mensajes nuevos), en TERCERA persona ("la persona contó que..."), máximo 150 palabras.
- PROHIBIDO incluir nombres propios, apellidos, direcciones, escuelas, teléfonos, redes sociales o cualquier dato que permita identificar a alguien.
- Quedate con lo importante para dar continuidad (temas, preocupaciones, en qué quedaron); descartá el chiquiteo.
- Respondé SOLO con JSON válido, sin texto adicional:
{"resumen": "..."}

Mensajes nuevos:
${transcript}`;
}

/**
 * Parseo defensivo del rolling summary. Espera `{"resumen": "..."}` (tolera
 * fence/texto alrededor). JSON roto o resumen no-string → null (no se pisa el
 * resumen previo con basura). Función pura — testeada en memory-suite.
 */
export function parseRollingSummary(raw: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const resumen = (parsed as Record<string, unknown>).resumen;
  return typeof resumen === "string" && resumen.trim()
    ? resumen.trim().slice(0, MAX_ROLLING_SUMMARY_CHARS)
    : null;
}

/**
 * Regenera (incremental) el rolling summary de una conversación ACTIVA cuando
 * `rollingSummaryDue` da true: toma el rollingSummary previo + los mensajes
 * posteriores a `rollingSummarizedUntil` y produce un resumen actualizado ≤150
 * palabras, sin PII, sanitizado.
 *
 * Lazy: se dispara fire-and-forget vía `after()` desde el path normal de chat,
 * así nunca bloquea la respuesta. Nunca lanza (cualquier error se loguea) y NO
 * altera `updatedAt` (para no reordenar el listado de conversaciones).
 */
export async function updateRollingSummary(conversationId: string): Promise<void> {
  try {
    if (!aiConfigured()) return;

    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        rollingSummary: true,
        rollingSummarizedUntil: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    if (!conv) return;

    const cutoff = conv.rollingSummarizedUntil;
    const afterCutoff = cutoff ? { createdAt: { gt: cutoff } } : {};
    const uncovered = await prisma.message.count({
      where: { conversationId, role: { in: ["user", "assistant"] }, ...afterCutoff },
    });
    if (!rollingSummaryDue(conv._count.messages, uncovered)) return;

    const newMessages = await prisma.message.findMany({
      where: { conversationId, role: { in: ["user", "assistant"] }, ...afterCutoff },
      orderBy: { createdAt: "asc" },
      take: MAX_ROLLING_TRANSCRIPT_MESSAGES,
      select: { role: true, content: true, createdAt: true },
    });
    if (newMessages.length === 0) return;

    const transcript = newMessages
      .map(
        (m) =>
          `${m.role === "user" ? "Persona" : "Simón"}: ${m.content.slice(0, MAX_CHARS_PER_MESSAGE)}`,
      )
      .join("\n");

    const generated = await generateText({
      model: smallModel(),
      prompt: rollingSummaryPrompt(conv.rollingSummary, transcript),
      temperature: 0.2,
      maxOutputTokens: 500,
      abortSignal: AbortSignal.timeout(generationTimeoutMs()),
    });
    const summary = parseRollingSummary(generated.text);
    if (!summary) return; // no pisar el resumen previo con una salida ilegible

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        rollingSummary: stripDelimiterSequences(summary),
        // Cubre hasta el último mensaje incluido en esta pasada.
        rollingSummarizedUntil: newMessages[newMessages.length - 1].createdAt,
        updatedAt: conv.updatedAt, // preservar orden del listado
      },
    });
  } catch (err) {
    console.error("[memory] error actualizando rolling summary:", err);
  }
}
