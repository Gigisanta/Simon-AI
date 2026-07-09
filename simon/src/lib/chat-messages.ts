import type { ModelMessage, UIMessage } from "ai";

/**
 * Construcción del contexto conversacional que ve el MODELO.
 *
 * SEGURIDAD (H2 → F1): el body del chat lo controla el cliente. Antes se le
 * aceptaba el historial completo (hasta 40 turnos, incluidos turnos "assistant"
 * fabricables) y solo se moderaba el ÚLTIMO mensaje user; eso permitía:
 *   (a) inyectar turnos assistant falsos para primear al modelo (jailbreak),
 *   (b) esconder contenido dañino en turnos user previos que la moderación de
 *       entrada nunca ve,
 *   (c) inflar tokens (DoS económico).
 *
 * Ahora el SERVIDOR es dueño del contexto: del cliente se toma SOLO el último
 * mensaje con role "user" (validado y moderado en la ruta); el resto del
 * historial se reconstruye desde la DB (mensajes reales, persistidos por el
 * propio servidor). El system prompt lo arma siempre el servidor.
 *
 * Funciones puras y testeables (scripts/moderation-suite.ts).
 */

/**
 * Último mensaje con role "user" del array del cliente — lo ÚNICO que se
 * acepta del body. Turnos fabricados (assistant/system/tool, o users previos)
 * se ignoran por completo.
 */
export function lastClientUserMessage(messages: UIMessage[]): UIMessage | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return messages[i];
  }
  return null;
}

/** Fila mínima del historial persistido (prisma.message). */
export type HistoryRow = { role: string; content: string };

/**
 * Convierte el historial REAL de la DB en mensajes para el modelo.
 * - Solo roles conversacionales "user"/"assistant" (cualquier otro valor en la
 *   DB se descarta: el modelo jamás recibe un "system" que no armó la ruta).
 * - Ventana defensiva de `maxHistory` mensajes (la query ya recorta; esto es
 *   el piso si el caller trae de más).
 * - Contenido como string plano (UserContent/AssistantContent lo aceptan).
 */
export function historyToModelMessages(
  rows: HistoryRow[],
  maxHistory: number,
): ModelMessage[] {
  return rows
    .filter((r) => r.role === "user" || r.role === "assistant")
    .slice(-maxHistory)
    .map((r) =>
      r.role === "user"
        ? { role: "user" as const, content: r.content }
        : { role: "assistant" as const, content: r.content },
    );
}
