-- Índice compuesto para el barrido de menores huérfanos (lib/retention.ts →
-- orphanChildWhere / purgeExpiredData): user.deleteMany por { role="child",
-- guardedBy null, updatedAt < corte de gracia 30d }. Sin este índice el barrido
-- es un full-table-scan de `user`. Cubre equality (role) + range (updatedAt); el
-- filtro por tutela (`guardedBy`) es una relación, no columna, y no indexa.
-- SQL verificado con `prisma migrate diff` (schema-to-schema, sin tocar la DB):
-- coincide exactamente con lo que Prisma generaría. Índices previos intactos.

-- CreateIndex
CREATE INDEX "user_role_updatedAt_idx" ON "user"("role", "updatedAt");
