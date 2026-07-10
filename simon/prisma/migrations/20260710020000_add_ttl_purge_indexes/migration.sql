-- Índices para la purga TTL (lib/retention.ts → purgeExpiredData). Sin ellos
-- cada deleteMany del cron es un full-table-scan:
--   * session.expiresAt        → sesiones expiradas
--   * UserMemory.updatedAt      → corte 90d (memoryTtlCutoff)
--   * InteractionLog.createdAt  → corte 180d (interactionLogTtlCutoff)
-- SQL verificado con `prisma migrate diff` (schema-to-schema, sin tocar la DB):
-- coincide exactamente con lo que Prisma generaría. Se conservan los índices
-- previos de cada tabla.

-- CreateIndex
CREATE INDEX "session_expiresAt_idx" ON "session"("expiresAt");

-- CreateIndex
CREATE INDEX "UserMemory_updatedAt_idx" ON "UserMemory"("updatedAt");

-- CreateIndex
CREATE INDEX "InteractionLog_createdAt_idx" ON "InteractionLog"("createdAt");
