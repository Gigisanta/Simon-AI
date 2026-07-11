/**
 * Armado del bloque `conversations` del export de datos del menor
 * (api/guardian/children/[childId]/export). Extraído de la route para poder
 * testear el orden y la estructura sin DB (se inyecta el colector de mensajes).
 *
 * Antes se resolvía secuencialmente (un `await collectMessages` por conversación
 * dentro de un for), serializando N round-trips a la DB. Se paraleliza, pero en
 * CHUNKS de concurrencia acotada (EXPORT_CONCURRENCY): un `Promise.all` global
 * abriría una promesa por conversación y, como cada `collect` pagina mensajes por
 * cursor (N round-trips propios), un menor con muchas conversaciones podía saturar
 * el pool de conexiones de la DB. Procesar en chunks preserva el orden de entrada
 * (se concatenan en orden) y la semántica de error de `Promise.all` (el primer
 * rechazo propaga y aborta), acotando cuántas conversaciones se resuelven a la vez.
 */

/** Cuántas conversaciones se resuelven en paralelo (cota de concurrencia a la DB). */
export const EXPORT_CONCURRENCY = 10;

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
 * Construye el array de conversaciones exportadas en paralelo por CHUNKS
 * (EXPORT_CONCURRENCY a la vez), preservando el orden de `conversations`.
 * `collect` trae los mensajes de una conversación (en la route es collectMessages,
 * paginado por cursor; en los tests, un mock). Si algún `collect` rechaza, el
 * `Promise.all` del chunk propaga el error y aborta (misma semántica que antes).
 */
export async function buildExportedConversations(
  conversations: ConversationMeta[],
  collect: (conversationId: string) => Promise<ExportedMessage[]>,
): Promise<ExportedConversation[]> {
  const out: ExportedConversation[] = [];
  for (let i = 0; i < conversations.length; i += EXPORT_CONCURRENCY) {
    const chunk = conversations.slice(i, i + EXPORT_CONCURRENCY);
    const resolved = await Promise.all(
      chunk.map(async (conv) => ({
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messages: await collect(conv.id),
      })),
    );
    out.push(...resolved);
  }
  return out;
}
