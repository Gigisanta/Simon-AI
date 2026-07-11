import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { BottomNav } from "@/components/bottom-nav";
import { ResourceExplorer, type ResourceRow } from "@/components/resource-explorer";

// Datos por sesión: nunca cachear.
export const dynamic = "force-dynamic";

export default async function CercaTuyoPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  // Solo tutores autenticados (el menor accede a los recursos por el botón
  // "Ayuda ahora" del chat, no a este directorio completo).
  if (!session) redirect("/");
  if (session.user.role !== "guardian") redirect("/");

  // Provincia de la familia (del primer vínculo de tutela); null = solo nacional.
  const link = await prisma.guardian.findFirst({
    where: { guardianUserId: session.user.id },
    select: { province: true },
    orderBy: { createdAt: "asc" },
  });
  const province = link?.province ?? "nacional";
  const provinces = province !== "nacional" ? [province, "nacional"] : ["nacional"];

  const rows = await prisma.helpResource.findMany({
    where: { active: true, reviewed: true, province: { in: provinces } },
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
    orderBy: [{ province: "desc" }, { name: "asc" }],
  });

  const resources: ResourceRow[] = rows;

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <div className="pb-24 md:pb-0">
        <ResourceExplorer resources={resources} province={province} />
      </div>
      <BottomNav />
    </div>
  );
}
