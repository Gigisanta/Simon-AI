/**
 * Límite de sesión server-side (M-S7, docs/research-safety.md §2.1):
 * máximo 45 minutos de uso continuo, con aviso suave a los 30.
 *
 * Una "sesión de chat" son mensajes contiguos con gaps < 30 min, contados
 * sobre TODAS las conversaciones del usuario (el límite es por uso, no por
 * hilo). La duración es now - inicio de la racha actual. Lógica pura —
 * testeada en scripts/memory-suite.ts; route.ts aporta los timestamps.
 */

import type { Prisma } from "@/generated/prisma/client";

export const SESSION_GAP_MS = 30 * 60_000; // gap >= 30 min corta la racha
export const SESSION_WARN_MS = 30 * 60_000; // >= 30 min → avisar pausa
export const SESSION_OVER_MS = 45 * 60_000; // >= 45 min → cerrar la sesión

/**
 * Ventana de la marca atómica que evita el doble aviso de pausa entre pestañas
 * (claimOnce). Igual a la duración de la fase "warn" (30→45 min): una vez dado el
 * aviso, ninguna otra pestaña lo repite mientras la sesión siga en "warn"; a los
 * 45 min pasa a "over" (ya no hay warn) y una sesión nueva exige un gap ≥30 min,
 * así que para entonces la marca ya venció y el aviso puede volver a darse.
 */
export const SESSION_WARN_DEDUP_TTL_MS = SESSION_OVER_MS - SESSION_WARN_MS;

/**
 * B3.2: el límite de sesión (aviso a los 30 min, cierre a los 45) aplica SOLO a
 * los menores (role "child"). Los tutores/as (guardians) son adultos: sin warn
 * ni cierre por tiempo. El recordatorio periódico de IA (shouldAppendDisclosure)
 * NO depende de esto y se mantiene para ambos roles. Función pura — testeada.
 */
export function sessionLimitApplies(role: string | null | undefined): boolean {
  return role === "child";
}

/**
 * M-F1 (disclosure de IA en el primer mensaje de la sesión): ¿este mensaje abre
 * una sesión nueva? Lo es cuando NO hubo respuesta del asistente dentro de la
 * última ventana de gap (SESSION_GAP_MS): un silencio ≥30 min abre una sesión
 * nueva, con el mismo criterio de corte de racha que `sessionState`.
 * `assistantTimestamps` son los createdAt de los mensajes assistant recientes
 * del usuario. Función pura — testeada en scripts/memory-suite.ts.
 */
export function isFirstOfSession(assistantTimestamps: Date[], now: Date): boolean {
  const nowMs = now.getTime();
  return !assistantTimestamps.some((t) => {
    const ms = t.getTime();
    return Number.isFinite(ms) && ms <= nowMs && nowMs - ms < SESSION_GAP_MS;
  });
}

/**
 * M-S7: construcción de la ventana de sesión como valor puro (sin DB), para que
 * la regresión del bug real (`take:60`, que truncaba ráfagas y dejaba eludir el
 * corte de 45 min) tenga cobertura de test. route.ts pasa este objeto tal cual a
 * `prisma.message.findMany`. Invariantes que el test fija:
 *   - `where.createdAt.gte === now - (SESSION_OVER_MS + SESSION_GAP_MS)` (75 min):
 *     cota que garantiza traer TODA la racha necesaria para detectar "over".
 *   - SIN `take`/limit: la cota temporal ya acota el resultado; reintroducir un
 *     `take` volvería a permitir el bypass y rompe el test.
 *   - filtra por `conversation.userId` (sesión cross-conversation, por uso).
 */
export function sessionWindowQuery(
  userId: string,
  now: Date,
) {
  return {
    where: {
      conversation: { userId },
      createdAt: {
        gte: new Date(now.getTime() - (SESSION_OVER_MS + SESSION_GAP_MS)),
      },
    },
    orderBy: { createdAt: "desc" as const },
    select: { createdAt: true, role: true, safetyFlag: true },
  } satisfies Prisma.MessageFindManyArgs;
}

export function sessionState(
  messageTimestamps: Date[],
  now: Date,
): "ok" | "warn" | "over" {
  const nowMs = now.getTime();
  const times = messageTimestamps
    .map((t) => t.getTime())
    .filter((t) => Number.isFinite(t) && t <= nowMs)
    .sort((a, b) => b - a); // descendente: del más nuevo al más viejo

  // Racha actual: desde `now` hacia atrás mientras los gaps sean < 30 min.
  let streakStart = nowMs;
  for (const t of times) {
    if (streakStart - t >= SESSION_GAP_MS) break; // gap grande = otra sesión
    streakStart = t;
  }
  const duration = nowMs - streakStart;
  if (duration >= SESSION_OVER_MS) return "over";
  if (duration >= SESSION_WARN_MS) return "warn";
  return "ok";
}

/**
 * Cierre amable al superar los 45 min (no es un error: sale como respuesta
 * normal del asistente, persistida con safetyFlag "session-limit").
 */
export const SESSION_LIMIT_REPLY =
  "Llevamos un buen rato charlando y me encanta, pero ya pasaron 45 minutos y es un buen momento para hacer una pausa. Movete un poco, tomá agua, o contale a alguien de tu casa algo de lo que hablamos. Yo quedo acá para cuando vuelvas, más tarde o mañana. 💙";

/**
 * Aviso suave a los 30 min: se anexa UNA sola vez al final de una respuesta
 * normal (persistida con safetyFlag "session-warn"; su existencia entre los
 * mensajes recientes marca que el aviso ya fue dado).
 */
export const SESSION_WARN_APPENDIX =
  "\n\nChe, ya llevamos media hora charlando. Cuando termines esta idea, te propongo una pausa: estirar las piernas, tomar algo, mirar por la ventana. Después seguimos si querés.";
