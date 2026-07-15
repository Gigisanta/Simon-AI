/**
 * Suite de la orquestación de purga del cron (lib/retention.purgeExpiredData) —
 * hallazgo de retención/privacidad #1 (menores huérfanos) + regresión del batch
 * TTL existente.
 *
 *   pnpm purge-suite
 *
 * Testea con un CLIENTE FALSO inyectado (sin DB): registra cada `deleteMany`, su
 * modelo, su `where` y el orden de invocación. Fija los invariantes:
 *   1. Se purgan las SIETE cosas: UserMemory (90d), InteractionLog (180d),
 *      Session (expiradas), SafetyEvent (730d, ADR-4), Message (365d, ADR-4),
 *      Conversation (365d y vacía, ADR-4) y menores huérfanos (role child, sin
 *      tutela, gracia).
 *   2. Cada `where` usa el corte correcto (mismos helpers que el path lazy).
 *   3. SafetyEvent con alertFailedAt pendiente NO se purga (alerta de crisis
 *      fallida nunca se pierde por TTL).
 *   4. Conversation solo se borra vencida Y vacía (`messages: none`) — el
 *      cascade jamás arrastra un mensaje dentro de TTL.
 *   5. Orden anti-deadlock: Conversation DESPUÉS del batch TTL (su cascade toca
 *      Message) y huérfanos al final (su cascade toca TODAS las tablas).
 *   6. Los counts devueltos mapean a cada tabla sin cruzarse.
 *
 * Camino crítico (supresión de datos de menores, Ley 25.326): sale con código 1
 * si algún caso falla.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createChecker } from "./suite-helpers";
import {
  purgeExpiredData,
  purgeUnderLock,
  interactionLogTtlCutoff,
  conversationTtlCutoff,
  safetyEventTtlCutoff,
  orphanChildCutoff,
  type PurgeCounts,
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
  safetyEvent: number;
  message: number;
  conversation: number;
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
    safetyEvent: delegate("safetyEvent", counts.safetyEvent),
    message: delegate("message", counts.message),
    conversation: delegate("conversation", counts.conversation),
    user: delegate("user", counts.user),
  } as unknown as RetentionPurgeClient;
  return { client, calls };
}

const now = new Date("2026-07-10T12:00:00.000Z");

// ---------- 0. Config del $transaction de la ruta del cron (anti-drift) ----------
// La transacción interactiva de src/app/api/cron/purge/route.ts DEBE llevar un
// segundo argumento con `timeout` (default de Prisma = 5s: en un backlog grande la
// purga lo excede y TODA la transacción hace rollback) y `maxWait` explícito. Sin
// framework que importe la ruta (arrastra Prisma/env), lo validamos leyendo el
// texto de la ruta con regex — mismo patrón que retry-suite con maxDuration. Si
// alguien quita el segundo argumento del $transaction, este caso falla.
function testTransactionConfig() {
  const here = dirname(fileURLToPath(import.meta.url));
  const routePath = join(here, "..", "src", "app", "api", "cron", "purge", "route.ts");
  const src = readFileSync(routePath, "utf8");

  // maxDuration inline de la ruta (presupuesto de la invocación).
  const durMatch = src.match(
    /export\s+const\s+maxDuration\s*(?::\s*[A-Za-z0-9_]+\s*)?=\s*(\d+)\s*;/,
  );
  check(durMatch !== null, "route.ts: se encuentra el literal `export const maxDuration`");
  const maxDurationMs = durMatch ? Number(durMatch[1]) * 1000 : 0;

  check(src.includes("prisma.$transaction("), "route.ts: usa prisma.$transaction(...)");
  // Segundo argumento del $transaction: el objeto de opciones (sin llaves
  // anidadas, con `timeout`) que CIERRA el call — va pegado al `)` de cierre
  // (tolerando comentarios/espacios antes). Si alguien quita el segundo argumento
  // el objeto desaparece y este match es null (queda solo el callback y `)`).
  const optsMatch = src.match(/(\{[^{}]*\btimeout\b[^{}]*\})\s*,?\s*\)/);
  check(
    optsMatch !== null,
    "route.ts: $transaction lleva un SEGUNDO argumento (objeto de opciones)",
  );
  const opts = optsMatch?.[1] ?? "";

  const timeoutMatch = opts.match(/timeout:\s*([\d_]+)/);
  const maxWaitMatch = opts.match(/maxWait:\s*([\d_]+)/);
  check(timeoutMatch !== null, "route.ts: el $transaction fija `timeout` explícito");
  check(maxWaitMatch !== null, "route.ts: el $transaction fija `maxWait` explícito");

  // timeout debe cubrir el presupuesto (>= maxDuration*1000 - margen para el
  // commit/handler). Con maxDuration=60s y margen 6s el piso es 54s.
  const MARGIN_MS = 6_000;
  const timeoutMs = timeoutMatch ? Number(timeoutMatch[1].replace(/_/g, "")) : 0;
  check(
    timeoutMs >= maxDurationMs - MARGIN_MS,
    `route.ts: timeout (${timeoutMs}ms) >= maxDuration*1000 - ${MARGIN_MS} (${maxDurationMs - MARGIN_MS}ms) — no debe quedar en el default 5s`,
  );
  // maxWait acotado y positivo (falla rápido si no consigue conexión del pool).
  const maxWaitMs = maxWaitMatch ? Number(maxWaitMatch[1].replace(/_/g, "")) : 0;
  check(maxWaitMs > 0, "route.ts: maxWait > 0 (falla rápido si no hay conexión del pool)");
}

async function main() {
testTransactionConfig();

// ---------- 1. Se llama a las siete tablas, con el where correcto ----------
{
  const { client, calls } = makeFakeClient({
    userMemory: 3,
    interactionLog: 5,
    session: 7,
    safetyEvent: 11,
    message: 13,
    conversation: 17,
    user: 2,
  });
  const result = await purgeExpiredData(client, now);

  const byModel = (m: string) => calls.find((c) => c.model === m)?.where;

  check(calls.length === 7, "se ejecutan exactamente 7 deleteMany");

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

  // ADR-4: SafetyEvent — TTL 730d, PRESERVANDO alertas de crisis fallidas.
  const sev = byModel("safetyEvent") as
    | { createdAt?: { lt?: Date }; alertFailedAt?: unknown }
    | undefined;
  check(
    sev?.createdAt?.lt?.getTime() === safetyEventTtlCutoff(now).getTime(),
    "SafetyEvent: createdAt.lt = corte 730d (ADR-4)",
  );
  check(
    sev !== undefined && "alertFailedAt" in sev && sev.alertFailedAt === null,
    "SafetyEvent: alertFailedAt = null (una alerta fallida pendiente NUNCA se purga por TTL)",
  );

  // ADR-4: Message — TTL 365d por createdAt.
  const msg = byModel("message") as { createdAt?: { lt?: Date } } | undefined;
  check(
    msg?.createdAt?.lt?.getTime() === conversationTtlCutoff(now).getTime(),
    "Message: createdAt.lt = corte 365d (ADR-4)",
  );

  // ADR-4: Conversation — vencida (updatedAt) Y vacía tras la purga de mensajes.
  const conv = byModel("conversation") as
    | { updatedAt?: { lt?: Date }; messages?: unknown }
    | undefined;
  check(
    conv?.updatedAt?.lt?.getTime() === conversationTtlCutoff(now).getTime(),
    "Conversation: updatedAt.lt = corte 365d (mismo helper que Message)",
  );
  check(
    JSON.stringify(conv?.messages) === JSON.stringify({ none: {} }),
    "Conversation: messages { none: {} } — solo se borra si quedó VACÍA (el cascade jamás arrastra un mensaje vigente)",
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
  check(result.safetyEvents === 11, "count safetyEvents mapeado (11)");
  check(result.messages === 13, "count messages mapeado (13)");
  check(result.conversations === 17, "count conversations mapeado (17)");
  check(result.orphanChildren === 2, "count orphanChildren mapeado (2)");
}

// ---------- 3. Orden anti-deadlock: Conversation tras el batch, huérfanos al final ----------
{
  const { client, calls } = makeFakeClient({
    userMemory: 0,
    interactionLog: 0,
    session: 0,
    safetyEvent: 0,
    message: 0,
    conversation: 0,
    user: 0,
  });
  await purgeExpiredData(client, now);
  const convIdx = calls.findIndex((c) => c.model === "conversation");
  const userIdx = calls.findIndex((c) => c.model === "user");
  const ttlModels = ["userMemory", "interactionLog", "session", "safetyEvent", "message"];
  const ttlMaxIdx = Math.max(
    ...ttlModels.map((m) => calls.findIndex((c) => c.model === m)),
  );
  check(
    convIdx > ttlMaxIdx,
    "Conversation (cascade sobre Message) corre DESPUÉS de las 5 purgas TTL paralelas",
  );
  check(
    userIdx > convIdx,
    "el borrado de huérfanos (cascade total) corre ÚLTIMO, después de Conversation",
  );
}

// ---------- 4. purgeUnderLock: lock adquirido vs no adquirido ----------
const FAKE_COUNTS: PurgeCounts = {
  userMemory: 1,
  interactionLog: 2,
  sessions: 3,
  safetyEvents: 5,
  messages: 6,
  conversations: 7,
  orphanChildren: 4,
};

{
  // Lock ADQUIRIDO → corre la purga y devuelve los counts.
  let purgeCalls = 0;
  const res = await purgeUnderLock({
    tryLock: async () => true,
    purge: async () => {
      purgeCalls += 1;
      return FAKE_COUNTS;
    },
  });
  check(res.skipped === false, "lock adquirido → skipped false");
  check(
    res.skipped === false && res.deleted === FAKE_COUNTS,
    "lock adquirido → devuelve los counts de la purga",
  );
  check(purgeCalls === 1, "lock adquirido → la purga corre EXACTAMENTE una vez");
}

{
  // Lock NO adquirido (otra corrida lo tiene) → NO corre la purga, skipped.
  let purgeCalls = 0;
  const res = await purgeUnderLock({
    tryLock: async () => false,
    purge: async () => {
      purgeCalls += 1;
      return FAKE_COUNTS;
    },
  });
  check(res.skipped === true, "lock NO adquirido → skipped true");
  check(purgeCalls === 0, "lock NO adquirido → la purga NO se ejecuta (cero borrados)");
  check(
    !("deleted" in res),
    "lock NO adquirido → el resultado no trae counts (nada que reportar)",
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
