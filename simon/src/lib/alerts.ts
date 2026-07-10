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
import { deliverCrisisAlert, deliverPatternAlert } from "@/lib/email";

/** Dedupe: máximo 1 alerta por hora por menor. */
export const ALERT_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/** Categorías de SafetyEvent que disparan alerta inmediata (ver umbral arriba). */
export const ALERT_CATEGORIES = ["crisis", "abuso"] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// ALERTA DE PATRÓN (acumulación de "riesgo"/"alimentario").
//
// "riesgo" y "alimentario" NO disparan alerta inmediata (ver umbral arriba:
// anti-fatiga). Pero la REPETICIÓN sí es una señal que un tutor/a querría
// conocer: no una crisis puntual, sino un patrón sostenido. Cuando se acumulan
// PATTERN_ALERT_THRESHOLD eventos de la MISMA categoría en PATTERN_WINDOW_DAYS,
// se manda UN email de patrón (cuidadoso, no alarmista), con dedupe semanal por
// child+categoría para no volver a caer en la fatiga que el umbral evita.
// ---------------------------------------------------------------------------

/** Umbral de acumulación que dispara la alerta de patrón. */
export const PATTERN_ALERT_THRESHOLD = 3;
/** Ventana (días) para contar la acumulación Y para el dedupe semanal. */
export const PATTERN_WINDOW_DAYS = 7;
export const PATTERN_WINDOW_MS = PATTERN_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Categorías de menor severidad que NO alertan de inmediato pero SÍ por patrón.
 * Se guardan tal cual en SafetyEvent.category desde la capa regex (safety.ts):
 * la fuente confiable y dominante del conteo. Un evento de "riesgo" detectado
 * SOLO por la Moderation API se registra bajo su topCategory cruda (caso raro,
 * documentado en el chat route) y por eso NO se agrupa acá: es un sub-conteo
 * conservador, consistente con el espíritu anti-fatiga (erramos hacia NO alertar).
 */
export const PATTERN_CATEGORIES = ["riesgo", "alimentario"] as const;
export type PatternCategory = (typeof PATTERN_CATEGORIES)[number];

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
      //
      // AISLAMIENTO CRISIS ↔ PATRÓN: la alerta de patrón (maybePatternAlert)
      // también marca `notifiedAt`, pero SIEMPRE sobre eventos de categoría
      // riesgo/alimentario. Una crisis JAMÁS puede quedar silenciada porque una
      // alerta de patrón marcó un evento reciente, así que el dedupe de crisis
      // ignora esas categorías. Es seguro: los eventos crisis/abuso nunca llevan
      // category "riesgo"/"alimentario" (regex → "crisis"/"abuso"; moderación →
      // topCategory cruda como "self-harm"/"sexual/minors"), así que este filtro
      // nunca excluye un evento de crisis genuino.
      prisma.safetyEvent.findFirst({
        where: {
          userId: childUserId,
          notifiedAt: { gt: new Date(now.getTime() - ALERT_DEDUPE_WINDOW_MS) },
          category: { notIn: PATTERN_CATEGORIES as unknown as string[] },
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
    if (!sent) {
      // Ciclo 15 L2b/L2c: el envío falló tras los reintentos internos de
      // deliverEmail. Ruta de SEGURIDAD crítica → (c) log nivel error accionable y
      // (b) registro PERSISTENTE del fallo (alertFailedAt) para reintentarlo luego
      // (cron retryFailedCrisisAlerts). Solo se puede anclar si hay evento (L1).
      console.error(
        `[alerts] FALLO al enviar la alerta de crisis al tutor/a del menor ${childUserId} ` +
          `(categoría "${category}") tras los reintentos; queda PENDIENTE de reintento.`,
      );
      if (safetyEventId) {
        await prisma.safetyEvent
          .update({ where: { id: safetyEventId }, data: { alertFailedAt: now } })
          .catch((e) =>
            console.error("[alerts] además, no se pudo persistir alertFailedAt:", e),
          );
      }
      return false;
    }

    // Solo si el envío salió bien y hay evento que anclar: notifiedAt = now
    // (base del dedupe) y se LIMPIA alertFailedAt (por si este evento venía de un
    // fallo previo que el cron está reintentando: al enviarse deja de estar
    // pendiente). Sin eventId (L1) no se ancla; se acepta la ventana.
    //
    // L4: entre la query de dedupe (findFirst por notifiedAt) y este update hay
    // una carrera teórica (dos crisis casi simultáneas podrían mandar dos
    // emails). Se acepta: la ventana es mínima, el costo de un email duplicado
    // es bajo, y evitar la carrera exigiría un lock/constraint que no se
    // justifica hoy frente al riesgo de callar una alerta.
    if (safetyEventId) {
      await prisma.safetyEvent.update({
        where: { id: safetyEventId },
        data: { notifiedAt: now, alertFailedAt: null },
      });
    }
    return true;
  } catch (err) {
    console.error("[alerts] error alertando al tutor/a:", err);
    return false;
  }
}

/**
 * Categoría de patrón → lenguaje humano, cuidadoso y no alarmista, para el email.
 * Nunca incluye el contenido del mensaje del menor.
 */
export function humanPatternCategory(category: PatternCategory): string {
  if (category === "alimentario") {
    return "preocupaciones repetidas con la comida o el cuerpo";
  }
  return "momentos de angustia o malestar que se vienen repitiendo";
}

/**
 * Decide si corresponde una alerta de PATRÓN. Función pura: sin efectos, sin DB
 * (testeable en scripts/alerts-suite.ts).
 *
 * - Mismas puertas de autorización que `shouldAlert` (menor + consentimiento +
 *   alertas activas).
 * - `recentCount` = eventos de la categoría dentro de PATTERN_WINDOW_DAYS (lo
 *   computa el caller vía query indexada). Dispara solo con ≥ umbral.
 * - Dedupe semanal: si ya se mandó un email de patrón (marca en `notifiedAt` de
 *   un evento de la categoría) dentro de la ventana, no se reenvía.
 */
export function shouldPatternAlert({
  role,
  guardian,
  recentCount,
  lastPatternNotifiedAt,
  now,
}: {
  role: string | null | undefined;
  guardian: AlertGuardian;
  recentCount: number;
  lastPatternNotifiedAt: Date | null;
  now: Date;
}): boolean {
  if (role !== "child") return false;
  if (!guardian) return false;
  if (!guardian.consentAt) return false;
  if (!guardian.alertsEnabled) return false;
  if (recentCount < PATTERN_ALERT_THRESHOLD) return false;
  // Dedupe semanal por child+categoría (el caller ya scopeó la query a la
  // categoría): máx 1 email de patrón por ventana.
  if (
    lastPatternNotifiedAt &&
    now.getTime() - lastPatternNotifiedAt.getTime() < PATTERN_WINDOW_MS
  ) {
    return false;
  }
  return true;
}

/**
 * Alerta de patrón por acumulación de riesgo/alimentario. Se invoca (diferida,
 * vía after() del chat) al registrar un SafetyEvent de esa categoría.
 *
 * Cuenta eventos de la MISMA categoría del mismo menor en la ventana; si llega
 * al umbral y no hubo alerta de patrón esta semana, manda UN email cuidadoso al
 * tutor/a (sin contenido del menor) y ancla el dedupe marcando `notifiedAt` en
 * el evento más reciente de la categoría.
 *
 * Nunca lanza: cualquier fallo se loguea y devuelve `false`. La respuesta al
 * menor no depende de esto.
 *
 * CARRERA (misma que documenta maybeAlertGuardian, L4): entre la query de dedupe
 * y el `update` del ancla hay una ventana teórica en la que dos chequeos casi
 * simultáneos podrían mandar dos emails de patrón. Se acepta: la ventana es
 * mínima, el costo de un email extra es bajo, y evitarlo exigiría un lock/
 * constraint que no se justifica frente al valor de la señal.
 */
export async function maybePatternAlert(
  childUserId: string,
  category: PatternCategory,
): Promise<boolean> {
  try {
    const now = new Date();
    const windowStart = new Date(now.getTime() - PATTERN_WINDOW_MS);

    const [child, recentCount, lastPatternNotified] = await Promise.all([
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
      // Conteo de la acumulación: eventos de ESTA categoría en la ventana.
      // Usa el índice [userId, createdAt]; el filtro por category se aplica encima.
      prisma.safetyEvent.count({
        where: {
          userId: childUserId,
          category,
          createdAt: { gte: windowStart },
        },
      }),
      // Dedupe semanal: ¿hay un evento de esta categoría ya notificado (email de
      // patrón) dentro de la ventana?
      prisma.safetyEvent.findFirst({
        where: {
          userId: childUserId,
          category,
          notifiedAt: { gt: windowStart },
        },
        select: { notifiedAt: true },
        orderBy: { notifiedAt: "desc" },
      }),
    ]);

    if (!child) return false;
    if (
      !shouldPatternAlert({
        role: child.role,
        guardian: child.guardedBy,
        recentCount,
        lastPatternNotifiedAt: lastPatternNotified?.notifiedAt ?? null,
        now,
      })
    ) {
      return false;
    }

    const guardianEmail = child.guardedBy?.guardianUser.email;
    if (!guardianEmail) return false;

    const sent = await deliverPatternAlert(guardianEmail, {
      childName: child.name,
      signal: humanPatternCategory(category),
    });
    if (!sent) return false;

    // Ancla del dedupe: marca notifiedAt en el evento MÁS RECIENTE de la
    // categoría en la ventana (el que gatilló este chequeo). Solo eventos
    // riesgo/alimentario reciben esta marca, así que el dedupe de crisis (que
    // los ignora) nunca se ve afectado.
    const anchor = await prisma.safetyEvent.findFirst({
      where: { userId: childUserId, category, createdAt: { gte: windowStart } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (anchor) {
      await prisma.safetyEvent.update({
        where: { id: anchor.id },
        data: { notifiedAt: now },
      });
    }
    return true;
  } catch (err) {
    console.error("[alerts] error en la alerta de patrón:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// REINTENTO DE ALERTAS DE CRISIS FALLIDAS (ciclo 15 L2b).
//
// Si una alerta de crisis falla en su envío (tras los reintentos internos de
// deliverEmail), maybeAlertGuardian marca `alertFailedAt` en el SafetyEvent. El
// cron de purga (traffic-independent) reintenta esos pendientes: es la garantía
// de que el tutor/a se entere de una crisis AUNQUE el menor no vuelva a chatear
// (por eso el cron y no solo el próximo maybeAlertGuardian del mismo menor).
//
// VENTANA: solo se reintentan fallos recientes (FAILED_ALERT_RETRY_WINDOW_DAYS).
// Los reintentos inmediatos + el cron diario dan varias chances dentro de la
// ventana; pasada, se deja de insistir (un aviso de crisis muy tardío ya perdió
// valor y probablemente fue superado por una interacción posterior). El `gte`
// contra el corte excluye de por sí los `alertFailedAt` null. La purga por TTL
// NO borra SafetyEvent (solo el cascade al eliminar al menor), así que el
// pendiente sobrevive hasta reintentarse o caer fuera de la ventana.
// ---------------------------------------------------------------------------

/** Ventana de reintento de alertas de crisis fallidas (días). */
export const FAILED_ALERT_RETRY_WINDOW_DAYS = 7;
export const FAILED_ALERT_RETRY_WINDOW_MS =
  FAILED_ALERT_RETRY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
/** Tope de pendientes a reintentar por corrida (acota el trabajo del cron). */
export const FAILED_ALERT_RETRY_BATCH = 50;

/** Corte: solo se reintentan fallos con alertFailedAt ≥ este instante. */
export function failedAlertRetryCutoff(now: Date): Date {
  return new Date(now.getTime() - FAILED_ALERT_RETRY_WINDOW_MS);
}

/** SafetyEvent pendiente de reintento (proyección mínima para re-alertar). */
export type PendingFailedAlert = { id: string; userId: string; category: string };

/**
 * Dependencias inyectables de retryFailedCrisisAlerts (patrón de retention.ts:
 * orquestación testeable sin DB). Por defecto usan prisma + maybeAlertGuardian.
 */
export interface RetryFailedAlertsDeps {
  /** Trae los SafetyEvent con envío pendiente (alertFailedAt en ventana, sin notificar). */
  findPending: () => Promise<PendingFailedAlert[]>;
  /** Reintenta el aviso (por defecto maybeAlertGuardian). Devuelve true si se envió. */
  alert: (userId: string, safetyEventId: string, category: string) => Promise<boolean>;
}

async function defaultFindPending(now: Date): Promise<PendingFailedAlert[]> {
  return prisma.safetyEvent.findMany({
    where: {
      notifiedAt: null,
      alertFailedAt: { gte: failedAlertRetryCutoff(now) },
    },
    orderBy: { alertFailedAt: "asc" }, // los más viejos primero
    take: FAILED_ALERT_RETRY_BATCH,
    select: { id: true, userId: true, category: true },
  });
}

/**
 * Reintenta las alertas de crisis que quedaron pendientes por un fallo de envío.
 * Para cada pendiente vuelve a llamar a maybeAlertGuardian (que re-verifica
 * consentimiento/dedupe, reenvía y, al lograrlo, marca notifiedAt + limpia
 * alertFailedAt). Best-effort: nunca lanza; cualquier fallo se loguea y se sigue.
 *
 * Devuelve cuántos se intentaron y cuántos se recuperaron (enviaron con éxito).
 */
export async function retryFailedCrisisAlerts(
  deps?: Partial<RetryFailedAlertsDeps>,
  now: Date = new Date(),
): Promise<{ retried: number; recovered: number }> {
  const findPending = deps?.findPending ?? (() => defaultFindPending(now));
  const alert = deps?.alert ?? maybeAlertGuardian;
  try {
    const pending = await findPending();
    let recovered = 0;
    for (const ev of pending) {
      // maybeAlertGuardian nunca lanza; si falla de nuevo, re-marca alertFailedAt
      // (sigue pendiente para la próxima corrida, salvo que caiga fuera de ventana).
      if (await alert(ev.userId, ev.id, ev.category)) recovered += 1;
    }
    if (pending.length > 0) {
      console.log(
        `[alerts] reintento de alertas de crisis fallidas: ${recovered}/${pending.length} recuperadas`,
      );
    }
    return { retried: pending.length, recovered };
  } catch (err) {
    console.error("[alerts] error reintentando alertas de crisis fallidas:", err);
    return { retried: 0, recovered: 0 };
  }
}
