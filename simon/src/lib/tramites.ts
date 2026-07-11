/**
 * "Mis trámites" — tipos y lógica PURA del asistente guiado.
 *
 * Las guías (TramiteGuide) son contenido ORIENTATIVO: siempre remiten a la
 * fuente oficial. No son asesoramiento legal. El progreso (TramiteProgress) es
 * lo que vuelve "asistente" a las fichas: recuerda el paso y los documentos.
 *
 * Núcleo puro y testeable (scripts/tramites-suite.ts): sanea el progreso contra
 * la forma de la guía (clamp del paso, dedupe/rango de los tildados).
 */

export type TramiteRequirement = { label: string; detail?: string };
export type TramiteStep = { title: string; detail: string; where?: string };

export type TramiteStatus = "in_progress" | "done" | "dismissed";

/** Lee de forma segura el JSON de requisitos de una guía (Prisma → unknown). */
export function asRequirements(json: unknown): TramiteRequirement[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (r): r is TramiteRequirement =>
      !!r && typeof r === "object" && typeof (r as { label?: unknown }).label === "string",
  );
}

/** Lee de forma segura el JSON de pasos de una guía. */
export function asSteps(json: unknown): TramiteStep[] {
  if (!Array.isArray(json)) return [];
  return json.filter(
    (s): s is TramiteStep =>
      !!s &&
      typeof s === "object" &&
      typeof (s as { title?: unknown }).title === "string" &&
      typeof (s as { detail?: unknown }).detail === "string",
  );
}

/** Lee de forma segura los índices tildados persistidos (Prisma Json). */
export function asCheckedItems(json: unknown): number[] {
  if (!Array.isArray(json)) return [];
  return json.filter((n): n is number => Number.isInteger(n));
}

/**
 * Clampa el paso actual a [0, totalSteps]. `totalSteps` (igual a la cantidad de
 * pasos) representa "pasó el último" = completado.
 */
export function clampStep(step: number, totalSteps: number): number {
  if (!Number.isInteger(step)) return 0;
  if (step < 0) return 0;
  if (step > totalSteps) return totalSteps;
  return step;
}

/** Normaliza los índices tildados: enteros en [0, reqCount), únicos y ordenados. */
export function normalizeChecked(indices: number[], reqCount: number): number[] {
  const seen = new Set<number>();
  for (const i of indices) {
    if (Number.isInteger(i) && i >= 0 && i < reqCount) seen.add(i);
  }
  return [...seen].sort((a, b) => a - b);
}

export type ProgressInput = {
  currentStep: number;
  checkedItems: number[];
  status: TramiteStatus;
};

/** Sanea el progreso entrante contra la forma real de la guía. Puro. */
export function sanitizeProgress(
  input: ProgressInput,
  guide: { requirements: TramiteRequirement[]; steps: TramiteStep[] },
): ProgressInput {
  return {
    currentStep: clampStep(input.currentStep, guide.steps.length),
    checkedItems: normalizeChecked(input.checkedItems, guide.requirements.length),
    status: input.status,
  };
}

/** Etiqueta legible del progreso (para tarjetas y encabezados). */
export function progressLabel(
  status: TramiteStatus,
  currentStep: number,
  totalSteps: number,
): string {
  if (status === "done") return "Completado";
  if (currentStep <= 0) return "Sin empezar";
  const shown = Math.min(currentStep, totalSteps);
  return `Paso ${shown} de ${totalSteps}`;
}

/** Porcentaje 0–100 (pasos completados / total). */
export function progressPercent(currentStep: number, totalSteps: number): number {
  if (totalSteps <= 0) return 0;
  return Math.round((Math.min(Math.max(currentStep, 0), totalSteps) / totalSteps) * 100);
}
