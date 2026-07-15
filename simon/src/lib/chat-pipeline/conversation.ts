import { prisma } from "@/lib/prisma";
import { safeTruncate } from "@/lib/text";
import { isUniqueConstraintError } from "@/lib/consent";
import { resolveDuplicateUserMessage } from "@/lib/chat-idempotency";
import type { HistoryRow } from "@/lib/chat-messages";
import type { SafetyFlag } from "@/lib/safety";

/**
 * Stage `conversation` (ADR-1): resolución idempotente de la Conversation y
 * persistencia idempotente del mensaje del menor.
 */

// Guarda de I/O del fetch de historial (ADR-7): tope de FILAS que se leen de la
// DB por request — NO es política de contexto. Qué entra al prompt lo decide UN
// solo módulo: assembleContext/trimHistory (presupuesto por TOKENS). 200 filas
// alcanzan de sobra para llenar el presupuesto (history: 3000 tokens) y acotan
// el costo de leer conversaciones larguísimas. Mismo tope que la lectura de UI
// (conversations/[id], take: 200).
export const HISTORY_FETCH_LIMIT = 200;

async function loadOwnedHistory(
  userId: string,
  id: string,
): Promise<HistoryRow[] | null> {
  const owned = await prisma.conversation.findFirst({
    where: { id, userId },
    select: {
      id: true,
      messages: {
        orderBy: { createdAt: "desc" }, // los últimos N...
        take: HISTORY_FETCH_LIMIT,
        select: { role: true, content: true },
      },
    },
  });
  return owned ? owned.messages.reverse() : null; // ...en orden cronológico.
}

/**
 * Conversación (idempotente en el PRIMER mensaje, #19-2).
 * El cliente genera el id (crypto.randomUUID) y lo manda DESDE el primer
 * mensaje. Así dos envíos paralelos del mismo primer mensaje (doble submit,
 * doble click en un quick-start) convergen en UNA sola Conversation en vez de
 * crear dos: comparten el id, el servidor crea-si-no-existe de forma atómica
 * (la unicidad la garantiza la PK) y el perdedor de la carrera recibe P2002 y
 * se adjunta a la fila ganadora. Sin token del cliente sería imposible dedupe
 * (el primer request no tiene con qué reconocer a su gemelo).
 *
 * F1: el contexto conversacional es del SERVIDOR — historyRows es el historial
 * crudo (cronológico) para el recorte por presupuesto (B2), cargado solo si la
 * conversación ya es del usuario. El `where` filtra por userId (no se leen
 * conversaciones ajenas).
 */
export async function resolveConversation(args: {
  userId: string;
  requestedId: string | null;
  userText: string;
}): Promise<{
  conversationId: string;
  historyRows: HistoryRow[];
  isNewConversation: boolean;
}> {
  const { userId, userText } = args;
  let conversationId = args.requestedId;
  let historyRows: HistoryRow[] = [];
  let isNewConversation = false;

  if (conversationId) {
    const rows = await loadOwnedHistory(userId, conversationId);
    if (rows) {
      historyRows = rows; // conversación existente del usuario
    } else {
      // Aún no es una conversación del usuario: o es el PRIMER mensaje con id
      // generado por el cliente, o un id ajeno. Se intenta crear con ESE id,
      // propiedad del usuario actual (create-if-not-exists atómico vía PK).
      try {
        await prisma.conversation.create({
          data: { id: conversationId, userId, title: safeTruncate(userText, 60) },
          select: { id: true },
        });
        isNewConversation = true;
      } catch (err) {
        if (isUniqueConstraintError(err)) {
          // El id ya existía. Si es un request paralelo NUESTRO que ganó la
          // carrera (mismo userId) → nos adjuntamos y cargamos su historial:
          // ambos envíos terminan en la MISMA Conversation. Si el id es ajeno,
          // loadOwnedHistory devuelve null y caemos al id del servidor.
          const raced = await loadOwnedHistory(userId, conversationId);
          if (raced) historyRows = raced;
          else conversationId = null;
        } else {
          throw err; // fallo real → lo maneja el catch de infraestructura
        }
      }
    }
  }

  if (!conversationId) {
    // Sin id válido del cliente (o id ajeno que colisionó): id del servidor.
    const created = await prisma.conversation.create({
      data: { userId, title: safeTruncate(userText, 60) },
      select: { id: true },
    });
    conversationId = created.id;
    isNewConversation = true;
  }

  return { conversationId, historyRows, isNewConversation };
}

/**
 * Persistir el mensaje del menor NO puede bloquear la detección de crisis: si
 * la DB falla, se loguea y se sigue (el regexFlag ya se calculó sobre userText,
 * en memoria). Un fallo de DB acá jamás debe impedir devolver la plantilla de
 * crisis (M1). Se captura el id para referenciarlo en InteractionLog.
 *
 * Reintento idempotente (#31-3): `alreadyPersisted` es true si el mensaje del
 * menor YA estaba persistido con este clientMessageId; `persistedUserAt` marca
 * su createdAt para decidir si hay que regenerar la respuesta o replicar la ya
 * generada.
 */
export async function persistUserMessage(args: {
  conversationId: string;
  clientMessageId: string | null;
  userText: string;
  regexFlag: SafetyFlag;
}): Promise<{
  userMessageId: string | null;
  alreadyPersisted: boolean;
  persistedUserAt: Date | null;
}> {
  const { conversationId, clientMessageId, userText, regexFlag } = args;
  let userMessageId: string | null = null;
  let alreadyPersisted = false;
  let persistedUserAt: Date | null = null;
  try {
    // Create optimista: en el caso normal (mensaje nuevo) el clientMessageId no
    // existe y se persiste con ese id como PK. Sólo la carrera/reintento choca.
    const created = await prisma.message.create({
      data: {
        ...(clientMessageId ? { id: clientMessageId } : {}),
        conversationId,
        role: "user",
        content: userText,
        safetyFlag: regexFlag,
      },
      select: { id: true },
    });
    userMessageId = created.id;
  } catch (err) {
    if (clientMessageId && isUniqueConstraintError(err)) {
      // El id ya existe: reintento del MISMO mensaje (o su gemelo en carrera de
      // doble submit). Se decide reuse (no duplicar) vs recreate (id ajeno).
      const existing = await prisma.message.findUnique({
        where: { id: clientMessageId },
        select: { conversationId: true, role: true, createdAt: true },
      });
      const decision = resolveDuplicateUserMessage(existing, conversationId);
      if (decision.kind === "reuse") {
        userMessageId = clientMessageId;
        alreadyPersisted = true;
        persistedUserAt = decision.persistedUserAt;
      } else {
        // Colisión con un id ajeno (uuid v4: prácticamente imposible). Se
        // persiste con el PK del servidor para no atarse a un mensaje ajeno.
        try {
          const created = await prisma.message.create({
            data: { conversationId, role: "user", content: userText, safetyFlag: regexFlag },
            select: { id: true },
          });
          userMessageId = created.id;
        } catch (err2) {
          console.error(
            "[chat] error guardando el mensaje del usuario (se sigue igual):",
            err2,
          );
        }
      }
    } else {
      console.error(
        "[chat] error guardando el mensaje del usuario (se sigue igual):",
        err,
      );
    }
  }
  return { userMessageId, alreadyPersisted, persistedUserAt };
}

/**
 * Semántica documentada del reintento: sólo se regenera la respuesta si NO hay
 * una del asistente POSTERIOR a este mensaje del menor. El botón "Reintentar"
 * sólo aparece tras un error (sin respuesta persistida), así que el caso normal
 * regenera. Si el intento previo SÍ había respondido (p.ej. el stream llegó
 * pero el cliente vio un corte de red en la cola), se devuelve esa respuesta en
 * vez de generar un segundo turno — idempotencia real, sin assistant duplicado.
 */
export async function findPriorAssistantReply(
  conversationId: string,
  persistedUserAt: Date,
): Promise<string | null> {
  const priorAssistant = await prisma.message.findFirst({
    where: { conversationId, role: "assistant", createdAt: { gt: persistedUserAt } },
    orderBy: { createdAt: "asc" },
    select: { content: true },
  });
  return priorAssistant?.content ?? null;
}
