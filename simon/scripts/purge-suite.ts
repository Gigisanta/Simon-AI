/**
 * Suite de la orquestación de purga del cron (lib/retention.purgeExpiredData) —
 * hallazgo de retención/privacidad #1 (menores huérfanos) + regresión del batch
 * TTL existente.
 *
 *   pnpm purge-suite
 *
 * Testea con un CLIENTE FALSO inyectado (sin DB): registra cada `deleteMany`, su
 * modelo, su `where` y el orden de invocación. Fija los invariantes:
 *   1. Se purgan las CUATRO cosas: UserMemory (90d), InteractionLog (180d),
 *      Session (expiradas) y menores huérfanos (role child, sin tutela, gracia).
 *   2. Cada `where` usa el corte correcto (mismos helpers que el path lazy).
 *   3. El barrido de huérfanos corre DESPUÉS del batch TTL (evita deadlock: su
 *      cascade toca UserMemory/InteractionLog/Session del menor).
 *   4. Los counts devueltos mapean a cada tabla sin cruzarse.
 *
 * Camino crítico (supresión de datos de menores, Ley 25.326): sale con código 1
 * si algún caso falla.
 */
import { createChecker } from "./suite-helpers";
import {
  purgeExpiredData,
  interactionLogTtlCutoff,
  orphanChildCutoff,
  type RetentionPurgeClient,
} from "../src/lib/retention";
import { memoryTtlCutoff } from "../src/lib/ai/memory";

const { check, done } = createChecker("Purge suite");

type Call = { model: string; where: Record<string, unknown> };

// Cliente falso: cada delegate registra su llamada y devuelve un count fijo y
// distinto por tabla (para detectar si algún count se cruza en el mapeo).
function makeFakeClient(counts: {
  userMemory: number;
  interactionLog: number;
  session: number;
  user: number;
}) {
  const calls: Call[] = [];
  const delegate = (model: string, count: number) => ({
    deleteMany: async (args: { where: Record<string, unknown> }) => {
      calls.push({ model, where: args.where });
      return { count };
    },
  });
  const client = {
    userMemory: delegate("userMemory", counts.userMemory),
    interactionLog: delegate("interactionLog", counts.interactionLog),
    session: delegate("session", counts.session),
    user: delegate("user", counts.user),
  } as unknown as RetentionPurgeClient;
  return { client, calls };
}

const now = new Date("2026-07-10T12:00:00.000Z");

async function main() {
// ---------- 1. Se llama a las cuatro tablas, con el where correcto ----------
{
  const { client, calls } = makeFakeClient({
    userMemory: 3,
    interactionLog: 5,
    session: 7,
    user: 2,
  });
  const result = await purgeExpiredData(client, now);

  const byModel = (m: string) => calls.find((c) => c.model === m)?.where;

  check(calls.length === 4, "se ejecutan exactamente 4 deleteMany");

  const mem = byModel("userMemory") as { updatedAt?: { lt?: Date } } | undefined;
  check(
    mem?.updatedAt?.lt?.getTime() === memoryTtlCutoff(now).getTime(),
    "UserMemory: updatedAt.lt = corte 90d (helper compartido)",
  );

  const log = byModel("interactionLog") as { createdAt?: { lt?: Date } } | undefined;
  check(
    log?.createdAt?.lt?.getTime() === interactionLogTtlCutoff(now).getTime(),
    "InteractionLog: createdAt.lt = corte 180d",
  );

  const sess = byModel("session") as { expiresAt?: { lt?: Date } } | undefined;
  check(
    sess?.expiresAt?.lt?.getTime() === now.getTime(),
    "Session: expiresAt.lt = now (sesiones expiradas)",
  );

  const usr = byModel("user") as
    | { role?: string; guardedBy?: unknown; updatedAt?: { lt?: Date } }
    | undefined;
  check(usr?.role === "child", "huérfanos: role = 'child' (nunca borra guardians)");
  check(
    JSON.stringify(usr?.guardedBy) === JSON.stringify({ is: null }),
    "huérfanos: guardedBy { is: null } (solo menores SIN tutela)",
  );
  check(
    usr?.updatedAt?.lt?.getTime() === orphanChildCutoff(now).getTime(),
    "huérfanos: updatedAt.lt = corte de gracia (30d)",
  );

  // ---------- 2. Mapeo de counts sin cruce ----------
  check(result.userMemory === 3, "count userMemory mapeado (3)");
  check(result.interactionLog === 5, "count interactionLog mapeado (5)");
  check(result.sessions === 7, "count sessions mapeado (7)");
  check(result.orphanChildren === 2, "count orphanChildren mapeado (2)");
}

// ---------- 3. Orden anti-deadlock: huérfanos DESPUÉS del batch TTL ----------
{
  const { client, calls } = makeFakeClient({
    userMemory: 0,
    interactionLog: 0,
    session: 0,
    user: 0,
  });
  await purgeExpiredData(client, now);
  const userIdx = calls.findIndex((c) => c.model === "user");
  const ttlModels = ["userMemory", "interactionLog", "session"];
  const ttlMaxIdx = Math.max(
    ...ttlModels.map((m) => calls.findIndex((c) => c.model === m)),
  );
  check(
    userIdx > ttlMaxIdx,
    "el borrado de huérfanos (cascade) corre DESPUÉS de las 3 purgas TTL",
  );
}
}

main()
  .then(() => {
    done();
  })
  .catch((err) => {
    console.error("\nPurge suite: error inesperado:", err);
    process.exit(1);
  });
