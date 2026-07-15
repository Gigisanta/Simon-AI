import type { LanguageModelUsage } from "ai";
import { prisma } from "@/lib/prisma";
import { maybeAlertGuardian, type AlertCategory } from "@/lib/alerts";
import { memoryTtlCutoff } from "@/lib/ai/memory";
import { interactionLogTtlCutoff } from "@/lib/retention";
import type { ModerationResult } from "@/lib/moderation";
import type { Defer } from "./types";

/**
 * Stage `notify` (ADR-1): telemetría, alertas al tutor/a y purgas TTL — todo
 * diferido vía `defer` (la ruta inyecta after() de next/server). NUNCA bloquea
 * ni rompe el chat (invariante M1).
 */

/**
 * Alerta de crisis al tutor/a (M-P2). UMBRAL: solo crisis/abuso — "riesgo" y
 * "alimentario" NO alertan por ahora, para no sobre-alertar (ver lib/alerts).
 *
 * PERF: el envío del email (Resend, red) NO puede sumar latencia a la respuesta
 * al menor. Los callers invocan esto vía `defer` (after() de next/server): corre
 * DESPUÉS de enviada la respuesta. El SafetyEvent (registro de la señal) ya se
 * persistió sincrónicamente antes; solo la NOTIFICACIÓN (email + marca
 * notifiedAt del dedupe) queda diferida. NUNCA lanza: cualquier fallo se loguea
 * acá adentro, así el error no se pierde aunque corra fuera del ciclo de la
 * request.
 */
export async function alertGuardianSafely(
  userId: string,
  safetyEventId: string | null,
  category: AlertCategory,
) {
  // L1: si el insert del SafetyEvent falló (eventId null) igual se intenta la
  // alerta — una crisis no puede quedar sin avisar al tutor/a por un fallo de
  // registro. El dedupe de maybeAlertGuardian es por query (no por este id) y
  // el notifiedAt solo se marca si hay eventId.
  try {
    await maybeAlertGuardian(userId, safetyEventId, category);
  } catch (err) {
    console.error("[chat] error alertando al tutor/a:", err);
  }
}

export type InteractionLogExtra = {
  model?: string | null;
  generationLatencyMs?: number | null;
  usage?: LanguageModelUsage | null;
  moderationInput?: ModerationResult | null;
  moderationOutput?: ModerationResult | null;
  safetyFlagFinal?: string | null;
  assistantMessageId?: string | null;
  safetyEventId?: string | null;
  historyMessagesSent?: number;
};

export type LogInteraction = (
  responsePath: string,
  extra?: InteractionLogExtra,
) => void;

/**
 * Telemetría de interacción (B4).
 * Registra UNA fila por request en cada path de respuesta, fire-and-forget vía
 * `defer`: NUNCA bloquea ni rompe el chat (invariante M1). JAMÁS guarda el
 * contenido de los mensajes ni texto de moderación — solo referencias, métricas
 * de performance y, de moderación, fuente + flag + categoría.
 *
 * Se construye una vez por request (con los datos fijos ya resueltos:
 * conversación y mensaje del menor persistidos) y cada rama la invoca con su
 * responsePath.
 */
export function createInteractionLogger(fixed: {
  userId: string;
  userRole: string | null | undefined;
  conversationId: string;
  userMessageId: string | null;
  requestStartedAt: number;
  defer: Defer;
}): LogInteraction {
  const { userId, userRole, conversationId, userMessageId, requestStartedAt, defer } =
    fixed;
  return function logInteraction(responsePath, extra = {}) {
    const totalLatencyMs = Date.now() - requestStartedAt;
    const usage = extra.usage ?? null;
    const inMod = extra.moderationInput ?? null;
    const outMod = extra.moderationOutput ?? null;
    defer(async () => {
      try {
        await prisma.interactionLog.create({
          data: {
            userId,
            conversationId,
            userMessageId,
            assistantMessageId: extra.assistantMessageId ?? null,
            safetyEventId: extra.safetyEventId ?? null,
            model: extra.model ?? null,
            totalLatencyMs,
            generationLatencyMs: extra.generationLatencyMs ?? null,
            inputTokens: usage?.inputTokens ?? null,
            outputTokens: usage?.outputTokens ?? null,
            totalTokens: usage?.totalTokens ?? null,
            reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? null,
            cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
            moderationInputSource: inMod?.source ?? null,
            moderationInputFlagged: inMod ? inMod.flagged : null,
            moderationInputCategory: inMod?.topCategory ?? inMod?.mappedFlag ?? null,
            moderationOutputSource: outMod?.source ?? null,
            moderationOutputFlagged: outMod ? outMod.flagged : null,
            moderationOutputCategory:
              outMod?.topCategory ?? outMod?.mappedFlag ?? null,
            responsePath,
            safetyFlagFinal: extra.safetyFlagFinal ?? null,
            historyMessagesSent: extra.historyMessagesSent ?? 0,
            roleAtRequest: userRole ?? "guardian",
          },
        });
      } catch (err) {
        console.error("[chat] error registrando InteractionLog (no bloquea):", err);
      }
    });
  };
}

/**
 * TTL (M-D / B4): purgas lazy DIFERIDAS.
 * La minimización de datos (UserMemory 90d, InteractionLog 180d) no tiene que
 * bloquear la respuesta al menor: se ejecuta tras responder, vía `defer`. Para
 * que un dato vencido no se USE aunque la purga quede pendiente, la lectura de
 * UserMemory (buildChatContext) filtra por el mismo corte temporal.
 * Se programa ANTES de la rama fija de crisis para que TODOS los caminos de
 * respuesta la incluyan: la rama crisis-regex retorna temprano y antes quedaba
 * fuera de la purga, a diferencia de las demás ramas fijas.
 */
export function scheduleTtlPurge(args: { userId: string; now: Date; defer: Defer }) {
  const { userId, now, defer } = args;
  defer(async () => {
    try {
      await prisma.userMemory.deleteMany({
        where: { userId, updatedAt: { lt: memoryTtlCutoff(now) } },
      });
      await prisma.interactionLog.deleteMany({
        where: { userId, createdAt: { lt: interactionLogTtlCutoff(now) } },
      });
    } catch (err) {
      console.error("[chat] error en purga TTL diferida (no bloquea):", err);
    }
  });
}
