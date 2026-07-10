/**
 * Retención / minimización de datos (Ley 25.326 — datos de menores).
 *
 * Fuente ÚNICA de las constantes/helpers de TTL que comparten:
 *   - el query-path del chat (purga lazy, `after()` en /api/chat) y
 *   - el cron de purga independiente del tráfico (/api/cron/purge).
 * Así un usuario inactivo (que nunca vuelve a chatear) igual ve purgados sus
 * datos vencidos por el cron, usando EXACTAMENTE los mismos cortes temporales
 * que el path lazy — cero duplicación de constantes.
 *
 * El TTL de UserMemory (90d) vive en `ai/memory.ts` (memoryTtlCutoff); acá vive
 * el de InteractionLog (telemetría, 180d). El cron importa ambos.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Retención de InteractionLog (telemetría): 180 días. Minimización — la
 * telemetría se conserva solo lo necesario para observabilidad + dataset de
 * fine-tuning, y luego se purga.
 */
export const INTERACTION_LOG_TTL_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Corte temporal para InteractionLog: filas con createdAt < corte están vencidas. */
export function interactionLogTtlCutoff(now: Date): Date {
  return new Date(now.getTime() - INTERACTION_LOG_TTL_DAYS * DAY_MS);
}

/**
 * Autorización del cron de purga (Vercel Cron manda `Authorization: Bearer
 * <CRON_SECRET>`). Función PURA y testeable.
 *
 * Reglas (fail-closed):
 *   - secret ausente/vacío → false (SIEMPRE; el caller responde 503, nunca abierto).
 *   - header ausente/sin prefijo "Bearer "/token vacío → false.
 *   - comparación TIMING-SAFE: se comparan los digests SHA-256 (largo fijo 32B)
 *     del token provisto y del secreto. Usar el digest evita (a) el throw de
 *     `timingSafeEqual` ante largos distintos y (b) filtrar el largo del token
 *     por diferencia de tiempo/rechazo temprano.
 */
export function isAuthorizedCron(
  authHeader: string | null | undefined,
  secret: string | undefined | null,
): boolean {
  if (!secret) return false;
  if (!authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  const provided = authHeader.slice(prefix.length);
  if (!provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}
