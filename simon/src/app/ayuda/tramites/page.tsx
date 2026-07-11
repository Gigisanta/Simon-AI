import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { asSteps, progressLabel, type TramiteStatus } from "@/lib/tramites";
import { SiteHeader } from "@/components/site-header";
import { BottomNav } from "@/components/bottom-nav";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  cud: "CUD",
  pension: "Pensión",
  transporte: "Transporte",
  escolaridad: "Escuela",
  salud: "Salud",
};

export default async function TramitesPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/");
  if (session.user.role !== "guardian") redirect("/");

  const [guides, progressRows] = await Promise.all([
    prisma.tramiteGuide.findMany({
      where: { active: true },
      select: { slug: true, title: true, summary: true, category: true, estimatedTime: true, steps: true, reviewed: true },
      orderBy: [{ category: "asc" }, { title: "asc" }],
    }),
    prisma.tramiteProgress.findMany({
      where: { guardianUserId: session.user.id },
      select: { guideSlug: true, status: true, currentStep: true },
    }),
  ]);

  const progressBySlug = new Map(progressRows.map((p) => [p.guideSlug, p]));

  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />
      <div className="pb-24 md:pb-0">
        <div className="mx-auto w-full max-w-5xl px-4 py-8">
          <h1 className="text-4xl font-extrabold tracking-tight text-ink">Mis trámites</h1>
          <p className="mt-2 max-w-2xl text-base text-ink-soft">
            Guías paso a paso para los trámites de discapacidad. Simón recuerda por
            dónde vas. Es información orientativa: siempre confirmá en la fuente
            oficial de cada guía.
          </p>

          {guides.length === 0 ? (
            <p className="mt-10 text-center text-base text-ink-soft">
              Todavía no hay guías cargadas.
            </p>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {guides.map((g) => {
                const total = asSteps(g.steps).length;
                const prog = progressBySlug.get(g.slug);
                const label = progressLabel(
                  (prog?.status as TramiteStatus) ?? "in_progress",
                  prog?.currentStep ?? 0,
                  total,
                );
                const started = !!prog && prog.status !== "dismissed";
                return (
                  <Link
                    key={g.slug}
                    href={`/ayuda/tramites/${g.slug}`}
                    className="flex flex-col rounded-card border border-line bg-card p-5 shadow-[0_10px_30px_-12px_rgb(57_53_41/0.15)] transition-[transform,box-shadow] motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_16px_36px_-14px_rgb(57_53_41/0.22)]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-brand-strong">
                        {CATEGORY_LABELS[g.category] ?? g.category}
                      </span>
                      {!g.reviewed && (
                        <span className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-bold text-ink-soft">
                          Orientativo
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-base font-bold text-ink">{g.title}</p>
                    <p className="mt-1 flex-1 text-sm text-ink-soft">{g.summary}</p>
                    <span
                      className={`mt-3 inline-flex w-fit rounded-full px-3 py-1 text-xs font-bold ${
                        prog?.status === "done"
                          ? "bg-brand text-brand-fg"
                          : started
                            ? "bg-brand-soft text-brand-strong"
                            : "bg-sand text-ink-soft"
                      }`}
                    >
                      {prog?.status === "done" ? "Completado" : started ? label : "Empezar"}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
