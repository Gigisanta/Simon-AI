import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SiteHeader } from "@/components/site-header";
import { BottomNav } from "@/components/bottom-nav";
import { LearnExplorer, type KnowledgeCardRow } from "@/components/learn-explorer";

// Datos por sesión: nunca cachear.
export const dynamic = "force-dynamic";

export default async function AprenderPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  // Solo tutores autenticados. El menor no tiene acceso a este mapa.
  if (!session) redirect("/");
  if (session.user.role !== "guardian") redirect("/");

  const rows = await prisma.knowledgeCard.findMany({
    orderBy: [{ category: "asc" }, { title: "asc" }],
    select: {
      id: true,
      slug: true,
      category: true,
      title: true,
      body: true,
      source: true,
      reviewed: true,
    },
  });

  const cards: KnowledgeCardRow[] = rows;

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <div className="pb-24 md:pb-0">
        <LearnExplorer cards={cards} />
      </div>
      <BottomNav />
    </div>
  );
}
