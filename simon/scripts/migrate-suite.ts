/**
 * Suite del hardening de build/migraciones y del export paralelo:
 *
 *   pnpm migrate-suite
 *
 * Cubre los tres fixes de este set (todos camino crítico — migraciones sobre la
 * DB de menores + endpoint de portabilidad de datos):
 *   1. migrationDecision (scripts/migrate-if-production): matriz de entornos —
 *      solo migra en producción real o con override explícito; salta el resto.
 *   2. buildExportedConversations (lib/export-conversations): el path paralelo
 *      preserva el ORDEN y la estructura idénticos al loop secuencial anterior.
 *   3. Los tres índices de purga TTL existen (schema.prisma + migración SQL):
 *      session.expiresAt, UserMemory.updatedAt, InteractionLog.createdAt.
 *
 * Solo lógica pura + parseo de archivos (sin red, sin DB). Sale con código 1 si
 * algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrationDecision } from "./migrate-if-production";
import {
  buildExportedConversations,
  type ConversationMeta,
  type ExportedMessage,
} from "../src/lib/export-conversations";

const { check, done } = createChecker("Migrate suite");

const here = dirname(fileURLToPath(import.meta.url));

async function main() {
  // ---------- 1. migrationDecision: matriz de entornos ----------
  {
    // Producción real → migra.
    const prod = migrationDecision({ VERCEL_ENV: "production" });
    check(prod.migrate === true, "VERCEL_ENV=production → migra");

    // Preview / development / sin VERCEL_ENV → NO migra (fail-closed).
    check(
      migrationDecision({ VERCEL_ENV: "preview" }).migrate === false,
      "VERCEL_ENV=preview → NO migra",
    );
    check(
      migrationDecision({ VERCEL_ENV: "development" }).migrate === false,
      "VERCEL_ENV=development → NO migra",
    );
    check(
      migrationDecision({}).migrate === false,
      "sin VERCEL_ENV → NO migra",
    );

    // Override explícito → migra en CUALQUIER entorno (incluso preview / vacío).
    check(
      migrationDecision({ ALLOW_MIGRATE: "1" }).migrate === true,
      "ALLOW_MIGRATE=1 (sin VERCEL_ENV) → migra (override)",
    );
    check(
      migrationDecision({ VERCEL_ENV: "preview", ALLOW_MIGRATE: "1" }).migrate === true,
      "ALLOW_MIGRATE=1 en preview → migra (override gana)",
    );

    // Override solo con el valor exacto "1" (no "true", no "0", no vacío).
    check(
      migrationDecision({ ALLOW_MIGRATE: "true" }).migrate === false,
      "ALLOW_MIGRATE=true (≠ '1') → NO migra",
    );
    check(
      migrationDecision({ ALLOW_MIGRATE: "0" }).migrate === false,
      "ALLOW_MIGRATE=0 → NO migra",
    );

    // VERCEL_ENV debe ser exactamente "production" (case-sensitive).
    check(
      migrationDecision({ VERCEL_ENV: "Production" }).migrate === false,
      "VERCEL_ENV=Production (mayúscula) → NO migra (case-sensitive)",
    );

    // Cada decisión trae una razón no vacía (para el log del build).
    check(prod.reason.length > 0, "la decisión incluye una razón legible");
  }

  // ---------- 2. buildExportedConversations: orden + estructura paralelos ----------
  {
    const convs: ConversationMeta[] = [
      { id: "a", title: "Uno", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02") },
      { id: "b", title: "Dos", createdAt: new Date("2026-02-01"), updatedAt: new Date("2026-02-02") },
      { id: "c", title: "Tres", createdAt: new Date("2026-03-01"), updatedAt: new Date("2026-03-02") },
    ];

    // Colector mock: resuelve en orden INVERSO al de entrada (el primero tarda
    // más). Si el armado dependiera del orden de resolución, se desordenaría;
    // Promise.all + map debe conservar el orden de `convs`.
    const collect = (id: string): Promise<ExportedMessage[]> => {
      const delayById: Record<string, number> = { a: 30, b: 15, c: 0 };
      return new Promise((resolve) =>
        setTimeout(
          () => resolve([{ role: "user", content: `msg-${id}`, createdAt: new Date("2026-01-01") }]),
          delayById[id] ?? 0,
        ),
      );
    };

    const result = await buildExportedConversations(convs, collect);

    check(result.length === 3, "devuelve una entrada por conversación");
    check(
      result.map((r) => r.title).join(",") === "Uno,Dos,Tres",
      "preserva el ORDEN de entrada pese a resolución fuera de orden",
    );
    // Cada mensaje corresponde a SU conversación (no se cruzan los colectores).
    check(
      result.every((r, i) => r.messages[0]!.content === `msg-${convs[i]!.id}`),
      "cada conversación trae los mensajes de su propio id (sin cruce)",
    );
    // Estructura idéntica al loop secuencial: title/createdAt/updatedAt + messages.
    check(
      result[0]!.createdAt.getTime() === convs[0]!.createdAt.getTime() &&
        result[0]!.updatedAt.getTime() === convs[0]!.updatedAt.getTime(),
      "conserva createdAt/updatedAt de la metadata",
    );
    check(
      Object.keys(result[0]!).sort().join(",") === "createdAt,messages,title,updatedAt",
      "estructura exacta { title, createdAt, updatedAt, messages } (sin id interno)",
    );

    // Lista vacía → array vacío (no rompe).
    check((await buildExportedConversations([], collect)).length === 0, "lista vacía → []");
  }

  // ---------- 3. Los tres índices de purga TTL existen ----------
  {
    const schema = readFileSync(join(here, "..", "prisma", "schema.prisma"), "utf8");
    const migration = readFileSync(
      join(here, "..", "prisma", "migrations", "20260710020000_add_ttl_purge_indexes", "migration.sql"),
      "utf8",
    );

    // En el schema (por modelo). Cada modelo declara @@index del campo de purga.
    check(/@@index\(\[expiresAt\]\)/.test(schema), "schema: Session @@index([expiresAt])");
    check(/@@index\(\[updatedAt\]\)/.test(schema), "schema: UserMemory @@index([updatedAt])");
    check(/@@index\(\[createdAt\]\)/.test(schema), "schema: InteractionLog @@index([createdAt])");

    // En la migración SQL, con el nombre EXACTO que genera Prisma (mapeado de
    // tabla incluido: `session` en minúscula por el @@map).
    check(
      /CREATE INDEX "session_expiresAt_idx" ON "session"\("expiresAt"\)/.test(migration),
      "migración: session_expiresAt_idx",
    );
    check(
      /CREATE INDEX "UserMemory_updatedAt_idx" ON "UserMemory"\("updatedAt"\)/.test(migration),
      "migración: UserMemory_updatedAt_idx",
    );
    check(
      /CREATE INDEX "InteractionLog_createdAt_idx" ON "InteractionLog"\("createdAt"\)/.test(migration),
      "migración: InteractionLog_createdAt_idx",
    );
  }

  // ---------- 4. consentRevokedAt: columna aditiva (revocación standalone) ----------
  {
    const schema = readFileSync(join(here, "..", "prisma", "schema.prisma"), "utf8");
    check(
      /consentRevokedAt\s+DateTime\?/.test(schema),
      "schema: Guardian.consentRevokedAt DateTime? (nullable)",
    );

    const consentMig = readFileSync(
      join(here, "..", "prisma", "migrations", "20260710040000_add_guardian_consent_revoked", "migration.sql"),
      "utf8",
    );
    check(
      /ALTER TABLE "Guardian" ADD COLUMN\s+"consentRevokedAt" TIMESTAMP\(3\)/.test(consentMig),
      "migración: ADD COLUMN consentRevokedAt TIMESTAMP(3) (nombre exacto de Prisma)",
    );
    // ADITIVA y segura: columna nullable, sin NOT NULL ni DEFAULT que reescriba filas.
    check(
      !/NOT NULL/.test(consentMig),
      "migración: consentRevokedAt es nullable (aditiva, segura sobre datos existentes)",
    );
  }
}

main()
  .then(() => {
    done();
  })
  .catch((err) => {
    console.error("\nMigrate suite: error inesperado:", err);
    process.exit(1);
  });
