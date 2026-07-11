/**
 * Idempotencia del mensaje del menor en /api/chat (#31-3).
 *
 * El cliente genera un `clientMessageId` (uuid) estable por mensaje lógico y lo
 * reusa al reintentar el MISMO texto tras un error. El servidor lo usa como PK
 * del Message (`Message.id`, un String @id) — sin columna nueva ni migración —
 * para no persistir dos veces el mensaje del menor cuando el envío se reintenta.
 *
 * Lógica PURA y testeable (scripts/chat-idempotency-suite.ts). El handler hace la
 * IO (create optimista + lookup en la rama P2002) alrededor de estas funciones.
 */
import { z } from "zod";

/** uuid v4 lo genera el cliente con crypto.randomUUID(); cualquier versión vale. */
const clientMessageIdSchema = z.uuid();

/**
 * Normaliza el `clientMessageId` del body. Opcional y tolerante (retrocompat):
 * ausente o con formato inválido → null → el servidor genera el PK como siempre.
 * Nunca rechaza el request por esto (mismo criterio que el conversationId).
 */
export function parseClientMessageId(raw: unknown): string | null {
  const parsed = clientMessageIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Fila mínima del Message ya existente (o null si no hay). */
export type ExistingMessage = {
  conversationId: string;
  role: string;
  createdAt: Date;
} | null;

/**
 * Decisión ante una colisión de PK (P2002) al intentar crear el mensaje del
 * menor con el `clientMessageId`:
 *   - "reuse":    el id ya existe COMO mensaje "user" de ESTA conversación → es
 *                 un reintento; no se re-persiste. `persistedUserAt` sirve para
 *                 decidir si hay que regenerar la respuesta o replicar la vieja.
 *   - "recreate": el id existe pero es de otro hilo/rol (colisión de uuid v4:
 *                 astronómicamente improbable, o un id forjado). No se reusa: se
 *                 crea con el PK del servidor para no atarse a algo ajeno.
 */
export type DuplicateDecision =
  | { kind: "reuse"; persistedUserAt: Date }
  | { kind: "recreate" };

export function resolveDuplicateUserMessage(
  existing: ExistingMessage,
  conversationId: string,
): DuplicateDecision {
  if (existing && existing.conversationId === conversationId && existing.role === "user") {
    return { kind: "reuse", persistedUserAt: existing.createdAt };
  }
  return { kind: "recreate" };
}
