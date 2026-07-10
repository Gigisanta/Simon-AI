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

/** Vínculo de tutela con solo lo necesario para decidir el acceso. */
export type ConsentGuardian = { consentAt: Date | null } | null;

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
    select: { consentAt: true },
  });
  return canChat(user.role, guardian);
}
