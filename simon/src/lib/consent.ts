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
