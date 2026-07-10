import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  type LanguageModelUsage,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  aiConfigured,
  chatModel,
  chatModelId,
  generationTimeoutMs,
} from "@/lib/ai/provider";
import {
  historyToModelMessages,
  lastClientUserMessage,
} from "@/lib/chat-messages";
import {
  buildSystemPrompt,
  selectRelevantCards,
} from "@/lib/ai/system-prompt";
import { assembleContext } from "@/lib/ai/context-budget";
import {
  crisisReply,
  crisisSystemAddendum,
  detectSafetyFlag,
  DISCLOSURE_TEXT,
  resolveUnmoderatedOutput,
  safeOutputReplacement,
  shouldAppendDisclosure,
  type SafetyFlag,
} from "@/lib/safety";
import {
  memoryTtlCutoff,
  summarizeStaleConversation,
  updateRollingSummary,
} from "@/lib/ai/memory";
import {
  isFirstOfSession,
  SESSION_LIMIT_REPLY,
  SESSION_WARN_APPENDIX,
  sessionLimitApplies,
  sessionState,
  sessionWindowQuery,
} from "@/lib/session-limit";
import { moderate, type ModerationResult } from "@/lib/moderation";
import { interactionLogTtlCutoff } from "@/lib/retention";
import { withTransientRetry } from "@/lib/ai/retry";
import { decideResponsePath, decidePostGenPath } from "@/lib/chat-precedence";
import { checkRateLimit } from "@/lib/rate-limit";
import { sameOriginOk } from "@/lib/env-check";
import {
  blockedChatMessage,
  canUserChat,
  isRaceDeletionError,
  NO_GUARDIAN_CHAT_REPLY,
} from "@/lib/consent";
import { maybeAlertGuardian, maybePatternAlert, type AlertCategory } from "@/lib/alerts";
import { MAX_CHILD_AGE, MIN_CHILD_AGE } from "@/lib/guardian";
import type { KnowledgeCard } from "@/generated/prisma/client";

// Holgura para: generateText completo (respuesta corta ≤1000 tokens) + hasta
// dos llamadas a la Moderation API (entrada y salida, timeout 3s c/u).
// Peor caso teórico con withTransientRetry (generación ~25s ×2 + fallback ~8s ×2
// + moderación) ronda 65-70s, por lo que 60 quedaba justo: 90 da margen real
// sin cambiar el timeout interno de cada llamada (ver lib/ai/retry.ts).
// No streameamos: generamos completo, moderamos y mostramos
// (decisión de diseño — ver docs/research-ux.md §2).
export const maxDuration = 90;

// Límites defensivos (costo + abuso). Ver docs/security-review.md.
const MAX_MESSAGE_CHARS = 4_000; // el cliente corta en 2000; el servidor manda
// Ventana de contexto (cantidad) enviada al LLM. Bajó de 40 a 24 (B2): con el
// rolling summary cubriendo lo más viejo, alcanza una ventana reciente más chica
// (menos tokens, menos costo). El recorte fino por tamaño lo hace assembleContext.
const MAX_HISTORY_MESSAGES = 24;
// Retención de InteractionLog (telemetría, 180d) y su corte temporal viven en
// lib/retention.ts — MISMA fuente que usa el cron de purga (#9): cero duplicación.
const RATE_LIMIT_PER_MINUTE = 15;
const RATE_LIMIT_PER_DAY = 400;

// Parámetros de generación por rol (B3). Los tutores/as pueden elaborar más
// (hasta ~5 párrafos) y con un tono algo más determinístico; los menores
// reciben respuestas cortas por diseño y una pizca más de calidez/variación.
const MAX_OUTPUT_TOKENS_GUARDIAN = 1_400;
const MAX_OUTPUT_TOKENS_CHILD = 700;
const TEMPERATURE_GUARDIAN = 0.5;
const TEMPERATURE_CHILD = 0.6;

// --- Cache in-process de la base de conocimiento (perf) ---
// KnowledgeCard.findMany() traía el corpus ENTERO en cada request. El corpus es
// chico (< ~200 fichas) y de baja frecuencia de cambio (curación manual), así
// que se cachea en memoria del proceso con TTL corto.
// TRADEOFF MULTI-INSTANCIA: cada instancia serverless tiene su propio cache, por
// lo que una edición de fichas puede tardar hasta KNOWLEDGE_CACHE_TTL_MS en
// reflejarse en TODAS las instancias. Aceptable: no hay lecturas críticas de
// fichas (a diferencia de seguridad/consentimiento, que nunca se cachean).
const KNOWLEDGE_CACHE_TTL_MS = 5 * 60_000;
let knowledgeCache: { cards: KnowledgeCard[]; expiresAt: number } | null = null;

async function loadKnowledgeCards(): Promise<KnowledgeCard[]> {
  const nowMs = Date.now();
  if (knowledgeCache && knowledgeCache.expiresAt > nowMs) return knowledgeCache.cards;
  const cards = await prisma.knowledgeCard.findMany();
  knowledgeCache = { cards, expiresAt: nowMs + KNOWLEDGE_CACHE_TTL_MS };
  return cards;
}

/** Extrae el texto plano de un UIMessage (partes tipo "text"). */
function messageText(message: UIMessage): string {
  // Defensivo: el cliente puede mandar cualquier cosa; un body malformado
  // debe terminar en 400 ("Mensaje vacío"), nunca en un 500.
  if (!Array.isArray(message?.parts)) return "";
  return message.parts
    .filter(
      (p): p is Extract<typeof p, { type: "text" }> =>
        // Cada part de texto debe traer `text` string: el cliente puede mandar
        // `{ type: "text", text: {...} }` u otros tipos raros; se descartan en
        // vez de coercionar a "[object Object]".
        p?.type === "text" && typeof p.text === "string",
    )
    .map((p) => p.text)
    .join("\n");
}

/** Stream de un texto fijo con el formato de UI message stream. */
function fixedTextResponse(text: string, headers?: Record<string, string>) {
  const stream = createUIMessageStream({
    execute({ writer }) {
      const id = "fixed-text";
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream, headers });
}

export async function POST(req: Request) {
  // Telemetría (B4): momento de entrada para medir la latencia total del request.
  const requestStartedAt = Date.now();

  // Defensa CSRF en profundidad (M3): si el navegador manda Origin y no es el
  // nuestro, se corta acá (la cookie SameSite=Lax es la defensa principal).
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return Response.json({ error: "No autenticado" }, { status: 401 });
  }
  const userId = session.user.id;
  // Rol del interlocutor (B3): se captura acá (session ya está narrowed) para
  // usarlo también dentro del closure diferido de logInteraction.
  const userRole = session.user.role;

  // --- Gate de consentimiento (M-P1, Ley 25.326) ---
  // Un menor solo puede chatear si su tutor/a registró el consentimiento Y sigue
  // teniendo un tutor/a vivo. Los tutores (guardians) pasan directo (no consultan
  // la DB). Si el menor quedó HUÉRFANO (sin tutor/a: p.ej. el tutor/a borró su
  // cuenta y el cascade eliminó el vínculo), NO se opera sin supervisión: se
  // corta con un mensaje amable (mismo tono que el límite de sesión) en vez de un
  // 403 crudo. El resto de los motivos cae al 403 genérico.
  const consent = await canUserChat(session.user);
  if (!consent.ok) {
    const friendly = blockedChatMessage(consent.reason);
    if (friendly) {
      return fixedTextResponse(friendly, { "cache-control": "no-store" });
    }
    return Response.json(
      { error: "Falta el consentimiento de tu tutor/a para usar el chat" },
      { status: 403 },
    );
  }

  // --- Rate limiting por usuario (ráfaga + tope diario) ---
  // Ambos chequeos son independientes (claves y ventanas distintas): se corren
  // en paralelo. La precedencia del error se mantiene (minuto antes que día).
  const [minute, day] = await Promise.all([
    checkRateLimit(`chat:m:${userId}`, RATE_LIMIT_PER_MINUTE, 60_000),
    checkRateLimit(`chat:d:${userId}`, RATE_LIMIT_PER_DAY, 24 * 60 * 60 * 1000),
  ]);
  const limited = !minute.ok ? minute : !day.ok ? day : null;
  if (limited && !limited.ok) {
    return Response.json(
      { error: "Demasiados mensajes seguidos. Esperá un momento." },
      {
        status: 429,
        headers: { "retry-after": String(limited.retryAfterSeconds) },
      },
    );
  }

  // --- Validación del body (nunca confiar en el cliente) ---
  let body: { messages?: unknown; conversationId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }
  if (!Array.isArray(body.messages)) {
    return Response.json({ error: "messages debe ser una lista" }, { status: 400 });
  }
  // Anti-injection / anti-priming (H2 → F1): del body del cliente se toma SOLO
  // el ÚLTIMO mensaje con role "user". Todo lo demás (turnos assistant
  // fabricables para primear al modelo, users previos que la moderación de
  // entrada nunca vería, roles system/tool inyectados) se IGNORA: el contexto
  // conversacional lo reconstruye el servidor desde la DB más abajo.
  const lastUser = lastClientUserMessage(body.messages as UIMessage[]);
  const userText = lastUser ? messageText(lastUser) : "";
  if (!userText.trim()) {
    return Response.json({ error: "Mensaje vacío" }, { status: 400 });
  }
  if (userText.length > MAX_MESSAGE_CHARS) {
    return Response.json(
      { error: `El mensaje supera el máximo de ${MAX_MESSAGE_CHARS} caracteres` },
      { status: 400 },
    );
  }

  // --- Conversación (se crea en el primer mensaje) ---
  let conversationId =
    typeof body.conversationId === "string" && body.conversationId.length <= 64
      ? body.conversationId
      : null;
  // --- F1: el contexto conversacional es del SERVIDOR ---
  // Si la conversación ya existía (y es del usuario), el historial se carga
  // desde la DB — mensajes reales que este mismo servidor persistió — ANTES de
  // guardar el mensaje nuevo (así no se duplica). El modelo verá
  // [historial de DB] + [último mensaje user del cliente]; el array que mande
  // el cliente jamás llega al modelo.
  // Historial crudo (cronológico) para el recorte por presupuesto (B2). El
  // recorte por CANTIDAD lo hace la query (take); el recorte fino por TAMAÑO lo
  // hace assembleContext más abajo.
  // La verificación de ownership y la carga del historial se fusionan en UN
  // findFirst anidado (una sola ida a la DB): el `where` filtra por userId (no
  // se leen conversaciones ajenas) y los `messages` vienen incluidos.
  let historyRows: { role: string; content: string }[] = [];
  if (conversationId) {
    const owned = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: {
        id: true,
        messages: {
          orderBy: { createdAt: "desc" }, // los últimos N...
          take: MAX_HISTORY_MESSAGES,
          select: { role: true, content: true },
        },
      },
    });
    if (!owned) {
      conversationId = null; // nunca leer/escribir en conversaciones ajenas
    } else {
      historyRows = owned.messages.reverse(); // ...en orden cronológico.
    }
  }
  if (!conversationId) {
    const created = await prisma.conversation.create({
      data: {
        userId,
        title: userText.slice(0, 60),
      },
      select: { id: true },
    });
    conversationId = created.id;
    // Memoria capa 2 (lazy): al abrir una conversación nueva se resume la
    // última que quedó cerrada. `after()` (next/server, estable en Next 16)
    // ejecuta el callback DESPUÉS de enviar la respuesta — en serverless
    // mantiene viva la función (equivalente a waitUntil), así no bloquea ni
    // se pierde el trabajo. summarizeStaleConversation nunca lanza.
    after(() => summarizeStaleConversation(userId));
  }
  const responseHeaders = { "x-conversation-id": conversationId };

  // --- Capa de seguridad 1 (regex, pre-LLM) ---
  const regexFlag = detectSafetyFlag(userText);

  // Persistir el mensaje del menor NO puede bloquear la detección de crisis: si
  // la DB falla, se loguea y se sigue (regexFlag ya se calculó sobre userText,
  // en memoria). Un fallo de DB acá jamás debe impedir devolver la plantilla de
  // crisis más abajo (M1). Se captura el id para referenciarlo en InteractionLog.
  let userMessageId: string | null = null;
  try {
    const created = await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content: userText,
        safetyFlag: regexFlag,
      },
      select: { id: true },
    });
    userMessageId = created.id;
  } catch (err) {
    console.error("[chat] error guardando el mensaje del usuario (se sigue igual):", err);
  }

  // INVARIANTE M1: la respuesta con recursos SIEMPRE gana sobre la persistencia.
  // saveAssistant NUNCA lanza — en un path de respuesta fija (crisis, derivación,
  // límite de sesión, fallback) un fallo de DB no puede suprimir el texto que se
  // le devuelve al menor (los teléfonos de ayuda). Si la DB falla, se loguea y el
  // caller devuelve igual el fixedTextResponse.
  //
  // Devuelve `{ id, raceDeleted }`:
  //   - `id`: id del mensaje assistant creado (o null si la escritura falló) para
  //     referenciarlo en InteractionLog.
  //   - `raceDeleted`: true SOLO si el fallo fue una carrera de borrado del menor
  //     (P2003/P2025 — ver isRaceDeletionError). En ese caso el texto del LLM NO
  //     debe entregarse (el path normal lo chequea). Los paths de respuesta FIJA
  //     (crisis/sesión/fallback) IGNORAN este flag y entregan igual (M1): jamás se
  //     le niega a un menor los recursos de ayuda por una carrera de borrado.
  // Nunca lanza (M1).
  async function saveAssistant(
    content: string,
    safetyFlag: string | null,
  ): Promise<{ id: string | null; raceDeleted: boolean }> {
    try {
      // Dos escrituras (crear el mensaje + bumpear updatedAt) en UNA transacción:
      // una sola ida a la DB y consistencia atómica del par.
      const [created] = await prisma.$transaction([
        prisma.message.create({
          data: { conversationId: conversationId!, role: "assistant", content, safetyFlag },
          select: { id: true },
        }),
        prisma.conversation.update({
          where: { id: conversationId! },
          data: { updatedAt: new Date() },
        }),
      ]);
      return { id: created.id, raceDeleted: false };
    } catch (err) {
      // Carrera de borrado del menor (P2003/P2025): la Conversation/User se borró
      // mientras generábamos. Evento ESPERADO → log conciso, sin volcar el stack.
      if (isRaceDeletionError(err)) {
        console.warn(
          "[chat] carrera: el menor/su conversación se borró durante la generación (no se persiste ni entrega el texto del LLM)",
        );
        return { id: null, raceDeleted: true };
      }
      // Fallo transitorio (red/pool/timeout): comportamiento actual (M1).
      console.error("[chat] error guardando la respuesta del asistente (se devuelve igual):", err);
      return { id: null, raceDeleted: false };
    }
  }

  // --- Telemetría de interacción (B4) ---
  // Registra UNA fila por request en cada path de respuesta, fire-and-forget vía
  // after(): NUNCA bloquea ni rompe el chat (invariante M1). JAMÁS guarda el
  // contenido de los mensajes ni texto de moderación — solo referencias, métricas
  // de performance y, de moderación, fuente + flag + categoría.
  function logInteraction(
    responsePath: string,
    extra: {
      model?: string | null;
      generationLatencyMs?: number | null;
      usage?: LanguageModelUsage | null;
      moderationInput?: ModerationResult | null;
      moderationOutput?: ModerationResult | null;
      safetyFlagFinal?: string | null;
      assistantMessageId?: string | null;
      safetyEventId?: string | null;
      historyMessagesSent?: number;
    } = {},
  ) {
    const totalLatencyMs = Date.now() - requestStartedAt;
    const usage = extra.usage ?? null;
    const inMod = extra.moderationInput ?? null;
    const outMod = extra.moderationOutput ?? null;
    const cid = conversationId;
    after(async () => {
      try {
        if (!cid) return; // sin conversación no hay FK válida
        await prisma.interactionLog.create({
          data: {
            userId,
            conversationId: cid,
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
            moderationOutputCategory: outMod?.topCategory ?? outMod?.mappedFlag ?? null,
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
  }

  // Evento de seguridad anonimizado: solo categoría + capa, nunca el contenido.
  // No debe tumbar la request si falla la persistencia. Devuelve el id del
  // evento (o null) para poder marcarle notifiedAt si se alerta al tutor/a.
  async function recordSafetyEvent(
    category: string,
    layer: string,
  ): Promise<string | null> {
    try {
      const event = await prisma.safetyEvent.create({
        data: { userId, conversationId, category, layer },
        select: { id: true },
      });
      return event.id;
    } catch (err) {
      console.error("[chat] error registrando SafetyEvent:", err);
      return null;
    }
  }

  // Alerta de crisis al tutor/a (M-P2). UMBRAL: solo crisis/abuso — "riesgo" y
  // "alimentario" NO alertan por ahora, para no sobre-alertar (ver lib/alerts).
  //
  // PERF: el envío del email (Resend, red) NO puede sumar latencia a la respuesta
  // al menor. Los callers invocan esto vía `after()` (next/server): corre DESPUÉS
  // de enviada la respuesta. El SafetyEvent (registro de la señal) ya se persistió
  // sincrónicamente antes; solo la NOTIFICACIÓN (email + marca notifiedAt del
  // dedupe) queda diferida. NUNCA lanza: cualquier fallo se loguea acá adentro,
  // así el error no se pierde aunque corra fuera del ciclo de la request.
  async function alertGuardianSafely(
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

  let regexEventId: string | null = null;
  if (regexFlag) {
    regexEventId = await recordSafetyEvent(regexFlag, "keyword");
    // Alerta de PATRÓN (M-P2): riesgo/alimentario NO alertan de inmediato, pero
    // su acumulación sí. Diferido a after(): nunca suma latencia ni rompe el
    // chat (maybePatternAlert es no-throw). El conteo/dedupe vive en lib/alerts.
    if (regexFlag === "riesgo" || regexFlag === "alimentario") {
      const patternCategory = regexFlag; // narrowing para el closure de after()
      after(() => maybePatternAlert(userId, patternCategory));
    }
  }

  // Crisis, abuso o trastorno alimentario: plantilla fija, el LLM no interviene.
  if (regexFlag === "crisis" || regexFlag === "abuso" || regexFlag === "alimentario") {
    const reply = crisisReply(regexFlag);
    const { id: assistantMessageId } = await saveAssistant(reply, "derivacion");
    if (regexFlag !== "alimentario") {
      after(() => alertGuardianSafely(regexEventId, regexFlag));
    }
    logInteraction("crisis-template", {
      safetyFlagFinal: "derivacion",
      safetyEventId: regexEventId,
      assistantMessageId,
    });
    return fixedTextResponse(reply, responseHeaders);
  }

  // --- Capa de seguridad 2 (moderación de la ENTRADA) EN PARALELO con la
  //     generación — optimización de latencia percibida ---
  //
  // Antes era secuencial: moderate(entrada) → generateText → moderate(salida),
  // y la moderación de entrada (moderador LLM, ~1.2-1.7s) se sumaba entera al
  // tiempo percibido. Ahora la moderación de ENTRADA corre EN PARALELO con la
  // generación (Promise.all) y recién después resolvemos según ambos resultados.
  // La moderación de SALIDA sigue secuencial (inevitable: necesita el texto ya
  // generado).
  //
  // ADDENDUM DE "riesgo" (contención). Antes se anteponía al system prompt ANTES
  // de generar. Para preservar EXACTAMENTE el comportamiento de seguridad con la
  // mínima complejidad:
  //   - El "riesgo" de la capa REGEX (safety.ts) es previo y gratis: su addendum
  //     se aplica antes de lanzar la generación paralela (costo cero).
  //   - El "riesgo" que solo detecta la MODERACIÓN por API se conoce recién al
  //     resolver el Promise.all. Como es un caso raro, si aparece se REGENERA
  //     una vez con el addendum (la generación paralela se descarta). Así la
  //     respuesta de contención es idéntica a la del flujo secuencial anterior.
  //
  // INVARIANTE DE SEGURIDAD: una crisis SIEMPRE gana. La moderación de entrada
  // se evalúa PRIMERO —antes de sesión vencida, error de generación o "IA no
  // configurada"—, mismo orden de precedencia que el flujo secuencial anterior,
  // así una crisis nunca queda enmascarada por otra rama.

  let effectiveFlag: SafetyFlag = regexFlag; // null | "riesgo"

  const now = new Date();
  // --- TTL (M-D / B4): purgas lazy DIFERIDAS a after() ---
  // La minimización de datos (UserMemory 90d, InteractionLog 180d) no tiene que
  // bloquear la respuesta al menor: se ejecuta tras responder, vía after(). Para
  // que un dato vencido no se USE aunque la purga quede pendiente, la lectura de
  // UserMemory (más abajo) filtra por el mismo corte temporal.
  after(async () => {
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

  // --- Contexto (fichas + memoria + resumen) + ventana de sesión, en paralelo ---
  // Todo lo que necesita la generación, más los mensajes recientes para el
  // límite de sesión (M-S7). La sesión se mide sobre TODAS las conversaciones
  // del usuario (el límite es por uso, no por hilo).
  // Rol del interlocutor (B3): condiciona la persona y el límite de sesión.
  const role = userRole;

  const [cards, memories, pastSummariesRows, activeConv, recentMessages] =
    await Promise.all([
      // Fichas: cache in-process con TTL corto (perf) en vez de traer el corpus
      // entero por request.
      loadKnowledgeCards(),
      prisma.userMemory.findMany({
        // Filtro TTL: no usar memorias vencidas aunque la purga (after) esté
        // pendiente — mismo corte que el deleteMany diferido.
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

  // Estado de sesión: se calcula ahora pero se DECIDE más abajo, después de la
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
  const birthYear = session.user.birthYear ?? null;
  const derivedAge =
    typeof birthYear === "number" && Number.isInteger(birthYear)
      ? now.getFullYear() - birthYear
      : null;
  const childAge =
    sessionLimitApplies(role) &&
    derivedAge !== null &&
    derivedAge >= MIN_CHILD_AGE &&
    derivedAge <= MAX_CHILD_AGE
      ? derivedAge
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

  // Historial (recortado) en el formato del modelo.
  const dbHistory: ModelMessage[] = historyToModelMessages(
    context.history,
    MAX_HISTORY_MESSAGES,
  );

  // System prompt base + addendum de "riesgo" por REGEX (previo y gratis).
  const baseSystem = buildSystemPrompt({
    cards: context.cards,
    memories: context.memories,
    userName: session.user.name ?? undefined,
    pastSummaries: context.pastSummaries,
    rollingSummary: context.rollingSummary,
    role,
    firstOfSession,
    age: childAge,
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

  // Parámetros de generación por rol (B3): los tutores/as pueden elaborar más
  // (más tokens) y con un tono algo más determinístico; los menores reciben
  // respuestas cortas y una pizca más de variación/calidez.
  const isGuardian = role === "guardian";
  const genMaxOutputTokens = isGuardian
    ? MAX_OUTPUT_TOKENS_GUARDIAN
    : MAX_OUTPUT_TOKENS_CHILD;
  const genTemperature = isGuardian ? TEMPERATURE_GUARDIAN : TEMPERATURE_CHILD;

  // Genera la respuesta completa (no streaming) para poder moderar la salida
  // ANTES de mostrarla. Nunca lanza: envuelve el error en un sentinel para que
  // un fallo de generación NO tumbe el Promise.all y no enmascare una crisis
  // detectada por la moderación de entrada que corre en paralelo.
  async function generateReply(
    sys: string,
  ): Promise<
    | {
        ok: true;
        text: string;
        usage: LanguageModelUsage;
        generationLatencyMs: number | null;
      }
    | { ok: false }
  > {
    try {
      // #36: 1 reintento corto SOLO ante error transitorio (5xx/red). El
      // AbortSignal.timeout se crea DENTRO del factory → cada intento tiene su
      // propia señal fresca (una ya abortada quedaría inservible). Un
      // timeout/abort NO es transitorio → no se reintenta (es el tope de latencia
      // aceptado). Peor caso real ≈ fallo-rápido + backoff + 1 intento completo,
      // dentro del maxDuration=60 (ver lib/ai/retry.ts).
      const g = await withTransientRetry(() =>
        generateText({
          model: chatModel(),
          system: sys,
          messages: modelMessages,
          temperature: genTemperature,
          maxOutputTokens: genMaxOutputTokens, // por rol: corto para menores
          // M3: un modelo colgado no puede dejar al menor esperando hasta el
          // maxDuration de la ruta. Se aborta y el catch de acá abajo devuelve el
          // fallback amable. Cubre la generación paralela y la regeneración por
          // riesgo (ambas pasan por generateReply).
          abortSignal: AbortSignal.timeout(generationTimeoutMs()),
        }),
      );
      return {
        ok: true,
        text: g.text,
        usage: g.usage,
        // B4: latencia de la llamada al modelo (AI SDK v7). El campo performance
        // vive por STEP (no en el result); generamos en un solo step (sin tools),
        // así el último step cubre toda la generación. Defensivo con `?.`.
        generationLatencyMs: g.steps.at(-1)?.performance?.responseTimeMs ?? null,
      };
    } catch (err) {
      console.error("[chat] error generando respuesta:", err);
      return { ok: false };
    }
  }

  // --- PARALELO: moderación de entrada + generación (si la IA está configurada) ---
  const configured = aiConfigured();
  const [inputMod, parallelGen] = await Promise.all([
    moderate(userText),
    configured ? generateReply(systemForParallel) : Promise.resolve(null),
  ]);

  // #32: la DECISIÓN de precedencia PRE-generación se centraliza en la función
  // pura decideResponsePath (fuente única del orden crisis > sesión > no-ai,
  // testeada exhaustivamente en chat-precedence-suite). La regex-crisis ya
  // retornó más arriba (corte previo al costo del LLM) → acá regexCrisis:false;
  // los campos post-generación van en su valor "continuar" para que la función
  // devuelva el corte temprano o "normal" = seguir al flujo de generación. Los
  // efectos (persistencia, alertas, logging) NO se movieron: cada rama conserva
  // su bloque. Las ramas POST-generación (fallback-error → moderación de salida
  // → normal) ahora también se rutean por una función pura hermana,
  // decidePostGenPath (ver más abajo), fuente única de su orden y testeada.
  const preGenPath = decideResponsePath({
    regexCrisis: false,
    moderationInputCrisis:
      inputMod.mappedFlag === "crisis" || inputMod.mappedFlag === "abuso",
    sessionOver: sState === "over",
    aiReady: configured && parallelGen !== null,
    generationOk: true,
    outputFlagged: false,
    outputUnavailableReplace: false,
  });

  // 1) Crisis/abuso desde la moderación de entrada → plantilla fija. Gana sobre
  //    todo; la generación paralela se descarta (NO se persiste).
  if (preGenPath === "crisis-template") {
    // El narrowing del if de arriba no lo tiene TS acá, pero mappedFlag es
    // crisis|abuso por construcción de preGenPath; se estrecha explícito.
    const inputCrisisFlag =
      inputMod.mappedFlag === "abuso" ? "abuso" : "crisis";
    // Se captura el flag en una const: el after() difiere la llamada y TS no
    // preserva el narrowing de una propiedad dentro del closure.
    const alertCategory = inputCrisisFlag;
    const eventId = await recordSafetyEvent(
      inputMod.topCategory ?? inputCrisisFlag,
      `moderation-input:${inputMod.source}`,
    );
    const reply = crisisReply(inputCrisisFlag);
    const { id: assistantMessageId } = await saveAssistant(reply, "derivacion");
    after(() => alertGuardianSafely(eventId, alertCategory));
    logInteraction("crisis-template", {
      moderationInput: inputMod,
      safetyFlagFinal: "derivacion",
      safetyEventId: eventId,
      assistantMessageId,
    });
    return fixedTextResponse(reply, responseHeaders);
  }

  // L2: registrar el SafetyEvent de "riesgo" detectado por la moderación de
  // ENTRADA acá, ANTES de los cortes por sesión vencida / IA no configurada, para
  // no perder la señal de contención si la request termina por otra rama. Esto
  // NO cambia ninguna respuesta: el addendum de contención (regeneración) sigue
  // aplicándose recién en el flujo normal más abajo.
  if (inputMod.mappedFlag === "riesgo") {
    await recordSafetyEvent(
      inputMod.topCategory ?? "riesgo",
      `moderation-input:${inputMod.source}`,
    );
    effectiveFlag = "riesgo";
    // Alerta de patrón por acumulación (ver regex arriba). Diferida; no-throw.
    after(() => maybePatternAlert(userId, "riesgo"));
  }

  // 2) Sesión vencida (M-S7) → cierre amable. Gana sobre la respuesta normal (la
  //    crisis ya se evaluó arriba). Generación paralela descartada.
  if (preGenPath === "session-limit") {
    const { id: assistantMessageId } = await saveAssistant(SESSION_LIMIT_REPLY, "session-limit");
    logInteraction("session-limit", {
      moderationInput: inputMod,
      safetyFlagFinal: "session-limit",
      assistantMessageId,
    });
    return fixedTextResponse(SESSION_LIMIT_REPLY, responseHeaders);
  }

  // 3) IA no configurada (dev): no hubo generación que paralelizar.
  if (preGenPath === "no-ai") {
    const reply =
      "Simón todavía no tiene configurado el proveedor de IA en este entorno (falta AI_API_KEY). Pedile a la persona que administra la app que lo configure.";
    const { id: assistantMessageId } = await saveAssistant(reply, null);
    logInteraction("no-ai", { moderationInput: inputMod, assistantMessageId });
    return fixedTextResponse(reply, responseHeaders);
  }

  // 4) "riesgo" desde la moderación por API: el evento ya se registró arriba (L2).
  //    Si la generación paralela corrió SIN el addendum (la regex no lo había
  //    marcado), se regenera una vez con el addendum de contención. Caso raro:
  //    vale la 2ª llamada.
  // preGenPath !== "no-ai" ⇒ aiReady ⇒ parallelGen != null (garantía de
  // decideResponsePath); la rama no-ai ya retornó. Aserción justificada.
  let generated = parallelGen!;
  if (inputMod.mappedFlag === "riesgo" && regexFlag !== "riesgo") {
    generated = await generateReply(baseSystem + riesgoAddendum);
  }

  // 5) Error de generación → fallback (después de crisis/sesión: nunca enmascara).
  //    Corta ANTES de moderar (no se puede moderar un texto que no existe): es
  //    la rama "fallback-error" de decidePostGenPath, evaluada acá por la
  //    dependencia de datos (moderate() necesita generated.text).
  if (!generated.ok) {
    const reply = "Uy, tuve un problema para responderte recién. ¿Probamos de nuevo?";
    const { id: assistantMessageId } = await saveAssistant(reply, null);
    logInteraction("fallback-error", {
      model: chatModelId(),
      moderationInput: inputMod,
      assistantMessageId,
      historyMessagesSent: dbHistory.length,
    });
    return fixedTextResponse(reply, responseHeaders);
  }

  const outputText = generated.text;

  // --- Capa de seguridad 2 (moderación de la SALIDA) ---
  const outputMod = await moderate(outputText);
  // Decisión fail-closed cuando la API de salida está caída: se calcula acá
  // (pura, sin efectos) para que decidePostGenPath rutee las ramas post-gen con
  // el MISMO orden que la suite fija. Solo relevante si !outputMod.available.
  const unmoderated = !outputMod.available
    ? resolveUnmoderatedOutput(outputText, inputMod.available)
    : null;
  // #32 (post-gen): las ramas moderación-de-salida / normal las rutea la función
  // pura decidePostGenPath (fuente única del orden 6→7→8), no más condiciones
  // inline sueltas. Los efectos de cada rama NO se movieron.
  const postGenPath = decidePostGenPath({
    generationOk: true,
    outputModAvailable: outputMod.available,
    outputModFlagged: outputMod.flagged,
    unmoderatedReplace: unmoderated !== null && unmoderated.action !== "show",
  });
  if (postGenPath === "moderation-replaced-output") {
    const eventId = await recordSafetyEvent(
      outputMod.topCategory ?? outputMod.mappedFlag ?? "flagged",
      `moderation-output:${outputMod.source}`,
    );
    // No mostramos el output del LLM: lo sustituimos por un mensaje seguro fijo.
    const safe = safeOutputReplacement(outputMod.mappedFlag);
    const finalFlag = outputMod.mappedFlag ?? "moderation-output";
    const { id: assistantMessageId } = await saveAssistant(safe, finalFlag);
    if (outputMod.mappedFlag === "crisis" || outputMod.mappedFlag === "abuso") {
      const alertCategory = outputMod.mappedFlag; // narrowing para el closure
      after(() => alertGuardianSafely(eventId, alertCategory));
    }
    logInteraction("moderation-replaced-output", {
      model: chatModelId(),
      usage: generated.usage,
      generationLatencyMs: generated.generationLatencyMs,
      moderationInput: inputMod,
      moderationOutput: outputMod,
      safetyFlagFinal: finalFlag,
      safetyEventId: eventId,
      assistantMessageId,
      historyMessagesSent: dbHistory.length,
    });
    return fixedTextResponse(safe, responseHeaders);
  }

  // --- POLÍTICA FAIL-CLOSED cuando la moderación de SALIDA no responde (A2) ---
  // La Moderation API no estuvo disponible para validar el output. NO se
  // muestra crudo sin red de seguridad:
  //   1. detectSafetyFlag(output) (regex, capa 1) es el piso → si flaggea,
  //      se sustituye por safeOutputReplacement.
  //   2. Si la regex no flaggea, el output se muestra SOLO si la moderación
  //      de ENTRADA de este mismo request sí estuvo disponible.
  //   3. Si ambas capas de API estuvieron caídas → mensaje seguro fijo
  //      (MODERATION_UNAVAILABLE_MESSAGE) e invitación a buscar a un adulto.
  // En toda degradación se registra SafetyEvent layer "moderation-unavailable".
  // Lógica pura en resolveUnmoderatedOutput (lib/safety.ts, testeada en suite);
  // la decisión ya se calculó arriba (`unmoderated`) y decidePostGenPath la
  // enrutó como "moderation-unavailable".
  if (postGenPath === "moderation-unavailable") {
    const decision = unmoderated!;
    // Garantizado por postGenPath (action !== "show"); el if re-estrecha el tipo.
    if (decision.action !== "show") {
      const eventId = await recordSafetyEvent(
        decision.action === "replace" ? decision.flag : "unavailable",
        "moderation-unavailable",
      );
      const finalFlag =
        decision.action === "replace" ? decision.flag : "moderation-unavailable";
      const { id: assistantMessageId } = await saveAssistant(decision.reply, finalFlag);
      if (
        decision.action === "replace" &&
        (decision.flag === "crisis" || decision.flag === "abuso")
      ) {
        const alertCategory = decision.flag; // narrowing para el closure
        after(() => alertGuardianSafely(eventId, alertCategory));
      }
      logInteraction("moderation-unavailable", {
        model: chatModelId(),
        usage: generated.usage,
        generationLatencyMs: generated.generationLatencyMs,
        moderationInput: inputMod,
        moderationOutput: outputMod,
        safetyFlagFinal: finalFlag,
        safetyEventId: eventId,
        assistantMessageId,
        historyMessagesSent: dbHistory.length,
      });
      return fixedTextResponse(decision.reply, responseHeaders);
    }
  }

  // Salida validada (API OK y sin flag, o degradación con regex limpia +
  // moderación de entrada disponible): mostramos el output del LLM.
  let finalText = outputText;

  // Recordatorio periódico de IA (M-F3): determinístico, cada 10 respuestas
  // del asistente en esta conversación (la que sale ahora es count + 1). El
  // conteo ya vino en el _count de activeConv (misma query del contexto): en el
  // path normal no se persiste ninguna respuesta del asistente entre esa lectura
  // y acá, así que el valor es el mismo que un count fresco, sin query extra.
  const assistantCount = activeConv?._count.messages ?? 0;
  if (shouldAppendDisclosure(assistantCount)) {
    finalText += DISCLOSURE_TEXT;
  }

  // Aviso de pausa a los 30 min (M-S7): se anexa al final y el safetyFlag
  // "session-warn" persiste que el aviso ya fue dado (dedupe de la sesión).
  if (needsSessionWarn) {
    finalText += SESSION_WARN_APPENDIX;
  }

  // L3: `safetyFlag` es un único valor (no un flag compuesto). En este path
  // conviven a lo sumo "session-warn" y effectiveFlag ("riesgo"); se prioriza
  // "session-warn" porque es el que necesita el dedupe del aviso de pausa. No se
  // necesita un flag compuesto hoy: ningún consumidor cruza ambas dimensiones.
  // saveAssistant ya es a prueba de fallos (M1): no requiere try/catch acá.
  const finalFlag = needsSessionWarn ? "session-warn" : effectiveFlag;

  // --- Re-chequeo de consentimiento/existencia (TOCTOU) ANTES de persistir/
  //     entregar el texto del LLM ---
  // `canUserChat` se evaluó al ENTRAR (línea ~170) pero la generación tarda hasta
  // ~90s; en ese intervalo el tutor/a pudo revocar el consentimiento o borrar al
  // menor. Sin este re-chequeo, la respuesta del LLM se persistía y entregaba
  // igual. Es un chequeo BARATO (guardians: sin DB; menores: un findUnique por el
  // unique childUserId) y aplica SOLO a este path normal: las respuestas FIJAS de
  // seguridad (crisis/derivación/límite) SIEMPRE se entregan (M1) y no se tocan.
  // Si el re-chequeo bloquea, NO se persiste el texto del LLM y se devuelve el
  // MISMO desenlace que el guard original (mensaje amable de huérfano para
  // `no-guardian`; 403 genérico para el resto, p.ej. `consent-revoked`).
  const recheck = await canUserChat(session.user);
  if (!recheck.ok) {
    logInteraction("blocked-midflight", {
      model: chatModelId(),
      moderationInput: inputMod,
      moderationOutput: outputMod,
      safetyFlagFinal: recheck.reason,
      historyMessagesSent: dbHistory.length,
    });
    const friendly = blockedChatMessage(recheck.reason);
    if (friendly) {
      return fixedTextResponse(friendly, { ...responseHeaders, "cache-control": "no-store" });
    }
    return Response.json(
      { error: "Falta el consentimiento de tu tutor/a para usar el chat" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const saved = await saveAssistant(finalText, finalFlag);
  // Carrera fina: el re-chequeo pasó pero el menor se borró entre ese SELECT y el
  // INSERT (P2003/P2025). No se entrega el texto del LLM; mismo mensaje amable de
  // huérfano que el guard original. (Un fallo transitorio NO llega acá: raceDeleted
  // es false y se entrega igual — M1.)
  if (saved.raceDeleted) {
    logInteraction("blocked-midflight", {
      model: chatModelId(),
      moderationInput: inputMod,
      moderationOutput: outputMod,
      safetyFlagFinal: "no-guardian",
      historyMessagesSent: dbHistory.length,
    });
    return fixedTextResponse(NO_GUARDIAN_CHAT_REPLY, {
      ...responseHeaders,
      "cache-control": "no-store",
    });
  }
  const assistantMessageId = saved.id;

  // B2.3: rolling summary incremental de esta conversación. La decisión fina
  // (hilo largo Y atrasado) la toma updateRollingSummary; se dispara fire-and-
  // forget vía after() para no sumar latencia a la respuesta.
  after(() => updateRollingSummary(conversationId!));

  logInteraction("normal", {
    model: chatModelId(),
    usage: generated.usage,
    generationLatencyMs: generated.generationLatencyMs,
    moderationInput: inputMod,
    moderationOutput: outputMod,
    safetyFlagFinal: finalFlag,
    assistantMessageId,
    historyMessagesSent: dbHistory.length,
  });
  return fixedTextResponse(finalText, responseHeaders);
}
