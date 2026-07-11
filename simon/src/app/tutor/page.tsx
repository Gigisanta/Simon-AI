import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { usernameFromEmail } from "@/lib/guardian";
import { TutorPanel, type ChildRow } from "@/components/tutor-panel";
import { SiteHeader } from "@/components/site-header";
import { BottomNav } from "@/components/bottom-nav";

// Datos por sesión: nunca cachear.
export const dynamic = "force-dynamic";

export default async function TutorPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  // Solo tutores autenticados. El menor no tiene acceso a este panel.
  if (!session) redirect("/");
  if (session.user.role !== "guardian") redirect("/");

  const rows = await prisma.guardian.findMany({
    where: { guardianUserId: session.user.id },
    select: {
      consentAt: true,
      alertsEnabled: true,
      childUser: { select: { id: true, name: true, email: true, birthYear: true, hasDiagnosis: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const children: ChildRow[] = rows.map((r) => ({
    id: r.childUser.id,
    name: r.childUser.name,
    username: usernameFromEmail(r.childUser.email),
    birthYear: r.childUser.birthYear,
    consentAt: r.consentAt ? r.consentAt.toISOString() : null,
    alertsEnabled: r.alertsEnabled,
    hasDiagnosis: r.childUser.hasDiagnosis,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <div className="pb-24 md:pb-0">
        <TutorPanel
          initialChildren={children}
          emailVerified={session.user.emailVerified}
          email={session.user.email}
        />
      </div>
      <BottomNav />
    </div>
  );
}
