import type { UIMessage } from "ai";

/**
 * Saneo del historial que manda el CLIENTE antes de pasarlo al modelo.
 *
 * SEGURIDAD (H2): el body del chat lo controla el cliente y puede fabricar
 * mensajes con role "system" (o cualquier otro) para inyectar instrucciones que
 * rodeen TODA la defensa anti-injection (el system prompt real, el addendum de
 * contención, las capas de moderación). El system prompt SIEMPRE lo arma el
 * servidor: del historial del cliente solo se conservan turnos de conversación
 * ("user"/"assistant"). Después se recorta a los últimos `maxHistory` mensajes
 * ya filtrados (ventana de contexto + control de costo).
 *
 * Función pura y testeable (scripts/moderation-suite.ts).
 */
export function sanitizeClientMessages(
  messages: UIMessage[],
  maxHistory: number,
): UIMessage[] {
  return messages
    .filter((m) => m?.role === "user" || m?.role === "assistant")
    .slice(-maxHistory);
}
