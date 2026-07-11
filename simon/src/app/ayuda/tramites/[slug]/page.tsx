import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  asRequirements,
  asSteps,
  asCheckedItems,
  clampStep,
  type TramiteStatus,
} from "@/lib/tramites";
import { SiteHeader } from "@/components/site-header";
import { BottomNav } from "@/components/bottom-nav";
import { TramiteWizard } from "@/components/tramite-wizard";

export const dynamic = "force-dynamic";

export default async function TramiteDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/");
  if (session.user.role !== "guardian") redirect("/");

  const { slug } = await params;

  const [guide, progress] = await Promise.all([
    prisma.tramiteGuide.findFirst({
      where: { slug, active: true },
      select: {
        slug: true,
        title: true,
        summary: true,
        estimatedTime: true,
        requirements: true,
        steps: true,
        source: true,
        sourceUrl: true,
        reviewed: true,
      },
    }),
    prisma.tramiteProgress.findUnique({
      where: {
        guardianUserId_guideSlug: { guardianUserId: session.user.id, guideSlug: slug },
      },
      select: { status: true, currentStep: true, checkedItems: true },
    }),
  ]);

  if (!guide) notFound();

  const requirements = asRequirements(guide.requirements);
  const steps = asSteps(guide.steps);

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <div className="pb-24 md:pb-0">
        <div className="mx-auto w-full max-w-2xl px-4 py-8">
          <Link
            href="/ayuda/tramites"
            className="inline-flex text-sm font-bold text-brand-strong underline-offset-2 hover:underline"
          >
            ← Todos los trámites
          </Link>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-ink">
            {guide.title}
          </h1>
          <p className="mt-2 text-base text-ink-soft">{guide.summary}</p>
          {guide.estimatedTime && (
            <p className="mt-1 text-sm text-ink-soft">⏱ Tiempo estimado: {guide.estimatedTime}</p>
          )}

          <TramiteWizard
            slug={guide.slug}
            requirements={requirements}
            steps={steps}
            reviewed={guide.reviewed}
            source={guide.source}
            sourceUrl={guide.sourceUrl}
            initialStatus={(progress?.status as TramiteStatus) ?? "in_progress"}
            initialStep={clampStep(progress?.currentStep ?? 0, steps.length)}
            initialChecked={asCheckedItems(progress?.checkedItems)}
          />
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
