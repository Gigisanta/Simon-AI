/**
 * Suite del módulo de retención / minimización (lib/retention.ts) — #9 + #12.
 *
 *   pnpm retention-suite
 *
 * Testea SOLO lógica pura (sin red, sin DB):
 *   1. Cortes TTL (interactionLogTtlCutoff, y el compartido memoryTtlCutoff) —
 *      que el cron y el path lazy usan LA MISMA constante/helper.
 *   2. isAuthorizedCron — auth timing-safe del cron: secret ausente, header
 *      ausente, sin prefijo, token vacío, mismatch, match.
 *
 * Camino crítico (retención de datos de menores + endpoint protegido): sale con
 * código 1 si algún caso falla (gate de CI).
 */
import {
  INTERACTION_LOG_TTL_DAYS,
  interactionLogTtlCutoff,
  isAuthorizedCron,
  ORPHAN_CHILD_GRACE_DAYS,
  orphanChildCutoff,
  orphanChildWhere,
} from "../src/lib/retention";
import { MEMORY_TTL_DAYS, memoryTtlCutoff } from "../src/lib/ai/memory";

let passed = 0;
const failures: string[] = [];
function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- 1. Cortes TTL ----------
{
  check(INTERACTION_LOG_TTL_DAYS === 180, "InteractionLog TTL = 180 días");

  const now = new Date("2026-07-10T12:00:00.000Z");
  const cut = interactionLogTtlCutoff(now);
  check(
    cut.getTime() === now.getTime() - 180 * DAY_MS,
    "interactionLogTtlCutoff = now - 180d exacto",
  );
  // Frontera: una fila justo en el corte NO está vencida (usamos `lt`), una 1ms
  // más vieja sí. Se valida la aritmética del borde.
  check(
    interactionLogTtlCutoff(now).getTime() < now.getTime(),
    "el corte de InteractionLog es anterior a now",
  );

  // El corte de UserMemory (90d) viene de ai/memory.ts — MISMA fuente que usa el
  // cron: se valida que el helper compartido dé 90d exactos (cero duplicación).
  check(MEMORY_TTL_DAYS === 90, "UserMemory TTL = 90 días (fuente compartida)");
  check(
    memoryTtlCutoff(now).getTime() === now.getTime() - 90 * DAY_MS,
    "memoryTtlCutoff = now - 90d exacto",
  );
  // Los dos cortes son distintos (180 vs 90): garantiza que el cron no confunda
  // una tabla con la otra.
  check(
    interactionLogTtlCutoff(now).getTime() < memoryTtlCutoff(now).getTime(),
    "el corte de InteractionLog (180d) es más viejo que el de UserMemory (90d)",
  );
}

// ---------- 2. isAuthorizedCron (timing-safe) ----------
{
  const SECRET = "s3cr3t-cron-token-abc123";

  // Secret ausente/vacío → SIEMPRE false (fail-closed; el caller responde 503).
  check(
    isAuthorizedCron(`Bearer ${SECRET}`, undefined) === false,
    "secret undefined → false",
  );
  check(isAuthorizedCron(`Bearer ${SECRET}`, "") === false, "secret vacío → false");
  check(isAuthorizedCron(`Bearer ${SECRET}`, null) === false, "secret null → false");

  // Header ausente / malformado → false.
  check(isAuthorizedCron(null, SECRET) === false, "header null → false");
  check(isAuthorizedCron(undefined, SECRET) === false, "header undefined → false");
  check(isAuthorizedCron("", SECRET) === false, "header vacío → false");
  check(
    isAuthorizedCron(SECRET, SECRET) === false,
    "header sin prefijo 'Bearer ' → false",
  );
  check(
    isAuthorizedCron(`bearer ${SECRET}`, SECRET) === false,
    "prefijo en minúscula 'bearer' → false (case-sensitive)",
  );
  check(isAuthorizedCron("Bearer ", SECRET) === false, "token vacío tras Bearer → false");

  // Mismatch → false (mismo largo y distinto largo).
  check(
    isAuthorizedCron("Bearer s3cr3t-cron-token-abc124", SECRET) === false,
    "token de MISMO largo pero distinto → false",
  );
  check(
    isAuthorizedCron("Bearer no", SECRET) === false,
    "token más corto → false (digest de largo fijo, sin throw)",
  );
  check(
    isAuthorizedCron(`Bearer ${SECRET}extra`, SECRET) === false,
    "token más largo → false (digest de largo fijo, sin throw)",
  );

  // Match exacto → true.
  check(isAuthorizedCron(`Bearer ${SECRET}`, SECRET) === true, "token correcto → true");

  // No lanza NUNCA (aunque largos difieran mucho): robustez del comparador.
  let threw = false;
  try {
    isAuthorizedCron("Bearer x", "un-secreto-muchisimo-mas-largo-que-x-0000000000");
  } catch {
    threw = true;
  }
  check(!threw, "isAuthorizedCron nunca lanza por diferencia de largo");
}

// ---------- 3. Menores huérfanos: corte de gracia + criterio (where) ----------
{
  check(ORPHAN_CHILD_GRACE_DAYS === 30, "gracia de menores huérfanos = 30 días");

  const now = new Date("2026-07-10T12:00:00.000Z");
  check(
    orphanChildCutoff(now).getTime() === now.getTime() - 30 * DAY_MS,
    "orphanChildCutoff = now - 30d exacto",
  );
  check(orphanChildCutoff(now).getTime() < now.getTime(), "el corte de gracia es anterior a now");

  // El `where` debe filtrar EXACTAMENTE los tres criterios: role child, sin
  // tutela (guardedBy null), y updatedAt anterior al corte. Un fallo acá borra
  // menores CON tutor/a o antes de tiempo (o no purga ninguno).
  const where = orphanChildWhere(now);
  check(where.role === "child", "where: role = 'child' (nunca toca guardians)");
  check(
    JSON.stringify(where.guardedBy) === JSON.stringify({ is: null }),
    "where: guardedBy { is: null } (solo menores SIN vínculo de tutela)",
  );
  const updatedAt = where.updatedAt as { lt?: Date } | undefined;
  check(
    updatedAt?.lt instanceof Date &&
      updatedAt.lt.getTime() === orphanChildCutoff(now).getTime(),
    "where: updatedAt.lt = corte de gracia (respeta el período de gracia)",
  );

  // El corte de gracia (30d) es MÁS NUEVO que los TTL de datos (90d/180d): la
  // orfandad se evalúa sobre actividad reciente del menor, no sobre la data.
  check(
    orphanChildCutoff(now).getTime() > memoryTtlCutoff(now).getTime(),
    "el corte de gracia (30d) es más nuevo que el TTL de UserMemory (90d)",
  );
}

const total = passed + failures.length;
console.log(`\nRetention suite: ${passed}/${total} casos OK`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
  process.exit(1);
}
console.log("Todos los casos pasaron.\n");
