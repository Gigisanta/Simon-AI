/**
 * Lógica pura del historial de eventos de seguridad de un menor (route.ts:
 * GET /api/guardian/children/[childId]/safety-events). Extraída de la ruta —
 * que en Next solo puede exportar handlers HTTP — para tener cobertura de test
 * sobre invariantes de PRIVACIDAD y ANTI-ENUMERACIÓN (mismo criterio que
 * `sessionWindowQuery` en session-limit.ts: los args de Prisma como valor puro).
 *
 * INVARIANTES QUE FIJA EL TEST (scripts/safety-events-suite.ts):
 *   (a) `select` NUNCA incluye `conversationId` ni ningún campo con contenido
 *       del mensaje del menor: solo metadata (category, layer, createdAt,
 *       notifiedAt) + `id` (necesario como cursor). Reintroducir cualquier otro
 *       campo rompe el test (minimización, Ley 25.326 / GDPR-K).
 *   (b) menor que NO es del tutor/a → 404 (nunca 403): el resolver colapsa el
 *       "no encontrado" en un único status para no revelar la existencia de
 *       cuentas ajenas.
 *   (c) paginación por cursor pide `limit + 1` (no un count() extra) para saber
 *       si hay página siguiente.
 */
import type { Prisma } from "@/generated/prisma/client";

/**
 * SOLO metadata. `id` se incluye únicamente porque es el cursor de paginación;
 * no es contenido del menor. Cualquier otro campo (conversationId, texto, etc.)
 * está prohibido por diseño.
 */
export const SAFETY_EVENT_METADATA_SELECT = {
  id: true,
  category: true,
  layer: true,
  createdAt: true,
  notifiedAt: true,
} as const;

/** Campos que el test considera "no metadata" — su presencia en el select es un fallo. */
export const FORBIDDEN_SAFETY_EVENT_FIELDS = [
  "conversationId",
  "content",
  "message",
  "text",
  "body",
  "userId",
] as const;

/**
 * Args de `prisma.safetyEvent.findMany` como valor puro. `take: limit + 1` para
 * detectar `hasMore` sin count(); `cursor`/`skip:1` solo si hay cursor.
 */
export function safetyEventsQuery(
  childId: string,
  limit: number,
  cursor?: string,
) {
  return {
    where: { userId: childId },
    select: SAFETY_EVENT_METADATA_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  } satisfies Prisma.SafetyEventFindManyArgs;
}

/** Fila mínima que devuelve la query (metadata + id de cursor). */
export type SafetyEventRow = {
  id: string;
  category: string;
  layer: string;
  createdAt: Date;
  notifiedAt: Date | null;
};

export type SafetyEventsPage = {
  events: Array<Omit<SafetyEventRow, "id">>;
  nextCursor: string | null;
};

/**
 * Corta la fila extra (`limit + 1`), arma la página expuesta (sin `id`: el id
 * solo sale como `nextCursor`) y calcula el cursor siguiente.
 */
export function buildSafetyEventsPage(
  rows: SafetyEventRow[],
  limit: number,
): SafetyEventsPage {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    events: page.map((e) => ({
      category: e.category,
      layer: e.layer,
      createdAt: e.createdAt,
      notifiedAt: e.notifiedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  };
}

export type SafetyEventsResult =
  | { status: 404; body: { error: string } }
  | { status: 200; body: SafetyEventsPage };

export type SafetyEventsDeps = {
  /** Vínculo de tutela o null (findOwnedChild): null ⇒ 404 anti-enumeración. */
  findChild: (guardianUserId: string, childId: string) => Promise<unknown>;
  /** Ejecutor de la query (prisma.safetyEvent.findMany) — inyectable en tests. */
  runQuery: (
    args: ReturnType<typeof safetyEventsQuery>,
  ) => Promise<SafetyEventRow[]>;
};

/**
 * Orquestador puro (con deps inyectables): resuelve el status + body sin tocar
 * el framework HTTP. El caller (route.ts) solo mapea esto a `Response.json`.
 * Fija la invariante (b): si `findChild` devuelve null → 404, nunca 403.
 */
export async function resolveSafetyEvents(
  deps: SafetyEventsDeps,
  input: {
    guardianUserId: string;
    childId: string;
    limit: number;
    cursor?: string;
  },
): Promise<SafetyEventsResult> {
  const link = await deps.findChild(input.guardianUserId, input.childId);
  if (!link) return { status: 404, body: { error: "Menor no encontrado." } };
  const rows = await deps.runQuery(
    safetyEventsQuery(input.childId, input.limit, input.cursor),
  );
  return { status: 200, body: buildSafetyEventsPage(rows, input.limit) };
}
