import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  type ModelMessage,
  type UIMessage,
} from "ai";
import { after } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { aiConfigured, chatModel, generationTimeoutMs } from "@/lib/ai/provider";
import {
  historyToModelMessages,
  lastClientUserMessage,
} from "@/lib/chat-messages";
import {
  buildSystemPrompt,
  selectRelevantCards,
} from "@/lib/ai/system-prompt";
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
import { memoryTtlCutoff, summarizeStaleConversation } from "@/lib/ai/memory";
import {
  SESSION_LIMIT_REPLY,
  SESSION_WARN_APPENDIX,
  sessionState,
} from "@/lib/session-limit";
import { moderate } from "@/lib/moderation";
import { checkRateLimit } from "@/lib/rate-limit";
import { sameOriginOk } from "@/lib/env-check";
import { canUserChat } from "@/lib/consent";
import { maybeAlertGuardian, type AlertCategory } from "@/lib/alerts";

// Holgura para: generateText completo (respuesta corta ≤1000 tokens) + hasta
// dos llamadas a la Moderation API (entrada y salida, timeout 3s c/u). Entra
// cómodo en 60s. No streameamos: generamos completo, moderamos y mostramos
// (decisión de diseño — ver docs/research-ux.md §2).
export const maxDuration = 60;

// Límites defensivos (costo + abuso). Ver docs/security-review.md.
const MAX_MESSAGE_CHARS = 4_000; // el cliente corta en 2000; el servidor manda
const MAX_HISTORY_MESSAGES = 40; // ventana de contexto enviada al LLM
const RATE_LIMIT_PER_MINUTE = 15;
const RATE_LIMIT_PER_DAY = 400;

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

  // --- Gate de consentimiento (M-P1, Ley 25.326) ---
  // Un menor solo puede chatear si su tutor/a registró el consentimiento.
  // Los tutores (guardians) pasan directo (no consultan la DB).
  const consent = await canUserChat(session.user);
  if (!consent.ok) {
    return Response.json(
      { error: "Falta el consentimiento de tu tutor/a para usar el chat" },
      { status: 403 },
    );
  }

  // --- Rate limiting por usuario (ráfaga + tope diario) ---
  const minute = await checkRateLimit(`chat:m:${userId}`, RATE_LIMIT_PER_MINUTE, 60_000);
  const day = await checkRateLimit(`chat:d:${userId}`, RATE_LIMIT_PER_DAY, 24 * 60 * 60 * 1000);
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
  if (conversationId) {
    const owned = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true },
    });
    if (!owned) conversationId = null; // nunca escribir en conversaciones ajenas
  }
  // --- F1: el contexto conversacional es del SERVIDOR ---
  // Si la conversación ya existía (y es del usuario), el historial se carga
  // desde la DB — mensajes reales que este mismo servidor persistió — ANTES de
  // guardar el mensaje nuevo (así no se duplica). El modelo verá
  // [historial de DB] + [último mensaje user del cliente]; el array que mande
  // el cliente jamás llega al modelo.
  let dbHistory: ModelMessage[] = [];
  if (conversationId) {
    const rows = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" }, // los últimos N...
      take: MAX_HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
    // ...en orden cronológico para el modelo.
    dbHistory = historyToModelMessages(rows.reverse(), MAX_HISTORY_MESSAGES);
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
  // crisis más abajo (M1).
  try {
    await prisma.message.create({
      data: {
        conversationId,
        role: "user",
        content: userText,
        safetyFlag: regexFlag,
      },
    });
  } catch (err) {
    console.error("[chat] error guardando el mensaje del usuario (se sigue igual):", err);
  }

  // INVARIANTE M1: la respuesta con recursos SIEMPRE gana sobre la persistencia.
  // saveAssistant NUNCA lanza — en un path de respuesta fija (crisis, derivación,
  // límite de sesión, fallback) un fallo de DB no puede suprimir el texto que se
  // le devuelve al menor (los teléfonos de ayuda). Si la DB falla, se loguea y el
  // caller devuelve igual el fixedTextResponse.
  async function saveAssistant(content: string, safetyFlag: string | null) {
    try {
      await prisma.message.create({
        data: { conversationId: conversationId!, role: "assistant", content, safetyFlag },
      });
      await prisma.conversation.update({
        where: { id: conversationId! },
        data: { updatedAt: new Date() },
      });
    } catch (err) {
      console.error("[chat] error guardando la respuesta del asistente (se devuelve igual):", err);
    }
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
  // Se espera (await) pero NUNCA bloquea el flujo: un fallo de email se loguea
  // y la respuesta al menor sale igual.
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
  }

  // Crisis, abuso o trastorno alimentario: plantilla fija, el LLM no interviene.
  if (regexFlag === "crisis" || regexFlag === "abuso" || regexFlag === "alimentario") {
    const reply = crisisReply(regexFlag);
    await saveAssistant(reply, "derivacion");
    if (regexFlag !== "alimentario") {
      await alertGuardianSafely(regexEventId, regexFlag);
    }
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

  // --- TTL de memorias (M-D): purga lazy en el query-path, sin cron ---
  // Antes de leer UserMemory se borran los registros más viejos que
  // MEMORY_TTL_DAYS (90 días): la retención de datos de menores es acotada
  // por diseño (docs/research-architecture.md §4.2).
  const now = new Date();
  await prisma.userMemory.deleteMany({
    where: { userId, updatedAt: { lt: memoryTtlCutoff(now) } },
  });

  // --- Contexto (fichas + memoria + resumen) + ventana de sesión, en paralelo ---
  // Todo lo que necesita la generación, más los mensajes recientes para el
  // límite de sesión (M-S7). La sesión se mide sobre TODAS las conversaciones
  // del usuario (el límite es por uso, no por hilo): ventana de 2 horas.
  const [cards, memories, lastSummarized, recentMessages] = await Promise.all([
    prisma.knowledgeCard.findMany(),
    prisma.userMemory.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
    prisma.conversation.findFirst({
      where: { userId, id: { not: conversationId }, summary: { not: null } },
      orderBy: { summarizedAt: "desc" },
      select: { summary: true },
    }),
    prisma.message.findMany({
      where: {
        conversation: { userId },
        createdAt: { gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { createdAt: true, role: true, safetyFlag: true },
    }),
  ]);

  // Estado de sesión: se calcula ahora pero se DECIDE más abajo, después de la
  // moderación de entrada (una crisis real gana sobre el cierre por tiempo).
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

  // System prompt base + addendum de "riesgo" por REGEX (previo y gratis).
  const baseSystem = buildSystemPrompt({
    cards: selectRelevantCards(cards, userText),
    memories,
    userName: session.user.name ?? undefined,
    lastSummary: lastSummarized?.summary ?? undefined,
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

  // Genera la respuesta completa (no streaming) para poder moderar la salida
  // ANTES de mostrarla. Nunca lanza: envuelve el error en un sentinel para que
  // un fallo de generación NO tumbe el Promise.all y no enmascare una crisis
  // detectada por la moderación de entrada que corre en paralelo.
  async function generateReply(
    sys: string,
  ): Promise<{ ok: true; text: string } | { ok: false }> {
    try {
      const g = await generateText({
        model: chatModel(),
        system: sys,
        messages: modelMessages,
        temperature: 0.6,
        maxOutputTokens: 1_000, // respuestas cortas por diseño + control de costo
        // M3: un modelo colgado no puede dejar al menor esperando hasta el
        // maxDuration de la ruta. Se aborta y el catch de acá abajo devuelve el
        // fallback amable. Cubre la generación paralela y la regeneración por
        // riesgo (ambas pasan por generateReply).
        abortSignal: AbortSignal.timeout(generationTimeoutMs()),
      });
      return { ok: true, text: g.text };
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

  // 1) Crisis/abuso desde la moderación de entrada → plantilla fija. Gana sobre
  //    todo; la generación paralela se descarta (NO se persiste).
  if (inputMod.mappedFlag === "crisis" || inputMod.mappedFlag === "abuso") {
    const eventId = await recordSafetyEvent(
      inputMod.topCategory ?? inputMod.mappedFlag,
      `moderation-input:${inputMod.source}`,
    );
    const reply = crisisReply(inputMod.mappedFlag);
    await saveAssistant(reply, "derivacion");
    await alertGuardianSafely(eventId, inputMod.mappedFlag);
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
  }

  // 2) Sesión vencida (M-S7) → cierre amable. Gana sobre la respuesta normal (la
  //    crisis ya se evaluó arriba). Generación paralela descartada.
  if (sState === "over") {
    await saveAssistant(SESSION_LIMIT_REPLY, "session-limit");
    return fixedTextResponse(SESSION_LIMIT_REPLY, responseHeaders);
  }

  // 3) IA no configurada (dev): no hubo generación que paralelizar.
  if (!configured || !parallelGen) {
    const reply =
      "Simón todavía no tiene configurado el proveedor de IA en este entorno (falta AI_API_KEY). Pedile a la persona que administra la app que lo configure.";
    await saveAssistant(reply, null);
    return fixedTextResponse(reply, responseHeaders);
  }

  // 4) "riesgo" desde la moderación por API: el evento ya se registró arriba (L2).
  //    Si la generación paralela corrió SIN el addendum (la regex no lo había
  //    marcado), se regenera una vez con el addendum de contención. Caso raro:
  //    vale la 2ª llamada.
  let generated = parallelGen;
  if (inputMod.mappedFlag === "riesgo" && regexFlag !== "riesgo") {
    generated = await generateReply(baseSystem + riesgoAddendum);
  }

  // 5) Error de generación → fallback (después de crisis/sesión: nunca enmascara).
  if (!generated.ok) {
    const reply = "Uy, tuve un problema para responderte recién. ¿Probamos de nuevo?";
    await saveAssistant(reply, null);
    return fixedTextResponse(reply, responseHeaders);
  }

  const outputText = generated.text;

  // --- Capa de seguridad 2 (moderación de la SALIDA) ---
  const outputMod = await moderate(outputText);
  if (outputMod.available && outputMod.flagged) {
    const eventId = await recordSafetyEvent(
      outputMod.topCategory ?? outputMod.mappedFlag ?? "flagged",
      `moderation-output:${outputMod.source}`,
    );
    // No mostramos el output del LLM: lo sustituimos por un mensaje seguro fijo.
    const safe = safeOutputReplacement(outputMod.mappedFlag);
    await saveAssistant(safe, outputMod.mappedFlag ?? "moderation-output");
    if (outputMod.mappedFlag === "crisis" || outputMod.mappedFlag === "abuso") {
      await alertGuardianSafely(eventId, outputMod.mappedFlag);
    }
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
  // Lógica pura en resolveUnmoderatedOutput (lib/safety.ts, testeada en suite).
  if (!outputMod.available) {
    const decision = resolveUnmoderatedOutput(outputText, inputMod.available);
    if (decision.action !== "show") {
      const eventId = await recordSafetyEvent(
        decision.action === "replace" ? decision.flag : "unavailable",
        "moderation-unavailable",
      );
      await saveAssistant(
        decision.reply,
        decision.action === "replace" ? decision.flag : "moderation-unavailable",
      );
      if (
        decision.action === "replace" &&
        (decision.flag === "crisis" || decision.flag === "abuso")
      ) {
        await alertGuardianSafely(eventId, decision.flag);
      }
      return fixedTextResponse(decision.reply, responseHeaders);
    }
  }

  // Salida validada (API OK y sin flag, o degradación con regex limpia +
  // moderación de entrada disponible): mostramos el output del LLM.
  let finalText = outputText;

  // Recordatorio periódico de IA (M-F3): determinístico, cada 10 respuestas
  // del asistente en esta conversación (la que sale ahora es count + 1).
  const assistantCount = await prisma.message.count({
    where: { conversationId, role: "assistant" },
  });
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
  await saveAssistant(finalText, needsSessionWarn ? "session-warn" : effectiveFlag);
  return fixedTextResponse(finalText, responseHeaders);
}
