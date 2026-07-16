-- ADR-6 (enmienda): rate limiting compartido vía Postgres cuando no hay
-- Upstash. Tabla del storage "database" de better-auth: una fila por clave
-- (ip/path); el consumo es un UPDATE atómico condicional (incrementOne).
-- CreateTable
CREATE TABLE "rateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "rateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rateLimit_key_key" ON "rateLimit"("key");

-- CreateIndex (poda de better-auth: deleteMany lastRequest < corte)
CREATE INDEX "rateLimit_lastRequest_idx" ON "rateLimit"("lastRequest");
