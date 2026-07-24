-- Retrieval semántico con pgvector — DETRÁS de flag (lib/ai/retrieval-vector.ts).
--
-- ESTADO: NO aplicada a ninguna base (ni dev ni prod). Es el andamiaje de datos
-- para el retrieval semántico que hoy vive apagado (RETRIEVAL_PGVECTOR distinto
-- de "1"). El chat sigue usando el retrieval LÉXICO actual (system-prompt.ts)
-- hasta que se seedeen embeddings y se prenda el flag.
--
-- QUÉ HACE (aditiva y segura sobre datos existentes — solo CREATE, sin
-- ALTER/DROP/DELETE/UPDATE de tablas del producto):
--   1) Habilita la extensión pgvector (idempotente).
--   2) Crea la tabla `Embedding`: un embedding por (ownerType, ownerId, model).
--      Polimórfica para cubrir FICHAS ('card' → KnowledgeCard.id) y MEMORIAS
--      ('memory' → UserMemory.id) con la misma tabla.
--   3) Índice ANN (HNSW o IVFFlat) — COMENTADO: elegir uno al activar el flag.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DIMENSIÓN CONFIGURABLE (default 1536)
-- pgvector exige una dimensión FIJA y literal en el tipo `vector(N)`. El default
-- 1536 corresponde a text-embedding-3-small (OpenAI) y a la familia MiMo. Debe
-- COINCIDIR con `RETRIEVAL_EMBED_DIM` (retrieval-vector.ts, default 1536). Si se
-- usa otro modelo/dimensión, cambiar el `1536` de abajo ANTES de aplicar (p.ej.
-- 3072 para text-embedding-3-large, 768 para varios modelos open) y setear
-- `RETRIEVAL_EMBED_DIM` al mismo valor.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- APLICAR MANUALMENTE (elegir UNO; nunca se aplica sola ni en el build):
--   a) psql directo (recomendado para control fino):
--        psql "$DATABASE_URL" -f prisma/migrations/20260724000000_pgvector_embeddings/migration.sql
--   b) Prisma (marca la migración como aplicada en _prisma_migrations):
--        cd simon && pnpm prisma migrate deploy
--      (deploy aplica TODAS las migraciones pendientes; usar solo si esta es la
--       única pendiente, o preferir la opción (a) para aislarla).
--   Nota: pgvector debe estar disponible en el servidor. En Neon:
--        CREATE EXTENSION IF NOT EXISTS vector;  (ya incluido abajo).
--
-- ROLLBACK MANUAL:
--   DROP TABLE IF EXISTS "Embedding";
--   -- Opcional (solo si NADA más usa la extensión en esta base):
--   -- DROP EXTENSION IF EXISTS vector;
--   -- Si se aplicó con Prisma (opción b), además:
--   --   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260724000000_pgvector_embeddings';

-- 1) Extensión pgvector (idempotente).
CREATE EXTENSION IF NOT EXISTS vector;

-- 2) Tabla de embeddings (fichas + memorias). ownerType/ownerId apuntan a la
-- fila embebida (sin FK para no acoplar el borrado; la limpieza de huérfanos es
-- por barrido). `model` guarda con qué modelo se generó el vector (permite
-- reindexar al cambiar de modelo sin pisar los viejos). El unique
-- (ownerType, ownerId, model) hace el upsert de reindexado idempotente.
CREATE TABLE IF NOT EXISTS "Embedding" (
  "id"        TEXT NOT NULL,
  "ownerType" TEXT NOT NULL,          -- 'card' | 'memory'
  "ownerId"   TEXT NOT NULL,          -- KnowledgeCard.id | UserMemory.id
  "model"     TEXT NOT NULL,          -- id del modelo de embeddings (trazabilidad)
  "embedding" vector(1536) NOT NULL,  -- ⚠ dimensión configurable (ver cabecera)
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- Upsert idempotente de reindexado: un embedding por (owner, modelo).
CREATE UNIQUE INDEX IF NOT EXISTS "Embedding_ownerType_ownerId_model_key"
  ON "Embedding" ("ownerType", "ownerId", "model");

-- Lookup por lote de fichas/memorias (retrieval-vector lee por ownerType+ownerId).
CREATE INDEX IF NOT EXISTS "Embedding_ownerType_ownerId_idx"
  ON "Embedding" ("ownerType", "ownerId");

-- 3) Índice ANN para búsqueda por similaridad coseno — COMENTADO. Elegir UNO al
-- activar el flag. Con el corpus de fichas chico (< ~200) el ranking se hace en
-- JS leyendo todos los vectores, así que el índice recién importa cuando la
-- búsqueda pase a ser DB-side o cuando crezcan las MEMORIAS. Operador `<=>` =
-- distancia coseno (usar vector_cosine_ops).
--
-- HNSW (mejor recall/latencia, más memoria y build más lento) — recomendado:
--   CREATE INDEX "Embedding_embedding_hnsw_cosine_idx"
--     ON "Embedding" USING hnsw ("embedding" vector_cosine_ops);
--
-- IVFFlat (menos memoria; requiere datos cargados + ANALYZE y tuning de `lists`
-- ~= sqrt(filas)):
--   CREATE INDEX "Embedding_embedding_ivfflat_cosine_idx"
--     ON "Embedding" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);
