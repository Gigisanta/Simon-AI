import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { usernameFromEmail } from "@/lib/guardian";
import { TutorPanel, type ChildRow } from "@/components/tutor-panel";

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
    <div className="flex flex-1 flex-col bg-stone-50 dark:bg-stone-950">
      <header className="flex items-center justify-between border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <span className="font-semibold text-stone-900 dark:text-stone-50">Simón</span>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm text-stone-700 underline-offset-2 hover:underline dark:text-stone-300"
        >
          Volver al chat
        </Link>
      </header>
      <TutorPanel initialChildren={children} emailVerified={session.user.emailVerified} />
    </div>
  );
}
