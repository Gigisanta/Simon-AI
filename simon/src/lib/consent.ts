/**
 * Gate de consentimiento para el chat (M-P1, Ley 25.326).
 *
 * Un menor (`role === "child"`) solo puede usar el chat si existe una fila
 * `Guardian` con `consentAt` no-nulo: consentimiento verificable del tutor/a
 * ANTES del primer uso. Los tutores (guardians) y cualquier otro rol pasan.
 *
 * `canChat` es lógica pura y testeable (scripts/guardian-suite.ts). El wrapper
 * `canUserChat` consulta la DB.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/** Vínculo de tutela con solo lo necesario para decidir el acceso. */
export type ConsentGuardian = {
  consentAt: Date | null;
  // Revocación standalone (Ley 25.326, derecho de oposición): si es no-null, el
  // tutor/a suspendió el acceso — se trata como no-consent aunque `consentAt` esté.
  consentRevokedAt?: Date | null;
} | null;

export type ChatDecision = { ok: true } | { ok: false; reason: string };

/**
 * Mensaje amable (mismo tono que SESSION_LIMIT_REPLY) para el menor cuando su
 * cuenta quedó SIN un tutor/a vivo — p.ej. el tutor/a borró su propia cuenta y
 * el cascade eliminó el vínculo Guardian. En vez de operar sin supervisión, el
 * chat se corta con esta explicación (no un 403 crudo): el menor entiende qué
 * pasó y a quién recurrir, sin culpa. La supervisión es un requisito duro
 * (Ley 25.326): sin adulto responsable no hay chat.
 */
export const NO_GUARDIAN_CHAT_REPLY =
  "Ahora mismo tu cuenta no está conectada con la de un adulto que te acompañe, así que no puedo seguir la charla. Pedile a tu mamá, papá o a la persona que te cuida que configure tu acceso desde su cuenta. En cuanto esté listo, vuelvo a estar acá para vos. 💙";

/**
 * Traduce el motivo de bloqueo del chat a un mensaje amable para mostrarle al
 * menor (respuesta de texto fija, como el límite de sesión), o `null` si el caso
 * debe caer al 403 genérico. Función pura y testeable.
 *
 * `no-guardian`: menor huérfano (sin tutor/a vivo) → mensaje explicativo.
 * Otros motivos (p.ej. `no-consent`) caen al 403 genérico por defecto.
 */
export function blockedChatMessage(reason: string): string | null {
  switch (reason) {
    case "no-guardian":
      return NO_GUARDIAN_CHAT_REPLY;
    default:
      return null;
  }
}

/**
 * ¿El error de persistencia corresponde a que el menor —o su fila / sus datos—
 * DESAPARECIÓ mientras se generaba la respuesta? Es la carrera TOCTOU esperada
 * del chat: `canUserChat` se evaluó al inicio, la generación tarda hasta ~90s y
 * en el ínterin el tutor/a pudo borrar al menor (el cascade arrastra User →
 * Conversation → Message). Códigos de Prisma que la delatan:
 *   - P2003: violación de FK (el `conversationId` ya no apunta a una Conversation
 *            viva porque el User dueño se borró).
 *   - P2025: el registro a crear/actualizar ya no existe (Conversation borrada).
 *
 * Se distingue del fallo TRANSITORIO (red/timeout/pool) para dos cosas:
 *   (a) loguearlo como evento ESPERADO de carrera, sin stack ruidoso, y
 *   (b) NO entregar el texto del LLM a una cuenta que ya no debería recibirlo.
 * Un fallo transitorio, en cambio, conserva el comportamiento actual (M1: la
 * respuesta gana sobre la persistencia). Función pura y testeable.
 */
export function isRaceDeletionError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2003" || err.code === "P2025")
  );
}

/**
 * ¿El error es una violación de restricción única (Prisma P2002)? Se usa en la
 * creación idempotente de la Conversation del PRIMER mensaje: el cliente genera
 * el id y lo manda; si dos envíos paralelos (doble submit) intentan crear la
 * misma fila, la PK hace que el perdedor de la carrera reciba P2002 — que no es
 * un error a propagar sino la señal de "ya existe, adjuntate a la ganadora".
 * Función pura y testeable.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
  );
}

/**
 * Decide si un usuario puede chatear, dado su rol y su vínculo de tutela.
 * Función pura: sin efectos, sin DB.
 */
export function canChat(
  role: string | null | undefined,
  guardian: ConsentGuardian,
): ChatDecision {
  // Solo los menores necesitan consentimiento registrado.
  if (role !== "child") return { ok: true };
  if (!guardian) return { ok: false, reason: "no-guardian" };
  if (!guardian.consentAt) return { ok: false, reason: "no-consent" };
  // Consentimiento revocado (suspensión standalone): bloquea igual que no-consent,
  // sin borrar datos. Gana sobre `consentAt`: un consentimiento previo revocado
  // NO habilita el chat.
  if (guardian.consentRevokedAt) return { ok: false, reason: "consent-revoked" };
  return { ok: true };
}

/**
 * Wrapper con DB: busca el vínculo de tutela del menor y aplica `canChat`.
 * Para no-menores no consulta la DB.
 */
export async function canUserChat(user: {
  id: string;
  role?: string | null;
}): Promise<ChatDecision> {
  if (user.role !== "child") return canChat(user.role, null);
  const guardian = await prisma.guardian.findUnique({
    where: { childUserId: user.id },
    select: { consentAt: true, consentRevokedAt: true },
  });
  return canChat(user.role, guardian);
}
