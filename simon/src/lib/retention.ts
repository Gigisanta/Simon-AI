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

/**
 * Message/Conversation/SafetyEvent (usuario activo): SIN TTL, por diseño.
 * A diferencia de InteractionLog/UserMemory, estos datos son el historial
 * terapéutico/de seguridad del menor — su valor para el tutor/a (ver
 * conversaciones pasadas, exportar, revisar eventos de seguridad) y para la
 * continuidad del chat (contexto de conversación) no decae con el tiempo como
 * la telemetría. Se purgan SOLO como efecto del cascade de `User` en dos
 * caminos: (a) el tutor/a borra la cuenta del menor (derecho de supresión,
 * ver guardian/children/[childId]/route.ts DELETE) o (b) el barrido de
 * menores huérfanos de más abajo. Mientras la cuenta exista y tenga tutor/a,
 * no hay minimización temporal de esta data — decisión de producto, no un
 * TTL pendiente de implementar.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { memoryTtlCutoff } from "@/lib/ai/memory";

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
 * Menores huérfanos — período de gracia antes de purgarlos: 30 días.
 *
 * MOTIVO (privacidad — Ley 25.326, supresión de datos de menores): un menor es
 * una fila `User` con role "child" cuya tutela vive en `Guardian`. Si se borra
 * la cuenta del tutor/a, el cascade de Guardian (schema: onDelete Cascade en
 * guardianUser) elimina el vínculo, pero la fila del menor y TODA su data
 * (Conversation/Message/UserMemory/SafetyEvent/InteractionLog) quedaban
 * huérfanas para siempre — sin ninguna ruta de borrado. Este barrido las purga.
 */
export const ORPHAN_CHILD_GRACE_DAYS = 30;

/**
 * Corte temporal del período de gracia para menores huérfanos.
 *
 * ANCLA = `User.updatedAt`. No existe un timestamp del MOMENTO de orfandad: el
 * cascade borra la fila Guardian sin tocar la fila del menor, así que no hay un
 * "orphanedAt" que consultar, y agregarlo exigiría denormalizar/backfillear una
 * columna nueva (fuera de alcance, y contra la minimización). Entre los campos
 * existentes, `updatedAt` (@updatedAt) es la mejor señal de "última vez tocado":
 * es CONSERVADOR — un menor cuya fila se modificó hace poco queda a salvo, y solo
 * se purga la data que ya lleva ≥30d sin cambios. Erramos hacia NO borrar.
 */
export function orphanChildCutoff(now: Date): Date {
  return new Date(now.getTime() - ORPHAN_CHILD_GRACE_DAYS * DAY_MS);
}

/**
 * Criterio (puro) del barrido de menores huérfanos, como `where` de Prisma:
 * filas `User` con role "child", SIN vínculo de tutela (`guardedBy` null) y con
 * `updatedAt` anterior al corte de gracia. El borrado se hace con
 * `user.deleteMany`, y el cascade de las relaciones de User (verificado en
 * schema: Conversation/Message/UserMemory/SafetyEvent/InteractionLog/Session/
 * Account/Guardian, todas onDelete Cascade) arrastra el resto de la data.
 */
export function orphanChildWhere(now: Date): Prisma.UserWhereInput {
  return {
    role: "child",
    guardedBy: { is: null },
    updatedAt: { lt: orphanChildCutoff(now) },
  };
}

/** Subconjunto de PrismaClient que necesita la purga — inyectable para testear. */
export type RetentionPurgeClient = Pick<
  PrismaClient,
  "userMemory" | "interactionLog" | "session" | "user"
>;

export interface PurgeCounts {
  userMemory: number;
  interactionLog: number;
  sessions: number;
  orphanChildren: number;
}

/**
 * Purga TTL + barrido de menores huérfanos. Función con el cliente INYECTADO
 * (route pasa `prisma`; los tests pasan un fake) para que la orquestación tenga
 * cobertura determinística sin DB.
 *
 * ORDEN (evita deadlocks): las tres purgas por TTL tocan tablas DISJUNTAS
 * (UserMemory / InteractionLog / Session) → seguras en paralelo. El borrado de
 * menores huérfanos, en cambio, hace CASCADE sobre esas MISMAS tablas
 * (UserMemory/InteractionLog/Session del menor), así que correrlo concurrente
 * con el batch anterior podría competir por locks de fila. Se corre DESPUÉS, en
 * secuencia. El resultado es idempotente en cualquier orden; la secuencia solo
 * evita contención de locks.
 */
export async function purgeExpiredData(
  client: RetentionPurgeClient,
  now: Date,
): Promise<PurgeCounts> {
  const [userMemory, interactionLog, sessions] = await Promise.all([
    client.userMemory.deleteMany({
      where: { updatedAt: { lt: memoryTtlCutoff(now) } },
    }),
    client.interactionLog.deleteMany({
      where: { createdAt: { lt: interactionLogTtlCutoff(now) } },
    }),
    client.session.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
  ]);

  const orphanChildren = await client.user.deleteMany({
    where: orphanChildWhere(now),
  });

  return {
    userMemory: userMemory.count,
    interactionLog: interactionLog.count,
    sessions: sessions.count,
    orphanChildren: orphanChildren.count,
  };
}

/**
 * Nombre del advisory lock de Postgres que serializa el cron de purga. Se pasa a
 * `hashtext(...)` en la ruta para derivar el bigint del `pg_try_advisory_xact_lock`.
 * Constante compartida entre la ruta y el test (mismo nombre = mismo lock).
 */
export const PURGE_LOCK_NAME = "simon:cron:purge";

export type PurgeUnderLockResult =
  | { skipped: true }
  | { skipped: false; deleted: PurgeCounts };

/**
 * Orquesta la purga bajo un advisory lock para evitar corridas CONCURRENTES del
 * cron (dos invocaciones solapadas compitiendo por locks de fila / duplicando el
 * barrido). Determinística y SIN DB directa: las dos operaciones con efecto se
 * inyectan, de modo que la decisión (correr vs saltar) se testea con mocks.
 *
 *   - `tryLock()`  → intenta tomar el lock (pg_try_advisory_xact_lock, no bloquea).
 *   - `purge()`    → la purga real (purgeExpiredData) — solo se llama si se tomó.
 *
 * Si NO se adquiere el lock (otra corrida lo tiene) → `{ skipped: true }`, sin
 * tocar ninguna tabla. Si se adquiere → corre la purga y devuelve los counts.
 *
 * NOTA de liberación: el caller usa `pg_try_advisory_xact_lock` DENTRO de una
 * transacción interactiva; el lock se libera SOLO al terminar la transacción
 * (commit/rollback), en la MISMA conexión — así el adapter de Neon (que puede
 * rotar de conexión entre queries sueltas) no deja el lock colgado. Por eso acá
 * no hay `unlock`: es responsabilidad del `COMMIT` de la transacción.
 */
export async function purgeUnderLock(deps: {
  tryLock: () => Promise<boolean>;
  purge: () => Promise<PurgeCounts>;
}): Promise<PurgeUnderLockResult> {
  const acquired = await deps.tryLock();
  if (!acquired) return { skipped: true };
  const deleted = await deps.purge();
  return { skipped: false, deleted };
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
