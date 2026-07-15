import type { UIMessage } from "ai";
import { checkRateLimit } from "@/lib/rate-limit";
import { rateLimitMessage } from "@/lib/ui-messages";
import { hasVisibleContent } from "@/lib/text";
import { lastClientUserMessage } from "@/lib/chat-messages";
import { parseClientMessageId } from "@/lib/chat-idempotency";
import { messageText } from "./respond";

/**
 * Stage `validate` (ADR-1): rate limiting + validación del body.
 * Nunca confiar en el cliente — todo error termina en 4xx tipado, jamás en 500.
 */

// Límites defensivos (costo + abuso). Ver docs/security-review.md.
const MAX_MESSAGE_CHARS = 4_000; // el cliente corta en 2000; el servidor manda
// Cap defensivo del array `messages` del cliente (costo + abuso). La ruta NO usa
// el historial del cliente (F1: el contexto conversacional se reconstruye desde
// la DB); del body se toma SOLO el último mensaje con role "user". useChat
// (@ai-sdk/react) retiene TODA la conversación en memoria y la manda entera en
// cada request, así que un chat largo LEGÍTIMO puede traer cientos de entradas:
// rechazar con 400 por longitud rompería esa sesión. Por eso, en vez de
// rechazar, se TRUNCA al sufijo relevante antes de iterar — lastClientUserMessage
// escanea desde el final, así el último "user" (que el cliente siempre appendea
// al enviar) queda incluido y se acota el costo de recorrer un array inflado.
// El valor es holgado (varias veces la ventana de resume, take:40) para no tocar
// jamás un cliente real; el recorte real de contexto lo hace assembleContext
// (presupuesto por tokens — ADR-7).
const MAX_CLIENT_MESSAGES = 100;
// Retención de InteractionLog (telemetría, 180d) y su corte temporal viven en
// lib/retention.ts — MISMA fuente que usa el cron de purga (#9): cero duplicación.
const RATE_LIMIT_PER_MINUTE = 15;
const RATE_LIMIT_PER_DAY = 400;

/**
 * Rate limiting por usuario (ráfaga + tope diario). Ambos chequeos son
 * independientes (claves y ventanas distintas): se corren en paralelo. La
 * precedencia del error se mantiene (minuto antes que día).
 * Devuelve la Response 429 si limita, o null si puede seguir.
 */
export async function checkChatRateLimits(userId: string): Promise<Response | null> {
  const [minute, day] = await Promise.all([
    checkRateLimit(`chat:m:${userId}`, RATE_LIMIT_PER_MINUTE, 60_000),
    checkRateLimit(`chat:d:${userId}`, RATE_LIMIT_PER_DAY, 24 * 60 * 60 * 1000),
  ]);
  const limited = !minute.ok ? minute : !day.ok ? day : null;
  if (limited && !limited.ok) {
    return Response.json(
      { error: rateLimitMessage("mensajes", "m") },
      {
        status: 429,
        headers: { "retry-after": String(limited.retryAfterSeconds) },
      },
    );
  }
  return null;
}

export type ValidatedChatRequest = {
  /** Único texto del cliente que se acepta (F1): el ÚLTIMO mensaje "user". */
  userText: string;
  /** Id de conversación propuesto por el cliente, ya validado en formato (o null). */
  requestedConversationId: string | null;
  /** Id idempotente del mensaje del menor (#31-3), validado (o null). */
  clientMessageId: string | null;
};

/**
 * Validación del body (nunca confiar en el cliente).
 * Anti-injection / anti-priming (H2 → F1): del body del cliente se toma SOLO
 * el ÚLTIMO mensaje con role "user". Todo lo demás (turnos assistant
 * fabricables para primear al modelo, users previos que la moderación de
 * entrada nunca vería, roles system/tool inyectados) se IGNORA: el contexto
 * conversacional lo reconstruye el servidor desde la DB.
 */
export async function validateChatBody(
  req: Request,
): Promise<
  | { ok: true; value: ValidatedChatRequest }
  | { ok: false; response: Response }
> {
  let body: {
    messages?: unknown;
    conversationId?: unknown;
    clientMessageId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "Body inválido" }, { status: 400 }),
    };
  }
  if (!Array.isArray(body.messages)) {
    return {
      ok: false,
      response: Response.json(
        { error: "messages debe ser una lista" },
        { status: 400 },
      ),
    };
  }
  // Cap defensivo (ver MAX_CLIENT_MESSAGES): se trunca al sufijo relevante en
  // vez de rechazar, porque solo interesa el último "user" y un chat largo
  // legítimo trae el historial entero.
  const clientMessages = (body.messages as UIMessage[]).slice(-MAX_CLIENT_MESSAGES);
  const lastUser = lastClientUserMessage(clientMessages);
  const userText = lastUser ? messageText(lastUser) : "";
  // hasVisibleContent en vez de `.trim()`: un mensaje hecho solo de caracteres
  // de ancho cero (ZWSP/ZWJ/BOM…) NO es contenido real y debe rechazarse como
  // vacío. `.trim()` no los elimina (no son whitespace) y los dejaba pasar.
  if (!hasVisibleContent(userText)) {
    return {
      ok: false,
      response: Response.json({ error: "Mensaje vacío" }, { status: 400 }),
    };
  }
  if (userText.length > MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      response: Response.json(
        { error: `El mensaje supera el máximo de ${MAX_MESSAGE_CHARS} caracteres` },
        { status: 400 },
      ),
    };
  }

  // Formato validado (defensa): 8..64 chars alfanuméricos/-/_ (cubre uuid y el
  // cuid del servidor). Un id inválido → null → id generado por el servidor.
  // SEGURIDAD: ownership siempre por `where: { id, userId }`; un id ajeno nunca
  // se lee ni se pisa (ver stage conversation).
  const requestedConversationId =
    typeof body.conversationId === "string" &&
    /^[a-zA-Z0-9_-]{8,64}$/.test(body.conversationId)
      ? body.conversationId
      : null;

  // Idempotencia del mensaje del menor (#31-3): id de mensaje generado por el
  // cliente, estable entre reintentos del MISMO texto. Opcional (retrocompat:
  // si falta o es inválido → null → el servidor genera el PK como siempre).
  const clientMessageId = parseClientMessageId(body.clientMessageId);

  return {
    ok: true,
    value: { userText, requestedConversationId, clientMessageId },
  };
}
