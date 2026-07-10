/**
 * Suite ejecutable del historial de eventos de seguridad de un menor
 * (GET /api/guardian/children/[childId]/safety-events). Sin framework — tsx.
 *
 *   pnpm test safety-events
 *
 * CRÍTICO (seguridad infantil + privacidad, Ley 25.326 / GDPR-K). Testea la
 * lógica pura extraída en src/lib/safety-events.ts, fijando 3 invariantes:
 *
 *   (a) PRIVACIDAD — el `select` de la query NUNCA expone `conversationId` ni
 *       ningún campo con contenido del menor: solo metadata + `id` (cursor).
 *   (b) ANTI-ENUMERACIÓN — un menor que no es del tutor/a (findChild → null)
 *       resuelve 404, jamás 403 ni un status distinto que delate la existencia.
 *   (c) PAGINACIÓN — la query pide exactamente `limit + 1` (sin count()) y el
 *       cursor agrega `cursor.id` + `skip:1`; `buildSafetyEventsPage` corta la
 *       fila extra y calcula `nextCursor`.
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
import {
  safetyEventsQuery,
  buildSafetyEventsPage,
  resolveSafetyEvents,
  SAFETY_EVENT_METADATA_SELECT,
  FORBIDDEN_SAFETY_EVENT_FIELDS,
  type SafetyEventRow,
} from "../src/lib/safety-events";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

// Campos de metadata permitidos en el select (todo lo demás está prohibido).
const ALLOWED_SELECT_KEYS = new Set([
  "id",
  "category",
  "layer",
  "createdAt",
  "notifiedAt",
]);

function row(id: string, over: Partial<SafetyEventRow> = {}): SafetyEventRow {
  return {
    id,
    category: "crisis",
    layer: "keyword",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    notifiedAt: null,
    ...over,
  };
}

// ---------- (a) PRIVACIDAD: el select solo expone metadata ----------
{
  const q = safetyEventsQuery("child_1", 20);
  const selectKeys = Object.keys(q.select);

  // Ningún campo prohibido (conversationId el más importante) en el select.
  for (const forbidden of FORBIDDEN_SAFETY_EVENT_FIELDS) {
    check(
      !(forbidden in q.select),
      `select NO incluye campo sensible "${forbidden}"`,
    );
  }
  // conversationId existe en el schema (String?) — el caso más crítico, explícito.
  check(
    !("conversationId" in q.select),
    "select NUNCA incluye conversationId (existe en el schema y NO debe filtrarse)",
  );
  // Y a la inversa: todo lo que SÍ pide es metadata de la whitelist.
  check(
    selectKeys.every((k) => ALLOWED_SELECT_KEYS.has(k)),
    `select solo pide metadata permitida (tiene: ${selectKeys.join(", ")})`,
  );
  // Los 5 campos de metadata esperados están presentes.
  check(
    selectKeys.length === 5 &&
      (["id", "category", "layer", "createdAt", "notifiedAt"] as const).every(
        (k) => (q.select as Record<string, unknown>)[k] === true,
      ),
    "select pide exactamente los 5 campos de metadata (id, category, layer, createdAt, notifiedAt)",
  );
  // La constante compartida coincide con lo que arma la query.
  check(
    JSON.stringify(SAFETY_EVENT_METADATA_SELECT) === JSON.stringify(q.select),
    "SAFETY_EVENT_METADATA_SELECT es la fuente única del select",
  );
  // where filtra por el menor pedido (no cross-user).
  check(
    q.where.userId === "child_1",
    "where filtra por userId del menor pedido (scoping)",
  );

  // La página expuesta NO reemite `id` como campo de evento (solo como cursor).
  const page = buildSafetyEventsPage([row("e1")], 20);
  check(
    page.events.length === 1 &&
      !("id" in (page.events[0] as Record<string, unknown>)),
    "eventos expuestos no reemiten id (solo metadata visible)",
  );
  const eventKeys = Object.keys(page.events[0] as Record<string, unknown>);
  check(
    eventKeys.length === 4 &&
      eventKeys.every((k) => ["category", "layer", "createdAt", "notifiedAt"].includes(k)),
    "cada evento expuesto tiene solo category/layer/createdAt/notifiedAt",
  );
}

// ---------- (c) PAGINACIÓN: limit+1, cursor y corte ----------
{
  // Sin cursor: take = limit+1, sin cursor/skip.
  const q0 = safetyEventsQuery("c", 20);
  check(q0.take === 21, "take === limit + 1 (detecta hasMore sin count())");
  check(!("cursor" in q0), "sin cursor: la query no incluye cursor");
  check(!("skip" in q0), "sin cursor: la query no incluye skip");

  // Con cursor: agrega cursor.id + skip:1.
  const q1 = safetyEventsQuery("c", 10, "cur_abc");
  check(q1.take === 11, "con cursor: take sigue siendo limit + 1");
  check(
    !!q1.cursor && q1.cursor.id === "cur_abc" && q1.skip === 1,
    "con cursor: incluye cursor.id y skip:1 (no re-lee el propio cursor)",
  );

  // orderBy estable: createdAt desc con id desc de desempate.
  const orderBy = q1.orderBy as unknown as Array<Record<string, string>>;
  check(
    Array.isArray(orderBy) &&
      orderBy.length === 2 &&
      orderBy[0]!.createdAt === "desc" &&
      orderBy[1]!.id === "desc",
    "orderBy estable: createdAt desc, id desc de desempate",
  );

  // buildSafetyEventsPage: hay más → corta la fila extra y devuelve nextCursor.
  const overflow = [row("a"), row("b"), row("c"), row("d")]; // 4 filas, limit 3
  const p = buildSafetyEventsPage(overflow, 3);
  check(p.events.length === 3, "hasMore: recorta a limit exactos (descarta la fila +1)");
  check(p.nextCursor === "c", "hasMore: nextCursor = id de la última fila expuesta");

  // Justo en el límite (rows === limit) → no hay más, nextCursor null.
  const exact = buildSafetyEventsPage([row("a"), row("b"), row("c")], 3);
  check(exact.events.length === 3, "rows === limit: devuelve todas");
  check(exact.nextCursor === null, "rows === limit: nextCursor null (no hay página siguiente)");

  // Página vacía → nextCursor null.
  const empty = buildSafetyEventsPage([], 20);
  check(empty.events.length === 0 && empty.nextCursor === null, "sin filas: página vacía, nextCursor null");
}

// ---------- (b) ANTI-ENUMERACIÓN: hijo no propio → 404 (no 403) ----------
async function testNotFound() {
  let queried = false;
  // findChild → null (no existe / ajeno / no-menor: los tres colapsan en null).
  const res = await resolveSafetyEvents(
    {
      findChild: async () => null,
      runQuery: async () => {
        queried = true;
        return [];
      },
    },
    { guardianUserId: "g1", childId: "ajeno", limit: 20 },
  );
  check(res.status === 404, "menor no propio → status 404");
  check(
    res.status === 404 && (res.status as number) !== 403,
    "menor no propio → NUNCA 403 (no delata existencia de la cuenta)",
  );
  // Y jamás se corre la query de eventos para un menor no autorizado.
  check(!queried, "menor no propio → no se ejecuta la query de eventos (corta antes)");
}

// ---------- (b/c) camino feliz: menor propio → 200 con página ----------
async function testOwnedChild() {
  const seen: { args?: ReturnType<typeof safetyEventsQuery> } = {};
  const res = await resolveSafetyEvents(
    {
      findChild: async (g, c) => (g === "g1" && c === "mine" ? { id: "link1" } : null),
      runQuery: async (args) => {
        seen.args = args;
        return [row("e1"), row("e2")];
      },
    },
    { guardianUserId: "g1", childId: "mine", limit: 5, cursor: "cur1" },
  );
  check(res.status === 200, "menor propio → status 200");
  check(
    res.status === 200 && res.body.events.length === 2,
    "menor propio → devuelve la página de eventos",
  );
  // El resolver pasó a la query los args puros correctos (scoping + cursor).
  check(
    !!seen.args &&
      seen.args.where.userId === "mine" &&
      seen.args.take === 6 &&
      seen.args.cursor?.id === "cur1",
    "resolver arma la query con userId del menor, take=limit+1 y cursor",
  );
}

async function main() {
  await testNotFound();
  await testOwnedChild();

  const total = passed + failures.length;
  console.log(`\nSafety-events suite: ${passed}/${total} casos OK`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
    process.exit(1);
  }
  console.log("Todos los casos pasaron.\n");
}

main();
