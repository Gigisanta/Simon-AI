/**
 * Directorio "Cerca tuyo": recursos de ayuda REALES (líneas nacionales,
 * hospitales, servicios locales). Disponible para cualquier usuario autenticado
 * (tutor/a o menor) — el menor lo usa desde el botón "Ayuda ahora" del chat.
 *
 * SEGURIDAD DEL DATO: solo se devuelven recursos `reviewed && active`. Un dato
 * provincial sin validar (reviewed:false) NUNCA sale al usuario: un teléfono mal
 * puede dejar a una familia sin ayuda. No es dato sensible (directorio público),
 * pero igual exige sesión para no exponer el endpoint abiertamente.
 *
 * Provincia: si no viene por query, se infiere de la sesión (la del vínculo
 * Guardian del usuario). Siempre se incluyen los recursos "nacional" junto a los
 * de la provincia, para que las líneas de crisis estén presentes en todos lados.
 */
import { requireSession } from "@/lib/require-session";
import { prisma } from "@/lib/prisma";

const MAX_RESULTS = 200;
const VALID_KINDS = new Set([
  "crisis",
  "salud_mental",
  "discapacidad",
  "escuela",
  "linea",
  "ong",
]);

/** Provincia del usuario según su vínculo de tutela (tutor o menor). */
async function inferProvince(userId: string, role?: string | null): Promise<string | null> {
  const link =
    role === "child"
      ? await prisma.guardian.findFirst({
          where: { childUserId: userId },
          select: { province: true },
        })
      : await prisma.guardian.findFirst({
          where: { guardianUserId: userId },
          select: { province: true },
          orderBy: { createdAt: "asc" },
        });
  return link?.province ?? null;
}

export async function GET(req: Request) {
  const { session, response } = await requireSession(req);
  if (!session) return response;

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const localidad = url.searchParams.get("localidad")?.trim() || "";
  // kind admite CSV ("crisis,linea"); se filtran valores desconocidos.
  const kinds = (url.searchParams.get("kind") || "")
    .split(",")
    .map((k) => k.trim())
    .filter((k) => VALID_KINDS.has(k));

  const provinceParam = url.searchParams.get("province")?.trim() || "";
  const province =
    provinceParam || (await inferProvince(session.user.id, session.user.role));

  // Provincia solicitada + "nacional" (las líneas de crisis van en todos lados).
  const provinces = province && province !== "nacional"
    ? [province, "nacional"]
    : ["nacional"];

  const resources = await prisma.helpResource.findMany({
    where: {
      active: true,
      reviewed: true,
      province: { in: provinces },
      ...(kinds.length ? { kind: { in: kinds } } : {}),
      ...(localidad ? { localidad: { contains: localidad, mode: "insensitive" } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
              { localidad: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      name: true,
      kind: true,
      province: true,
      localidad: true,
      address: true,
      phone: true,
      whatsapp: true,
      hours: true,
      cost: true,
      takesChildren: true,
      noAppointment: true,
      url: true,
      notes: true,
    },
    // "nacional" al final para que lo local (más cercano) aparezca primero.
    orderBy: [{ province: "desc" }, { name: "asc" }],
    take: MAX_RESULTS,
  });

  return Response.json({ province: province ?? "nacional", resources });
}
