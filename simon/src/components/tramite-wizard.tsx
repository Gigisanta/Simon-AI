"use client";

import { useState } from "react";
import type { TramiteRequirement, TramiteStep, TramiteStatus } from "@/lib/tramites";

type SaveState = "idle" | "saving" | "saved" | "error";

export function TramiteWizard({
  slug,
  requirements,
  steps,
  reviewed,
  source,
  sourceUrl,
  initialStatus,
  initialStep,
  initialChecked,
}: {
  slug: string;
  requirements: TramiteRequirement[];
  steps: TramiteStep[];
  reviewed: boolean;
  source: string | null;
  sourceUrl: string | null;
  initialStatus: TramiteStatus;
  initialStep: number;
  initialChecked: number[];
}) {
  const total = steps.length;
  const [status, setStatus] = useState<TramiteStatus>(initialStatus);
  const [checked, setChecked] = useState<number[]>(initialChecked);
  // Paso alcanzado (1-based) y el índice que se está viendo (0-based).
  const [furthest, setFurthest] = useState(Math.min(Math.max(initialStep, 0), total));
  const [activeIndex, setActiveIndex] = useState(
    Math.min(Math.max(initialStep - 1, 0), Math.max(total - 1, 0)),
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");

  async function persist(next: {
    checkedItems: number[];
    currentStep: number;
    status: TramiteStatus;
  }) {
    setSaveState("saving");
    try {
      const res = await fetch("/api/tramites/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, ...next }),
      });
      setSaveState(res.ok ? "saved" : "error");
    } catch {
      setSaveState("error");
    }
  }

  function toggle(i: number) {
    const next = checked.includes(i)
      ? checked.filter((n) => n !== i)
      : [...checked, i].sort((a, b) => a - b);
    setChecked(next);
    void persist({ checkedItems: next, currentStep: furthest, status });
  }

  function goTo(index: number) {
    const clamped = Math.min(Math.max(index, 0), Math.max(total - 1, 0));
    setActiveIndex(clamped);
    const nextFurthest = Math.max(furthest, clamped + 1);
    setFurthest(nextFurthest);
    void persist({ checkedItems: checked, currentStep: nextFurthest, status });
  }

  function complete() {
    setStatus("done");
    setFurthest(total);
    void persist({ checkedItems: checked, currentStep: total, status: "done" });
  }

  function reopen() {
    setStatus("in_progress");
    void persist({ checkedItems: checked, currentStep: furthest, status: "in_progress" });
  }

  const step = steps[activeIndex];

  return (
    <div className="mt-6 flex flex-col gap-6">
      {!reviewed && (
        <div className="rounded-2xl border border-accent/60 bg-peach p-3 text-sm text-accent-deep">
          Información <strong>orientativa</strong>, en revisión. Los requisitos y
          pasos pueden variar por provincia y actualizarse: confirmá siempre en la
          fuente oficial.
        </div>
      )}

      {status === "done" && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-brand/40 bg-brand-soft p-4 text-sm text-ink">
          <span className="font-bold">Marcaste este trámite como completado 🌱</span>
          <button
            type="button"
            onClick={reopen}
            className="min-h-11 shrink-0 rounded-full border border-line bg-card px-4 font-semibold text-ink hover:bg-sand"
          >
            Reabrir
          </button>
        </div>
      )}

      {/* Requisitos (checklist) */}
      {requirements.length > 0 && (
        <section>
          <h2 className="text-sm font-bold text-ink">Documentación a reunir</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {requirements.map((r, i) => {
              const on = checked.includes(i);
              return (
                <li key={i}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-card p-3">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(i)}
                      className="mt-0.5 size-5 shrink-0 accent-brand"
                    />
                    <span>
                      <span
                        className={`block text-sm font-semibold ${on ? "text-ink-soft line-through" : "text-ink"}`}
                      >
                        {r.label}
                      </span>
                      {r.detail && (
                        <span className="block text-sm text-ink-soft">{r.detail}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Pasos (stepper) */}
      {total > 0 && step && (
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">
              Paso {activeIndex + 1} de {total}
            </h2>
            <span className="text-xs text-ink-soft" aria-live="polite">
              {saveState === "saving"
                ? "Guardando…"
                : saveState === "saved"
                  ? "Guardado"
                  : saveState === "error"
                    ? "No se pudo guardar"
                    : ""}
            </span>
          </div>

          {/* Barra de progreso */}
          <div className="mt-2 flex gap-1" aria-hidden="true">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${
                  i < furthest ? "bg-brand" : "bg-line"
                }`}
              />
            ))}
          </div>

          <div className="mt-4 rounded-card border border-line bg-card p-5 shadow-sm">
            <p className="text-base font-bold text-ink">{step.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{step.detail}</p>
            {step.where && (
              <p className="mt-2 text-sm text-ink-soft">
                <strong className="text-ink">Dónde:</strong> {step.where}
              </p>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => goTo(activeIndex - 1)}
              disabled={activeIndex === 0}
              className="min-h-11 rounded-full border border-line bg-card px-4 text-sm font-bold text-ink hover:bg-sand disabled:opacity-40"
            >
              Anterior
            </button>
            {activeIndex < total - 1 ? (
              <button
                type="button"
                onClick={() => goTo(activeIndex + 1)}
                className="min-h-11 rounded-full bg-brand px-5 text-sm font-bold text-brand-fg hover:bg-brand-strong"
              >
                Siguiente
              </button>
            ) : (
              status !== "done" && (
                <button
                  type="button"
                  onClick={complete}
                  className="min-h-11 rounded-full bg-brand px-5 text-sm font-bold text-brand-fg hover:bg-brand-strong"
                >
                  Marcar como completado
                </button>
              )
            )}
          </div>
        </section>
      )}

      {sourceUrl && (
        <p className="text-sm text-ink-soft">
          Fuente oficial:{" "}
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold text-brand-strong underline-offset-2 hover:underline"
          >
            {source ?? "sitio oficial"}
          </a>
        </p>
      )}
    </div>
  );
}
