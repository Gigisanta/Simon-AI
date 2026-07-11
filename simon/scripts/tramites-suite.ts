/**
 * Suite de "Mis trámites" (lib/tramites.ts): lógica PURA del asistente guiado.
 * Determinística, sin DB. Fija el saneo del progreso (clamp del paso, dedupe/
 * rango de los tildados), las etiquetas y el parseo seguro del JSON de la guía.
 */
import { createChecker } from "./suite-helpers";
import {
  clampStep,
  normalizeChecked,
  sanitizeProgress,
  progressLabel,
  progressPercent,
  asRequirements,
  asSteps,
  asCheckedItems,
} from "../src/lib/tramites";

const c = createChecker("tramites");

// ---------- clampStep ----------
c.check(clampStep(-3, 6) === 0, "paso negativo → 0");
c.check(clampStep(9, 6) === 6, "paso mayor al total → total");
c.check(clampStep(3, 6) === 3, "paso en rango → igual");
c.check(clampStep(2.5, 6) === 0, "paso no entero → 0");

// ---------- normalizeChecked ----------
c.check(
  JSON.stringify(normalizeChecked([2, 0, 2, 1], 4)) === JSON.stringify([0, 1, 2]),
  "dedupe + orden",
);
c.check(
  JSON.stringify(normalizeChecked([0, 5, -1, 3], 4)) === JSON.stringify([0, 3]),
  "descarta fuera de rango",
);
c.check(JSON.stringify(normalizeChecked([1.5, 2], 4)) === JSON.stringify([2]), "descarta no enteros");

// ---------- sanitizeProgress ----------
const guide = {
  requirements: [{ label: "a" }, { label: "b" }],
  steps: [{ title: "s1", detail: "d1" }, { title: "s2", detail: "d2" }, { title: "s3", detail: "d3" }],
};
const clean = sanitizeProgress(
  { currentStep: 99, checkedItems: [0, 9, 1, 1], status: "in_progress" },
  guide,
);
c.check(clean.currentStep === 3, "sanitize: paso clampeado al total (3)");
c.check(JSON.stringify(clean.checkedItems) === JSON.stringify([0, 1]), "sanitize: tildados en rango [0,2)");
c.check(clean.status === "in_progress", "sanitize: status preservado");

// ---------- progressLabel ----------
c.check(progressLabel("done", 2, 6) === "Completado", "done → Completado");
c.check(progressLabel("in_progress", 0, 6) === "Sin empezar", "0 → Sin empezar");
c.check(progressLabel("in_progress", 3, 6) === "Paso 3 de 6", "medio → Paso 3 de 6");
c.check(progressLabel("in_progress", 9, 6) === "Paso 6 de 6", "clampeado en la etiqueta");

// ---------- progressPercent ----------
c.check(progressPercent(3, 6) === 50, "3/6 → 50%");
c.check(progressPercent(0, 6) === 0, "0/6 → 0%");
c.check(progressPercent(6, 6) === 100, "6/6 → 100%");
c.check(progressPercent(1, 0) === 0, "sin pasos → 0%");

// ---------- parseo seguro del JSON ----------
c.check(asRequirements([{ label: "x" }, { nope: 1 }, "bad"]).length === 1, "asRequirements filtra inválidos");
c.check(asSteps([{ title: "t", detail: "d" }, { title: "t" }]).length === 1, "asSteps exige title+detail");
c.check(asRequirements("no-array" as unknown) .length === 0, "asRequirements con no-array → []");
c.check(JSON.stringify(asCheckedItems([1, 2.5, 3, "x"])) === JSON.stringify([1, 3]), "asCheckedItems solo enteros");

c.done();
