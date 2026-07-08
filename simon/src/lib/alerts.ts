/**
 * Alertas de crisis al tutor/a (M-P2, docs/research-safety.md §2.1).
 *
 * Cuando el chat registra un SafetyEvent con categoría crisis/abuso, se avisa
 * por email al tutor/a del menor — tema sí, transcripción no (privacidad del
 * menor). El resumen semanal de M-P2 NO es de este módulo (fase posterior).
 *
 * UMBRAL DE ALERTA: solo "crisis" y "abuso" disparan email. "riesgo" (angustia
 * elevada que sí pasa por el LLM) y "alimentario" NO alertan por ahora: son
 * señales de menor severidad/alta frecuencia y sobre-alertar erosiona la
 * confianza del tutor/a (fatiga de alertas) y la del menor en la herramienta.
 *
 * `shouldAlert` es lógica pura y testeable (scripts/alerts-suite.ts).
 * `maybeAlertGuardian` es el wrapper con DB + email y NUNCA lanza: un fallo de
 * alerta jamás debe romper la respuesta al menor.
 */
import { prisma } from "@/lib/prisma";
import { deliverCrisisAlert } from "@/lib/email";

/** Dedupe: máximo 1 alerta por hora por menor. */
export const ALERT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/** Categorías de SafetyEvent que disparan alerta inmediata (ver umbral arriba). */
export const ALERT_CATEGORIES = ["crisis", "abuso"] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

/** Vínculo de tutela con solo lo necesario para decidir la alerta. */
export type AlertGuardian = {
  consentAt: Date | null;
  alertsEnabled: boolean;
} | null;

/**
 * Decide si corresponde alertar al tutor/a. Función pura: sin efectos, sin DB.
 *
 * - Solo menores (`role === "child"`).
 * - Requiere vínculo Guardian con consentimiento registrado (`consentAt`).
 * - El tutor/a puede apagar las alertas (`alertsEnabled`).
 * - Dedupe: si ya se notificó dentro de la última hora, no se reenvía.
 */
export function shouldAlert({
  role,
  guardian,
  lastNotifiedAt,
  now,
}: {
  role: string | null | undefined;
  guardian: AlertGuardian;
  lastNotifiedAt: Date | null;
  now: Date;
}): boolean {
  if (role !== "child") return false;
  if (!guardian) return false;
  if (!guardian.consentAt) return false;
  if (!guardian.alertsEnabled) return false;
  if (
    lastNotifiedAt &&
    now.getTime() - lastNotifiedAt.getTime() < ALERT_DEDUPE_WINDOW_MS
  ) {
    return false;
  }
  return true;
}

/**
 * Categoría del SafetyEvent → lenguaje humano, no alarmista, para el email.
 * Nunca se incluye el contenido del mensaje del menor.
 */
export function humanCategory(category: string): string {
  if (category === "crisis") return "angustia intensa";
  if (category === "abuso") return "posible situación de abuso";
  // Categorías crudas de la Moderation API u otras señales severas.
  return "posible situación de riesgo";
}

/**
 * Alerta al tutor/a si corresponde (ver `shouldAlert`). Si el email sale bien y
 * hay un `safetyEventId`, marca `notifiedAt` en ese SafetyEvent (base del dedupe
 * por hora).
 *
 * `safetyEventId` puede ser `null` (L1): si el registro del SafetyEvent falló, la
 * alerta se intenta igual — el dedupe es por query, no depende de este id — y
 * simplemente no se ancla `notifiedAt` (el próximo evento podría re-alertar
 * dentro de la hora: aceptable frente a callar una crisis).
 *
 * Nunca lanza: cualquier fallo se loguea y se devuelve `false`. La respuesta
 * al menor no depende de esto.
 */
export async function maybeAlertGuardian(
  childUserId: string,
  safetyEventId: string | null,
  category: string,
): Promise<boolean> {
  try {
    const now = new Date();

    const [child, lastNotified] = await Promise.all([
      prisma.user.findUnique({
        where: { id: childUserId },
        select: {
          role: true,
          name: true,
          guardedBy: {
            select: {
              consentAt: true,
              alertsEnabled: true,
              guardianUser: { select: { email: true } },
            },
          },
        },
      }),
      // Dedupe: ¿ya se notificó a este tutor/a dentro de la última hora?
      prisma.safetyEvent.findFirst({
        where: {
          userId: childUserId,
          notifiedAt: { gt: new Date(now.getTime() - ALERT_DEDUPE_WINDOW_MS) },
        },
        select: { notifiedAt: true },
        orderBy: { notifiedAt: "desc" },
      }),
    ]);

    if (!child) return false;
    if (
      !shouldAlert({
        role: child.role,
        guardian: child.guardedBy,
        lastNotifiedAt: lastNotified?.notifiedAt ?? null,
        now,
      })
    ) {
      return false;
    }

    const guardianEmail = child.guardedBy?.guardianUser.email;
    if (!guardianEmail) return false;

    const sent = await deliverCrisisAlert(guardianEmail, {
      childName: child.name,
      signal: humanCategory(category),
    });
    if (!sent) return false;

    // Solo si el envío salió bien y hay evento que anclar: notifiedAt = now
    // (base del dedupe). Sin eventId (L1) no se ancla; se acepta la ventana.
    //
    // L4: entre la query de dedupe (findFirst por notifiedAt) y este update hay
    // una carrera teórica (dos crisis casi simultáneas podrían mandar dos
    // emails). Se acepta: la ventana es mínima, el costo de un email duplicado
    // es bajo, y evitar la carrera exigiría un lock/constraint que no se
    // justifica hoy frente al riesgo de callar una alerta.
    if (safetyEventId) {
      await prisma.safetyEvent.update({
        where: { id: safetyEventId },
        data: { notifiedAt: now },
      });
    }
    return true;
  } catch (err) {
    console.error("[alerts] error alertando al tutor/a:", err);
    return false;
  }
}
