import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { usernameFromEmail } from "@/lib/guardian";
import { TutorPanel, type ChildRow } from "@/components/tutor-panel";
import { SimonAvatar } from "@/components/simon-avatar";

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
      childUser: { select: { id: true, name: true, email: true, birthYear: true } },
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
  }));

  return (
    <div className="flex flex-1 flex-col bg-cream">
      <header className="flex items-center justify-between border-b border-line bg-cream/90 px-4 py-2.5">
        <span className="flex items-center gap-2.5">
          <SimonAvatar className="size-9" />
          <span className="flex flex-col leading-tight">
            <span className="text-lg font-extrabold text-ink">Simón</span>
            <span className="text-xs text-ink-soft">Acompañamos cada paso</span>
          </span>
        </span>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm font-bold text-ink transition-colors hover:border-brand hover:text-brand-strong"
        >
          Volver al chat
        </Link>
      </header>
      <TutorPanel initialChildren={children} emailVerified={session.user.emailVerified} />
    </div>
  );
}
