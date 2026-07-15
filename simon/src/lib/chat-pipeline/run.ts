import {
  crisisReply,
  detectSafetyFlag,
  DISCLOSURE_TEXT,
  resolveUnmoderatedOutput,
  safeOutputReplacement,
  shouldAppendDisclosure,
  type SafetyFlag,
} from "@/lib/safety";
import {
  blockedChatMessage,
  canUserChat,
  NO_GUARDIAN_CHAT_REPLY,
} from "@/lib/consent";
import { aiConfigured, chatModelId } from "@/lib/ai/provider";
import {
  summarizeStaleConversation,
  updateRollingSummary,
} from "@/lib/ai/memory";
import {
  SESSION_LIMIT_REPLY,
  SESSION_WARN_APPENDIX,
  SESSION_WARN_DEDUP_TTL_MS,
} from "@/lib/session-limit";
import { claimOnce } from "@/lib/claim-once";
import { moderate } from "@/lib/moderation";
import { decidePostGenPath, decideResponsePath } from "@/lib/chat-precedence";
import { maybePatternAlert } from "@/lib/alerts";
import type { ChatUser, Defer } from "./types";
import {
  clientGone,
  fixedTextResponse,
  GENERATION_FALLBACK_REPLY,
} from "./respond";
import { checkChatRateLimits, validateChatBody } from "./validate";
import {
  findPriorAssistantReply,
  persistUserMessage,
  resolveConversation,
} from "./conversation";
import { recordSafetyEvent, saveAssistant } from "./persist";
import {
  alertGuardianSafely,
  createInteractionLogger,
  scheduleTtlPurge,
} from "./notify";
import { buildChatContext } from "./build-context";
import { createReplyGenerator, generationParams } from "./generate";

/**
 * Orquestador del pipeline de chat (ADR-1).
 *
 * Transplante SIN cambio de comportamiento del cuerpo de la ex-ruta monolítica
 * (src/app/api/chat/route.ts): mismo orden de ramas, mismos textos de log
 * "[chat] ...", mismos headers y status. La ruta queda como adaptador fino
 * (CSRF + sesión + catch de infraestructura) y este módulo encadena los stages:
 *   validate → conversation → persist(user) → buildContext → generate →
 *   guardrails (moderación in/out) → persist(assistant) → notify.
 * La DECISIÓN de precedencia de seguridad sigue delegada en chat-precedence.ts
 * (fuente única, testeada en suite). `defer` (tipo Defer) reemplaza a after()
 * de next/server — la ruta lo inyecta; nada bajo lib/ importa next/server.
 */
export async function runChatPipeline(args: {
  req: Request;
  user: ChatUser;
  /** Telemetría (B4): momento de entrada para medir la latencia total. */
  requestStartedAt: number;
  /** Difiere trabajo a después de enviada la respuesta (after() en la ruta). */
  defer: Defer;
}): Promise<Response> {
  const { req, user, requestStartedAt, defer } = args;
  const userId = user.id;
  // Rol del interlocutor (B3): se usa también dentro del closure diferido de
  // logInteraction.
  const userRole = user.role;

  // --- Gate de consentimiento (M-P1, Ley 25.326) ---
  // Un menor solo puede chatear si su tutor/a registró el consentimiento Y sigue
  // teniendo un tutor/a vivo. Los tutores (guardians) pasan directo (no consultan
  // la DB). Si el menor quedó HUÉRFANO (sin tutor/a: p.ej. el tutor/a borró su
  // cuenta y el cascade eliminó el vínculo), NO se opera sin supervisión: se
  // corta con un mensaje amable (mismo tono que el límite de sesión) en vez de un
  // 403 crudo. El resto de los motivos cae al 403 genérico.
  const consent = await canUserChat(user);
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
  const limited = await checkChatRateLimits(userId);
  if (limited) return limited;

  // --- Validación del body (nunca confiar en el cliente) ---
  const validated = await validateChatBody(req);
  if (!validated.ok) return validated.response;
  const { userText, requestedConversationId, clientMessageId } = validated.value;

  // --- Conversación (idempotente en el PRIMER mensaje, #19-2) ---
  // F1: el contexto conversacional es del SERVIDOR — historyRows viene de la DB.
  const { conversationId, historyRows, isNewConversation } =
    await resolveConversation({
      userId,
      requestedId: requestedConversationId,
      userText,
    });

  if (isNewConversation) {
    // Memoria capa 2 (lazy): al abrir una conversación nueva se resume la
    // última que quedó cerrada. `defer` (after() de next/server en la ruta,
    // estable en Next 16) ejecuta el callback DESPUÉS de enviar la respuesta —
    // en serverless mantiene viva la función (equivalente a waitUntil), así no
    // bloquea ni se pierde el trabajo. summarizeStaleConversation nunca lanza.
    // Solo el GANADOR de una carrera lo dispara (el perdedor no marca
    // isNewConversation).
    defer(() => summarizeStaleConversation(userId));
  }
  const responseHeaders = { "x-conversation-id": conversationId };

  // --- Capa de seguridad 1 (regex, pre-LLM) ---
  const regexFlag = detectSafetyFlag(userText);

  // Persistir el mensaje del menor NO puede bloquear la detección de crisis: si
  // la DB falla, se loguea y se sigue (regexFlag ya se calculó sobre userText,
  // en memoria). Un fallo de DB acá jamás debe impedir devolver la plantilla de
  // crisis más abajo (M1). Se captura el id para referenciarlo en InteractionLog.
  const { userMessageId, alreadyPersisted, persistedUserAt } =
    await persistUserMessage({
      conversationId,
      clientMessageId,
      userText,
      regexFlag,
    });

  // Reintento idempotente (#31-3): si el mensaje del menor YA estaba persistido
  // y el intento previo SÍ había respondido, se devuelve esa respuesta en vez de
  // generar un segundo turno — idempotencia real, sin assistant duplicado.
  if (alreadyPersisted && persistedUserAt) {
    const priorReply = await findPriorAssistantReply(conversationId, persistedUserAt);
    if (priorReply !== null) return fixedTextResponse(priorReply, responseHeaders);
  }

  // --- Telemetría de interacción (B4) ---
  const logInteraction = createInteractionLogger({
    userId,
    userRole,
    conversationId,
    userMessageId,
    requestStartedAt,
    defer,
  });

  let regexEventId: string | null = null;
  if (regexFlag) {
    regexEventId = await recordSafetyEvent({
      userId,
      conversationId,
      category: regexFlag,
      layer: "keyword",
    });
    // Alerta de PATRÓN (M-P2): riesgo/alimentario NO alertan de inmediato, pero
    // su acumulación sí. Diferida (defer): nunca suma latencia ni rompe el
    // chat (maybePatternAlert es no-throw). El conteo/dedupe vive en lib/alerts.
    if (regexFlag === "riesgo" || regexFlag === "alimentario") {
      const patternCategory = regexFlag; // narrowing para el closure diferido
      defer(() => maybePatternAlert(userId, patternCategory));
    }
  }

  const now = new Date();
  // --- TTL (M-D / B4): purgas lazy DIFERIDAS ---
  // Se registra ACÁ (antes de la rama fija de crisis) para que TODOS los caminos
  // de respuesta la programen: la rama crisis-regex retorna temprano y antes
  // quedaba fuera de la purga, a diferencia de las demás ramas fijas.
  scheduleTtlPurge({ userId, now, defer });

  // Crisis, abuso o trastorno alimentario: plantilla fija, el LLM no interviene.
  if (regexFlag === "crisis" || regexFlag === "abuso" || regexFlag === "alimentario") {
    const reply = crisisReply(regexFlag);
    const { id: assistantMessageId } = await saveAssistant({
      conversationId,
      content: reply,
      safetyFlag: "derivacion",
    });
    if (regexFlag !== "alimentario") {
      defer(() => alertGuardianSafely(userId, regexEventId, regexFlag));
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

  // --- Contexto (fichas + memoria + resumen) + ventana de sesión, en paralelo ---
  const ctx = await buildChatContext({
    user,
    conversationId,
    historyRows,
    userText,
    regexFlag,
    now,
  });
  const {
    dbHistory,
    modelMessages,
    baseSystem,
    riesgoAddendum,
    systemForParallel,
    sState,
    needsSessionWarn,
    assistantCount,
  } = ctx;

  // Parámetros de generación por rol (B3): los tutores/as pueden elaborar más
  // (más tokens) y con un tono algo más determinístico; los menores reciben
  // respuestas cortas y una pizca más de variación/calidez.
  const { maxOutputTokens, temperature } = generationParams(userRole);
  const generateReply = createReplyGenerator({
    messages: modelMessages,
    temperature,
    maxOutputTokens,
    reqSignal: req.signal,
  });

  // --- PARALELO: moderación de entrada + generación (si la IA está configurada) ---
  const configured = aiConfigured();
  const [inputMod, parallelGen] = await Promise.all([
    moderate(userText, undefined, req.signal),
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
    // Se captura el flag en una const: el defer difiere la llamada y TS no
    // preserva el narrowing de una propiedad dentro del closure.
    const alertCategory = inputCrisisFlag;
    const eventId = await recordSafetyEvent({
      userId,
      conversationId,
      category: inputMod.topCategory ?? inputCrisisFlag,
      layer: `moderation-input:${inputMod.source}`,
    });
    const reply = crisisReply(inputCrisisFlag);
    const { id: assistantMessageId } = await saveAssistant({
      conversationId,
      content: reply,
      safetyFlag: "derivacion",
    });
    defer(() => alertGuardianSafely(userId, eventId, alertCategory));
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
    await recordSafetyEvent({
      userId,
      conversationId,
      category: inputMod.topCategory ?? "riesgo",
      layer: `moderation-input:${inputMod.source}`,
    });
    effectiveFlag = "riesgo";
    // Alerta de patrón por acumulación (ver regex arriba). Diferida; no-throw.
    defer(() => maybePatternAlert(userId, "riesgo"));
  }

  // 2) Sesión vencida (M-S7) → cierre amable. Gana sobre la respuesta normal (la
  //    crisis ya se evaluó arriba). Generación paralela descartada.
  if (preGenPath === "session-limit") {
    const { id: assistantMessageId } = await saveAssistant({
      conversationId,
      content: SESSION_LIMIT_REPLY,
      safetyFlag: "session-limit",
    });
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
    const { id: assistantMessageId } = await saveAssistant({
      conversationId,
      content: reply,
      safetyFlag: null,
    });
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
    // #19-1: si la generación falló PORQUE el cliente se desconectó (no un
    // timeout ni un 5xx), no se persiste un fallback fantasma: el menor ya no
    // está para leerlo. Un timeout/error real SÍ persiste el fallback (abajo),
    // como hasta ahora (req.signal.aborted es false en ese caso).
    if (req.signal.aborted) return clientGone();
    const reply = GENERATION_FALLBACK_REPLY;
    const { id: assistantMessageId } = await saveAssistant({
      conversationId,
      content: reply,
      safetyFlag: null,
    });
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
  // Se modera SIEMPRE (aunque el cliente se haya desconectado): si el modelo
  // generó contenido de crisis/abuso, las ramas de sustitución de abajo
  // registran el SafetyEvent y alertan al tutor/a — esa señal de seguridad no
  // se pierde por una desconexión. El corte por abort va recién en el path
  // NORMAL (sin señal), único que dejaría un mensaje fantasma sin valor.
  const outputMod = await moderate(outputText, undefined, req.signal);
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
    const eventId = await recordSafetyEvent({
      userId,
      conversationId,
      category: outputMod.topCategory ?? outputMod.mappedFlag ?? "flagged",
      layer: `moderation-output:${outputMod.source}`,
    });
    // No mostramos el output del LLM: lo sustituimos por un mensaje seguro fijo.
    const safe = safeOutputReplacement(outputMod.mappedFlag);
    const finalFlag = outputMod.mappedFlag ?? "moderation-output";
    const { id: assistantMessageId } = await saveAssistant({
      conversationId,
      content: safe,
      safetyFlag: finalFlag,
    });
    if (outputMod.mappedFlag === "crisis" || outputMod.mappedFlag === "abuso") {
      const alertCategory = outputMod.mappedFlag; // narrowing para el closure
      defer(() => alertGuardianSafely(userId, eventId, alertCategory));
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
      const eventId = await recordSafetyEvent({
        userId,
        conversationId,
        category: decision.action === "replace" ? decision.flag : "unavailable",
        layer: "moderation-unavailable",
      });
      const finalFlag =
        decision.action === "replace" ? decision.flag : "moderation-unavailable";
      const { id: assistantMessageId } = await saveAssistant({
        conversationId,
        content: decision.reply,
        safetyFlag: finalFlag,
      });
      if (
        decision.action === "replace" &&
        (decision.flag === "crisis" || decision.flag === "abuso")
      ) {
        const alertCategory = decision.flag; // narrowing para el closure
        defer(() => alertGuardianSafely(userId, eventId, alertCategory));
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

  // #19-1: path NORMAL y el cliente ya cortó la conexión. No hay señal de
  // seguridad que persistir/alertar (las ramas de arriba ya cubrieron crisis/
  // abuso en entrada y salida), así que no se deja un mensaje fantasma del
  // asistente ni se gasta el re-chequeo de consentimiento. Se corta acá, antes
  // de persistir. (Si fue un timeout de generación, esto no aplica: ese caso
  // cae por la rama fallback-error, con req.signal.aborted en false.)
  if (req.signal.aborted) return clientGone();

  // Salida validada (API OK y sin flag, o degradación con regex limpia +
  // moderación de entrada disponible): mostramos el output del LLM.
  let finalText = outputText;

  // Recordatorio periódico de IA (M-F3): determinístico, cada 10 respuestas
  // del asistente en esta conversación (la que sale ahora es count + 1). El
  // conteo ya vino en el _count de la query de contexto (buildChatContext): en
  // el path normal no se persiste ninguna respuesta del asistente entre esa
  // lectura y acá, así que el valor es el mismo que un count fresco, sin query
  // extra.
  if (shouldAppendDisclosure(assistantCount)) {
    finalText += DISCLOSURE_TEXT;
  }

  // Aviso de pausa a los 30 min (M-S7): se anexa al final y el safetyFlag
  // "session-warn" persiste que el aviso ya fue dado (dedupe de la sesión).
  // Contención multi-tab: el chequeo de recentMessages (needsSessionWarn) es el
  // dedupe primario, pero dos pestañas simultáneas cerca del minuto 30 lo pasan
  // ambas y anexarían el aviso dos veces. `claimOnce` cierra esa carrera con una
  // marca atómica (Upstash SET NX en prod / memoria en dev): solo la PRIMERA
  // gana y anexa; la concurrente cae a mensaje normal. Se resuelve ACÁ (punto de
  // uso) y no antes para no consumir el slot en paths que no entregan el aviso
  // (blocked-midflight / clientGone). El `&&` corto evita el round-trip a Redis
  // salvo cuando el aviso realmente corresponde (cerca del minuto 30).
  const appendSessionWarn =
    needsSessionWarn &&
    (await claimOnce(`session-warn:${userId}`, SESSION_WARN_DEDUP_TTL_MS));
  if (appendSessionWarn) {
    finalText += SESSION_WARN_APPENDIX;
  }

  // L3: `safetyFlag` es un único valor (no un flag compuesto). En este path
  // conviven a lo sumo "session-warn" y effectiveFlag ("riesgo"); se prioriza
  // "session-warn" porque es el que necesita el dedupe del aviso de pausa. No se
  // necesita un flag compuesto hoy: ningún consumidor cruza ambas dimensiones.
  // saveAssistant ya es a prueba de fallos (M1): no requiere try/catch acá.
  const finalFlag = appendSessionWarn ? "session-warn" : effectiveFlag;

  // --- Re-chequeo de consentimiento/existencia (TOCTOU) ANTES de persistir/
  //     entregar el texto del LLM ---
  // `canUserChat` se evaluó al ENTRAR (gate de consentimiento) pero la generación
  // tarda hasta ~90s; en ese intervalo el tutor/a pudo revocar el consentimiento
  // o borrar al menor. Sin este re-chequeo, la respuesta del LLM se persistía y
  // entregaba igual. Es un chequeo BARATO (guardians: sin DB; menores: un
  // findUnique por el unique childUserId) y aplica SOLO a este path normal: las
  // respuestas FIJAS de seguridad (crisis/derivación/límite) SIEMPRE se entregan
  // (M1) y no se tocan. Si el re-chequeo bloquea, NO se persiste el texto del
  // LLM y se devuelve el MISMO desenlace que el guard original (mensaje amable
  // de huérfano para `no-guardian`; 403 genérico para el resto, p.ej.
  // `consent-revoked`).
  const recheck = await canUserChat(user);
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
      return fixedTextResponse(friendly, {
        ...responseHeaders,
        "cache-control": "no-store",
      });
    }
    return Response.json(
      { error: "Falta el consentimiento de tu tutor/a para usar el chat" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }

  const saved = await saveAssistant({
    conversationId,
    content: finalText,
    safetyFlag: finalFlag,
  });
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
  // forget vía defer para no sumar latencia a la respuesta.
  defer(() => updateRollingSummary(conversationId));

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
