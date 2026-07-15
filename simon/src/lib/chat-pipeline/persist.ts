import { prisma } from "@/lib/prisma";
import { isRaceDeletionError } from "@/lib/consent";

/**
 * Stage `persist` (ADR-1): escritura de la respuesta del asistente y registro
 * de eventos de seguridad. Ninguna de estas funciones lanza — invariante M1.
 */

/**
 * INVARIANTE M1: la respuesta con recursos SIEMPRE gana sobre la persistencia.
 * saveAssistant NUNCA lanza — en un path de respuesta fija (crisis, derivación,
 * límite de sesión, fallback) un fallo de DB no puede suprimir el texto que se
 * le devuelve al menor (los teléfonos de ayuda). Si la DB falla, se loguea y el
 * caller devuelve igual el fixedTextResponse.
 *
 * Devuelve `{ id, raceDeleted }`:
 *   - `id`: id del mensaje assistant creado (o null si la escritura falló) para
 *     referenciarlo en InteractionLog.
 *   - `raceDeleted`: true SOLO si el fallo fue una carrera de borrado del menor
 *     (P2003/P2025 — ver isRaceDeletionError). En ese caso el texto del LLM NO
 *     debe entregarse (el path normal lo chequea). Los paths de respuesta FIJA
 *     (crisis/sesión/fallback) IGNORAN este flag y entregan igual (M1): jamás se
 *     le niega a un menor los recursos de ayuda por una carrera de borrado.
 */
export async function saveAssistant(args: {
  conversationId: string;
  content: string;
  safetyFlag: string | null;
}): Promise<{ id: string | null; raceDeleted: boolean }> {
  const { conversationId, content, safetyFlag } = args;
  try {
    // Dos escrituras (crear el mensaje + bumpear updatedAt) en UNA transacción:
    // una sola ida a la DB y consistencia atómica del par.
    const [created] = await prisma.$transaction([
      prisma.message.create({
        data: { conversationId, role: "assistant", content, safetyFlag },
        select: { id: true },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
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
    console.error(
      "[chat] error guardando la respuesta del asistente (se devuelve igual):",
      err,
    );
    return { id: null, raceDeleted: false };
  }
}

/**
 * Evento de seguridad anonimizado: solo categoría + capa, nunca el contenido.
 * No debe tumbar la request si falla la persistencia. Devuelve el id del
 * evento (o null) para poder marcarle notifiedAt si se alerta al tutor/a.
 */
export async function recordSafetyEvent(args: {
  userId: string;
  conversationId: string;
  category: string;
  layer: string;
}): Promise<string | null> {
  try {
    const event = await prisma.safetyEvent.create({
      data: args,
      select: { id: true },
    });
    return event.id;
  } catch (err) {
    console.error("[chat] error registrando SafetyEvent:", err);
    return null;
  }
}
