/**
 * Historial de eventos de seguridad de UN menor, para su tutor/a (M-P2 §2).
 *
 * GET → lista paginada (cursor) de los SafetyEvent del menor, con SOLO metadata:
 *       category, layer, createdAt, notifiedAt. NUNCA el contenido del mensaje.
 *
 * PRIVACIDAD (Ley 25.326 / GDPR-K, minimización): SafetyEvent es un registro
 * anonimizado por diseño — no guarda texto del menor (ver schema.prisma). Este
 * endpoint expone únicamente los campos de metadata y JAMÁS `conversationId` ni
 * ningún otro identificador que pudiera correlacionarse con lo que el menor
 * escribió. El tutor/a ve QUÉ tipo de señal y CUÁNDO, no el contenido.
 *
 * AUTORIZACIÓN (mismo patrón exacto que ../route.ts): sesión de guardian +
 * vínculo de tutela (guardianUserId, childUserId, childUser.role="child"). Si el
 * childId no es un menor SUYO → 404 (nunca se revela existencia de cuentas ajenas).
 */
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireGuardian, findOwnedChild } from "@/lib/guardian-auth";
import { z } from "zod";

const RATE_LIMIT_PER_MINUTE = 60;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Validación estricta de los query params (nunca confiar en el cliente).
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  // Cursor = id del último evento de la página previa (cuid). Opcional.
  cursor: z.string().min(1).max(64).optional(),
});

const NOT_FOUND = () =>
  Response.json({ error: "Menor no encontrado." }, { status: 404 });

// Solo se necesita saber que el vínculo existe → id. La autorización (where con
// los tres constraints) vive en findOwnedChild (@/lib/guardian-auth).
const OWNED_CHILD_SELECT = { id: true } as const;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ childId: string }> },
) {
  const guard = await requireGuardian(req, { requireVerifiedEmail: false });
  if (!guard.ok) return guard.response;

  const rl = await checkRateLimit(
    `guardian:child-safety-events:${guard.user.id}`,
    RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: "Demasiadas consultas seguidas. Esperá un momento." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Parámetros inválidos", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const { limit, cursor } = parsed.data;

  const { childId } = await params;
  const link = await findOwnedChild(guard.user.id, childId, OWNED_CHILD_SELECT);
  if (!link) return NOT_FOUND();

  // Paginación por cursor: se pide limit+1 para saber si hay una página más sin
  // un count() extra. Orden estable (createdAt desc, id desc como desempate).
  const rows = await prisma.safetyEvent.findMany({
    where: { userId: childId },
    // SOLO metadata: nunca conversationId ni ningún campo con texto del menor.
    select: { id: true, category: true, layer: true, createdAt: true, notifiedAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return Response.json({
    events: page.map((e) => ({
      category: e.category,
      layer: e.layer,
      createdAt: e.createdAt,
      notifiedAt: e.notifiedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]!.id : null,
  });
}
