/**
 * Progreso del tutor/a en un trámite guiado ("Mis trámites").
 * POST → upsert del progreso (paso actual, requisitos tildados, estado) para una
 * guía. Solo tutores; el progreso es del tutor/a (no hay datos del menor acá).
 * El paso y los tildados se SANEAN contra la forma real de la guía (lib/tramites).
 */
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireGuardian } from "@/lib/guardian-auth";
import { sameOriginOk } from "@/lib/env-check";
import { asRequirements, asSteps, sanitizeProgress } from "@/lib/tramites";
import { z } from "zod";

const RATE_LIMIT_PER_MINUTE = 40;

const progressSchema = z.object({
  slug: z.string().min(1).max(80),
  currentStep: z.number().int().min(0).max(100),
  checkedItems: z.array(z.number().int()).max(100),
  status: z.enum(["in_progress", "done", "dismissed"]),
});

export async function POST(req: Request) {
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const guard = await requireGuardian(req, { requireVerifiedEmail: false });
  if (!guard.ok) return guard.response;

  const rl = await checkRateLimit(
    `tramites:progress:${guard.user.id}`,
    RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  if (!rl.ok) {
    return Response.json(
      { error: "Demasiados cambios seguidos. Esperá un momento." },
      { status: 429, headers: { "retry-after": String(rl.retryAfterSeconds) } },
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Body inválido" }, { status: 400 });
  }
  const parsed = progressSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Datos inválidos", details: z.flattenError(parsed.error).fieldErrors },
      { status: 400 },
    );
  }
  const { slug, currentStep, checkedItems, status } = parsed.data;

  // La guía tiene que existir y estar activa (además define la forma para sanear).
  const guide = await prisma.tramiteGuide.findFirst({
    where: { slug, active: true },
    select: { requirements: true, steps: true },
  });
  if (!guide) {
    return Response.json({ error: "Trámite no encontrado." }, { status: 404 });
  }

  const clean = sanitizeProgress(
    { currentStep, checkedItems, status },
    { requirements: asRequirements(guide.requirements), steps: asSteps(guide.steps) },
  );

  await prisma.tramiteProgress.upsert({
    where: {
      guardianUserId_guideSlug: { guardianUserId: guard.user.id, guideSlug: slug },
    },
    update: {
      status: clean.status,
      currentStep: clean.currentStep,
      checkedItems: clean.checkedItems,
    },
    create: {
      guardianUserId: guard.user.id,
      guideSlug: slug,
      status: clean.status,
      currentStep: clean.currentStep,
      checkedItems: clean.checkedItems,
    },
  });

  return Response.json({ ok: true, progress: clean });
}
