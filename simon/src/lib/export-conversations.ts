/**
 * Armado del bloque `conversations` del export de datos del menor
 * (api/guardian/children/[childId]/export). Extraído de la route para poder
 * testear el orden y la estructura sin DB (se inyecta el colector de mensajes).
 *
 * Antes se resolvía secuencialmente (un `await collectMessages` por conversación
 * dentro de un for), serializando N round-trips a la DB. Acá se paraleliza con
 * `Promise.all`: `Array.map` conserva el orden del array de entrada aunque las
 * promesas resuelvan en cualquier orden, así que el resultado es idéntico al del
 * loop secuencial, solo que más rápido. El endpoint ya está rate-limited (5/min),
 * así que N por export es acotado y no hace falta límite de concurrencia extra.
 */

/** Metadata de conversación que necesita el export (proyección de la query). */
export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Mensaje exportado (sin id: solo el dato del titular). */
export interface ExportedMessage {
  role: string;
  content: string;
  createdAt: Date;
}

/** Conversación exportada: metadata (sin id interno) + mensajes. */
export interface ExportedConversation {
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: ExportedMessage[];
}

/**
 * Construye el array de conversaciones exportadas EN PARALELO, preservando el
 * orden de `conversations`. `collect` trae los mensajes de una conversación
 * (en la route es collectMessages, paginado por cursor; en los tests, un mock).
 */
export async function buildExportedConversations(
  conversations: ConversationMeta[],
  collect: (conversationId: string) => Promise<ExportedMessage[]>,
): Promise<ExportedConversation[]> {
  return Promise.all(
    conversations.map(async (conv) => ({
      title: conv.title,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: await collect(conv.id),
    })),
  );
}
