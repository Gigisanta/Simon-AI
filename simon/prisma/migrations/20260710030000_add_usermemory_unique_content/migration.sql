-- Unique de idempotencia sobre UserMemory (userId, kind, content). Cierra la
-- race de summarizeStaleConversation (lib/ai/memory.ts): dos invocaciones
-- concurrentes marcan `summarizedAt` recién al final, así que ambas extraen los
-- mismos hechos y —sin unique— los insertaban dos veces. Con este índice +
-- `skipDuplicates` en el createMany, la segunda inserción es un no-op.
--
-- ADITIVA y segura sobre datos existentes:
--   1) DEDUPE previo: como hasta ahora NO había unique, pueden existir filas
--      duplicadas (userId, kind, content). Se borran antes de crear el índice,
--      conservando UNA fila por grupo (la de menor ctid). Sin este paso el
--      CREATE UNIQUE INDEX fallaría sobre una tabla con duplicados.
--   2) CREATE UNIQUE INDEX con el nombre EXACTO que genera Prisma (verificado
--      con `prisma migrate diff --from-schema <prev> --to-schema <actual>
--      --script`): UserMemory_userId_kind_content_key.
--
-- `content` está acotado en el parseo (MAX_FACT_CHARS en memory.ts: hecho
-- atómico y corto) para no exceder el límite de fila del índice btree de
-- Postgres (~2704 bytes); por eso el unique va directo sobre el texto sin
-- necesidad de una columna hash.

-- Dedupe de duplicados preexistentes (conserva la fila de menor ctid por grupo).
DELETE FROM "UserMemory" a
USING "UserMemory" b
WHERE a."userId" = b."userId"
  AND a."kind" = b."kind"
  AND a."content" = b."content"
  AND a."ctid" > b."ctid";

-- CreateIndex
CREATE UNIQUE INDEX "UserMemory_userId_kind_content_key" ON "UserMemory"("userId", "kind", "content");
