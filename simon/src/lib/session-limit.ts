/**
 * Límite de sesión server-side (M-S7, docs/research-safety.md §2.1):
 * máximo 45 minutos de uso continuo, con aviso suave a los 30.
 *
 * Una "sesión de chat" son mensajes contiguos con gaps < 30 min, contados
 * sobre TODAS las conversaciones del usuario (el límite es por uso, no por
 * hilo). La duración es now - inicio de la racha actual. Lógica pura —
 * testeada en scripts/memory-suite.ts; route.ts aporta los timestamps.
 */

export const SESSION_GAP_MS = 30 * 60_000; // gap >= 30 min corta la racha
export const SESSION_WARN_MS = 30 * 60_000; // >= 30 min → avisar pausa
export const SESSION_OVER_MS = 45 * 60_000; // >= 45 min → cerrar la sesión

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
