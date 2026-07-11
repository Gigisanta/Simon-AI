/**
 * Carga de las tarjetas del Puente (server): consulta la metadata de SafetyEvent
 * y el followup por menor, y arma las tarjetas con la lógica pura de bridge.ts.
 * Compartido por la página del tutor y GET /api/guardian/bridge (una sola verdad).
 *
 * PRIVACIDAD: el `select` de SafetyEvent trae SOLO category + createdAt. Nunca
 * conversationId ni contenido (misma invariante que safety-events.ts).
 */
import { prisma } from "@/lib/prisma";
import { BRIDGE_WINDOW_MS, buildBridgeCard, type BridgeCard } from "@/lib/bridge";

const MAX_EVENTS_PER_CHILD = 50;

export async function loadBridgeCards(
  guardianUserId: string,
  now: Date = new Date(),
): Promise<BridgeCard[]> {
  const links = await prisma.guardian.findMany({
    where: { guardianUserId, childUser: { role: "child" } },
    select: { childUser: { select: { id: true, name: true } } },
  });
  if (links.length === 0) return [];

  const windowStart = new Date(now.getTime() - BRIDGE_WINDOW_MS);

  const cards = await Promise.all(
    links.map(async (link) => {
      const child = link.childUser;
      const [events, followup] = await Promise.all([
        prisma.safetyEvent.findMany({
          where: { userId: child.id, createdAt: { gte: windowStart } },
          select: { category: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: MAX_EVENTS_PER_CHILD,
        }),
        prisma.guardianFollowup.findUnique({
          where: {
            guardianUserId_childUserId: { guardianUserId, childUserId: child.id },
          },
          select: { status: true, updatedAt: true },
        }),
      ]);
      return buildBridgeCard(child, events, followup, now);
    }),
  );

  return cards.filter((c): c is BridgeCard => c !== null);
}
