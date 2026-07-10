/**
 * Aplica `prisma migrate deploy` SOLO en el deploy de producción.
 *
 * PROBLEMA (camino crítico — migraciones sobre la DB de menores): el build
 * script corría `prisma migrate deploy` en CADA build, incluidos los preview
 * deploys de Vercel. Un preview build podía así aplicar migraciones contra la DB
 * de producción (misma DATABASE_URL) — cambios de schema sin revisar, disparados
 * por cualquier push a una rama. Este runner cierra ese agujero: solo migra
 * cuando el entorno es realmente producción (o con un override explícito).
 *
 * GATING (función pura `migrationDecision`, testeada en migrate-suite):
 *   - ALLOW_MIGRATE === "1"  → migra (escape hatch explícito para casos manuales).
 *   - VERCEL_ENV === "production" → migra (el deploy de producción real).
 *   - cualquier otro (preview / development / sin VERCEL_ENV) → SALTA, exit 0.
 *
 * FAIL LOUDLY: si se decide migrar y `prisma migrate deploy` falla, el proceso
 * sale con código != 0 (propaga el status del hijo) — nunca se traga el error en
 * silencio: un build de producción con migración fallida DEBE romper.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface MigrationDecision {
  migrate: boolean;
  reason: string;
}

/** Entorno relevante para la decisión (subconjunto de process.env, inyectable). */
export interface MigrationEnv {
  VERCEL_ENV?: string;
  ALLOW_MIGRATE?: string;
}

/**
 * Decisión PURA de si aplicar migraciones. Precedencia: override explícito
 * (ALLOW_MIGRATE=1) primero, luego el entorno de producción de Vercel; en
 * cualquier otro caso NO se migra (fail-closed hacia no tocar la DB).
 */
export function migrationDecision(env: MigrationEnv): MigrationDecision {
  if (env.ALLOW_MIGRATE === "1") {
    return { migrate: true, reason: "ALLOW_MIGRATE=1 (override explícito)" };
  }
  if (env.VERCEL_ENV === "production") {
    return { migrate: true, reason: "VERCEL_ENV=production" };
  }
  const vercelEnv = env.VERCEL_ENV ?? "(sin VERCEL_ENV)";
  return {
    migrate: false,
    reason: `entorno no productivo (VERCEL_ENV=${vercelEnv}) y sin ALLOW_MIGRATE=1`,
  };
}

/** Ejecuta el runner: decide y, si corresponde, corre `prisma migrate deploy`. */
function run(): void {
  const decision = migrationDecision({
    VERCEL_ENV: process.env.VERCEL_ENV,
    ALLOW_MIGRATE: process.env.ALLOW_MIGRATE,
  });

  if (!decision.migrate) {
    console.log(`[migrate] SALTA migraciones — ${decision.reason}.`);
    process.exit(0);
  }

  console.log(`[migrate] Aplicando migraciones — ${decision.reason}.`);
  const res = spawnSync("prisma", ["migrate", "deploy"], {
    stdio: "inherit",
    // En Windows el binario es prisma.cmd; shell:true resuelve ambos casos.
    shell: process.platform === "win32",
  });

  // Fail loudly: no se pudo lanzar el proceso (binario ausente, etc.).
  if (res.error) {
    console.error(`[migrate] No se pudo ejecutar prisma migrate deploy:`, res.error);
    process.exit(1);
  }
  // Terminado por señal → tratar como fallo.
  if (res.signal) {
    console.error(`[migrate] prisma migrate deploy terminó por señal ${res.signal}.`);
    process.exit(1);
  }
  // Propaga el exit code real (0 = OK; != 0 = migración falló → build rompe).
  process.exit(res.status ?? 1);
}

// Solo ejecuta cuando se corre como script (no al importarlo desde los tests).
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  run();
}
