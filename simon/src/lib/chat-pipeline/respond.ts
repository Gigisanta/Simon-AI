import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";

/**
 * Stage de respuesta (ADR-1): formato de salida hacia el cliente.
 * Sin lógica de negocio — solo la envoltura UI message stream y los textos
 * fijos de fallback.
 */

// Texto amable único para cuando NO se puede responder por un problema interno
// (fallo de generación del LLM o error de infraestructura no controlado). Fuente
// única para que la rama fallback-error y el catch de infraestructura (Lote 1,
// ciclo 15) devuelvan EXACTAMENTE el mismo mensaje: el menor nunca ve un 500 crudo
// ni un stack, solo una invitación a reintentar.
export const GENERATION_FALLBACK_REPLY =
  "Uy, tuve un problema para responderte recién. ¿Probamos de nuevo?";

/** Extrae el texto plano de un UIMessage (partes tipo "text"). */
export function messageText(message: UIMessage): string {
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
export function fixedTextResponse(text: string, headers?: Record<string, string>) {
  const stream = createUIMessageStream({
    execute({ writer }) {
      const id = "fixed-text";
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
    },
  });
  // Respuestas de chat con contenido del menor: nunca cachear por defecto. Un
  // caller puede sobreescribir pasando su propio "cache-control" (headers gana).
  return createUIMessageStreamResponse({
    stream,
    headers: { "cache-control": "no-store", ...headers },
  });
}

// #19-1: respuesta mínima cuando el cliente ya cortó la conexión. El body se
// descarta (nadie lo lee); se usa para NO persistir mensajes fantasma del
// asistente ni gastar DB/moderación en un request abandonado. NO se usa en
// los paths de seguridad (crisis/derivación/sesión), que siempre persisten y
// alertan al tutor/a aunque el menor se haya desconectado.
export const clientGone = () => new Response(null, { status: 499 });
