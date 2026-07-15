import type { ModelMessage } from "ai";
import { prisma } from "@/lib/prisma";
import { createTtlSingleFlight } from "@/lib/single-flight";
import { assembleContext } from "@/lib/ai/context-budget";
import { historyToModelMessages, type HistoryRow } from "@/lib/chat-messages";
import { buildSystemPrompt, selectRelevantCards } from "@/lib/ai/system-prompt";
import { crisisSystemAddendum, type SafetyFlag } from "@/lib/safety";
import { memoryTtlCutoff } from "@/lib/ai/memory";
import {
  isFirstOfSession,
  sessionLimitApplies,
  sessionState,
  sessionWindowQuery,
} from "@/lib/session-limit";
import { deriveChildAge } from "@/lib/guardian";
import type { ChatUser } from "./types";

/**
 * Stage `buildContext` (ADR-1): todo lo que la generación necesita — fichas,
 * memoria, resúmenes, historial recortado por presupuesto de tokens, system
 * prompt y estado de sesión — en UNA pasada paralela a la DB.
 */

// --- Cache in-process de la base de conocimiento (perf) ---
// KnowledgeCard.findMany() traía el corpus ENTERO en cada request. El corpus es
// chico (< ~200 fichas) y de baja frecuencia de cambio (curación manual), así
// que se cachea en memoria del proceso con TTL corto.
// TRADEOFF MULTI-INSTANCIA: cada instancia serverless tiene su propio cache, por
// lo que una edición de fichas puede tardar hasta KNOWLEDGE_CACHE_TTL_MS en
// reflejarse en TODAS las instancias. Aceptable: no hay lecturas críticas de
// fichas (a diferencia de seguridad/consentimiento, que nunca se cachean).
const KNOWLEDGE_CACHE_TTL_MS = 5 * 60_000;

// Single-flight + TTL: dentro del TTL devuelve la misma referencia de array (de
// la que depende el WeakMap de tokenizeCards en system-prompt.ts); al vencer, N
// requests concurrentes comparten UNA sola findMany() en vez de dispararla N
// veces. Un error no se cachea → la próxima request reintenta.
const loadKnowledgeCards = createTtlSingleFlight(
  () => prisma.knowledgeCard.findMany(),
  KNOWLEDGE_CACHE_TTL_MS,
);

export type ChatContextBundle = {
  /** Historial (ya recortado por presupuesto de tokens) en formato del modelo. */
  dbHistory: ModelMessage[];
  /** dbHistory + el único mensaje del cliente aceptado (F1). */
  modelMessages: ModelMessage[];
  /** System prompt base (persona + fichas + memoria + resúmenes). */
  baseSystem: string;
  /** Addendum de contención de "riesgo" (se antepone al regenerar). */
  riesgoAddendum: string;
  /** System para la generación paralela: base + addendum si la regex marcó riesgo. */
  systemForParallel: string;
  /** Estado de la ventana de sesión (M-S7): "ok" | "warn" | "over". */
  sState: ReturnType<typeof sessionState>;
  /** true si corresponde anexar el aviso de pausa (aún sin dedupe multi-tab). */
  needsSessionWarn: boolean;
  /** Respuestas del asistente ya guardadas en esta conversación (M-F3). */
  assistantCount: number;
};

export async function buildChatContext(args: {
  user: ChatUser;
  conversationId: string;
  historyRows: HistoryRow[];
  userText: string;
  /** Flag de la capa regex (a esta altura: null | "riesgo"). */
  regexFlag: SafetyFlag;
  now: Date;
}): Promise<ChatContextBundle> {
  const { user, conversationId, historyRows, userText, regexFlag, now } = args;
  const userId = user.id;
  // Rol del interlocutor (B3): condiciona la persona y el límite de sesión.
  const role = user.role;

  // --- Contexto (fichas + memoria + resumen) + ventana de sesión, en paralelo ---
  // Todo lo que necesita la generación, más los mensajes recientes para el
  // límite de sesión (M-S7). La sesión se mide sobre TODAS las conversaciones
  // del usuario (el límite es por uso, no por hilo).
  const [cards, memories, pastSummariesRows, activeConv, recentMessages] =
    await Promise.all([
      // Fichas: cache in-process con TTL corto (perf) en vez de traer el corpus
      // entero por request.
      loadKnowledgeCards(),
      prisma.userMemory.findMany({
        // Filtro TTL: no usar memorias vencidas aunque la purga (defer) esté
        // pendiente — mismo corte que el deleteMany diferido (notify.ts).
        where: { userId, updatedAt: { gte: memoryTtlCutoff(now) } },
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
      // Resúmenes de charlas pasadas ya cerradas (B2.5): hasta 3, las más recientes.
      prisma.conversation.findMany({
        where: { userId, id: { not: conversationId }, summary: { not: null } },
        orderBy: { summarizedAt: "desc" },
        take: 3,
        select: { summary: true },
      }),
      // Rolling summary de ESTA conversación (B2.4) + conteo de mensajes del
      // asistente ya guardados (M-F3: recordatorio de IA cada 10 turnos). El
      // _count filtrado evita una query extra al final. Conversación nueva → 0.
      prisma.conversation.findUnique({
        where: { id: conversationId },
        select: {
          rollingSummary: true,
          _count: { select: { messages: { where: { role: "assistant" } } } },
        },
      }),
      // Ventana de sesión (M-S7 / M-F1): SOLO para menores (B3.2). Guardians:
      // sin cálculo (no hay warn/over/primer-mensaje), se evita la query.
      // La construcción de la query (ventana temporal de 75 min, SIN `take`,
      // filtro cross-conversation por userId) vive en sessionWindowQuery —
      // función pura testeada, para que reintroducir un `take` rompa el gate.
      sessionLimitApplies(role)
        ? prisma.message.findMany(sessionWindowQuery(userId, now))
        : Promise.resolve(
            [] as { createdAt: Date; role: string; safetyFlag: string | null }[],
          ),
    ]);

  // Estado de sesión: se calcula acá pero se DECIDE en run.ts, después de la
  // moderación de entrada (una crisis real gana sobre el cierre por tiempo).
  // Para guardians recentMessages viene vacío → siempre "ok", nunca warn/over.
  const sState = sessionState(
    recentMessages.map((m) => m.createdAt),
    now,
  );
  // Aviso de pausa a los 30 min, UNA sola vez por sesión: se considera dado si
  // ya hay un mensaje assistant reciente con safetyFlag "session-warn".
  const needsSessionWarn =
    sState === "warn" &&
    !recentMessages.some(
      (m) => m.role === "assistant" && m.safetyFlag === "session-warn",
    );

  // M-F1: ¿este mensaje abre una sesión nueva? Se deriva de la MISMA ventana de
  // sesión (child-only): no hay respuesta del asistente dentro del último gap.
  // Para guardians recentMessages viene vacío → sessionLimitApplies false → no
  // se prepende la presentación (es una salvaguarda pensada para menores).
  const firstOfSession =
    sessionLimitApplies(role) &&
    isFirstOfSession(
      recentMessages.filter((m) => m.role === "assistant").map((m) => m.createdAt),
      now,
    );

  // §7.1: edad para el registro etario del lenguaje. Solo del AÑO de nacimiento
  // (minimización); si es null o cae fuera del rango razonable (guardian.ts,
  // 4..19) se omite y la PERSONA usa su heurística. Aplica solo a menores: los
  // tutores/as no tienen birthYear y su addendum ya fija tono adulto.
  // deriveChildAge acota a la franja y calcula el año en UTC (ver guardian.ts).
  const childAge = sessionLimitApplies(role)
    ? deriveChildAge(user.birthYear, now)
    : undefined;

  // Recorte por presupuesto (B2.6): cada bucket a su tope de tokens estimados.
  // El mensaje actual del usuario nunca se recorta.
  const pastSummaries = pastSummariesRows
    .map((c) => c.summary)
    .filter((s): s is string => Boolean(s));
  const context = assembleContext({
    cards: selectRelevantCards(cards, userText),
    memories,
    pastSummaries,
    rollingSummary: activeConv?.rollingSummary ?? undefined,
    history: historyRows,
    currentUserText: userText,
  });

  // Historial (ya recortado por presupuesto de tokens) en el formato del modelo.
  const dbHistory: ModelMessage[] = historyToModelMessages(context.history);

  // System prompt base + addendum de "riesgo" por REGEX (previo y gratis).
  const baseSystem = buildSystemPrompt({
    cards: context.cards,
    memories: context.memories,
    userName: user.name ?? undefined,
    pastSummaries: context.pastSummaries,
    rollingSummary: context.rollingSummary,
    role,
    firstOfSession,
    age: childAge,
    hasDiagnosis: user.hasDiagnosis ?? null,
  });
  const riesgoAddendum = `\n\n---\n\n${crisisSystemAddendum("riesgo")}`;
  const systemForParallel =
    regexFlag === "riesgo" ? baseSystem + riesgoAddendum : baseSystem;

  // Mensajes para el modelo (F1): historial reconstruido desde la DB + el
  // único mensaje del cliente que se acepta (userText, ya validado, moderado y
  // persistido). Strings planos: UserContent/AssistantContent los aceptan.
  const modelMessages: ModelMessage[] = [
    ...dbHistory,
    { role: "user", content: userText },
  ];

  return {
    dbHistory,
    modelMessages,
    baseSystem,
    riesgoAddendum,
    systemForParallel,
    sState,
    needsSessionWarn,
    assistantCount: activeConv?._count.messages ?? 0,
  };
}
