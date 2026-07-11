"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Bienestar": herramientas de autorregulación del menor en un solo lugar
 * (research-safety §4 — psicoeducación, NO terapia). Tres pestañas:
 *  - Respirar: respiración guiada 4-4-4-4 (box breathing).
 *  - Anclar: grounding 5-4-3-2-1 (los sentidos).
 *  - Mi diario: check-in de ánimo (valencia 1–3) + tendencia reciente.
 * Todo respeta "reducir movimiento" (modo calma / OS): sin animación, guía por texto.
 */

type Tab = "respirar" | "anclar" | "diario";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.hasAttribute("data-calm")
  );
}

// ---------- Respirar (4-4-4-4) ----------

const BREATH_PHASES = [
  { key: "in", label: "Inhalá", scale: 1 },
  { key: "hold1", label: "Sostené", scale: 1 },
  { key: "out", label: "Exhalá", scale: 0.55 },
  { key: "hold2", label: "Sostené", scale: 0.55 },
] as const;

const PHASE_MS = 4000;

function Breathing() {
  const [phase, setPhase] = useState(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setPhase((p) => (p + 1) % BREATH_PHASES.length);
    }, PHASE_MS);
    return () => clearInterval(id);
  }, [reduced]);

  const current = BREATH_PHASES[phase];

  if (reduced) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <p className="text-base font-bold text-ink">Respiración 4-4-4-4</p>
        <ol className="flex flex-col gap-1.5 text-base text-ink-soft">
          <li>1. Inhalá contando hasta 4.</li>
          <li>2. Sostené el aire contando hasta 4.</li>
          <li>3. Exhalá contando hasta 4.</li>
          <li>4. Esperá contando hasta 4. Repetí unas veces.</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-5 py-6">
      <div className="flex h-52 w-52 items-center justify-center">
        <div
          className="flex size-40 items-center justify-center rounded-full bg-brand-soft"
          style={{
            transform: `scale(${current.scale})`,
            transition: `transform ${PHASE_MS}ms ease-in-out`,
          }}
        >
          <span aria-live="polite" className="text-lg font-extrabold text-brand-strong">
            {current.label}
          </span>
        </div>
      </div>
      <p className="text-sm text-ink-soft">Seguí el círculo con tu respiración.</p>
    </div>
  );
}

// ---------- Anclar (5-4-3-2-1) ----------

const GROUNDING_STEPS = [
  { n: 5, text: "cosas que puedas VER a tu alrededor" },
  { n: 4, text: "cosas que puedas TOCAR" },
  { n: 3, text: "sonidos que puedas ESCUCHAR" },
  { n: 2, text: "cosas que puedas OLER" },
  { n: 1, text: "cosa que puedas SABOREAR (o algo lindo de vos)" },
] as const;

function Grounding() {
  const [step, setStep] = useState(0);
  const done = step >= GROUNDING_STEPS.length;

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-base font-bold text-ink">Muy bien 🌱</p>
        <p className="text-base text-ink-soft">
          Volviste al presente. Podés repetirlo cuando quieras.
        </p>
        <button
          type="button"
          onClick={() => setStep(0)}
          className="mt-1 min-h-11 rounded-full border border-line bg-card px-5 text-sm font-bold text-ink hover:bg-sand"
        >
          Empezar de nuevo
        </button>
      </div>
    );
  }

  const s = GROUNDING_STEPS[step];
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <span className="flex size-20 items-center justify-center rounded-full bg-brand-soft text-4xl font-extrabold text-brand-strong">
        {s.n}
      </span>
      <p className="max-w-xs text-lg font-semibold text-ink">
        Nombrá {s.n} {s.text}.
      </p>
      <button
        type="button"
        onClick={() => setStep((n) => n + 1)}
        className="min-h-11 rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
      >
        {step === GROUNDING_STEPS.length - 1 ? "Terminar" : "Siguiente"}
      </button>
      <span className="text-xs text-ink-soft">
        Paso {step + 1} de {GROUNDING_STEPS.length}
      </span>
    </div>
  );
}

// ---------- Mi diario ----------

type MoodEntry = { value: number; context: string; createdAt: string };

const FACES = [
  { value: 3, label: "Bien", circle: "bg-brand-soft text-brand-strong" },
  { value: 2, label: "Más o menos", circle: "bg-sand text-ink-soft" },
  { value: 1, label: "Mal", circle: "bg-peach text-accent-deep" },
] as const;

function faceFor(value: number): (typeof FACES)[number] {
  return FACES.find((f) => f.value === value) ?? FACES[1];
}

function FaceIcon({ value }: { value: number }) {
  // Boca según la valencia: sonrisa (3), recta (2), triste (1).
  const mouth =
    value === 3 ? "M8 14c1.2 1.5 6.8 1.5 8 0" : value === 1 ? "M8 15c1.2-1.5 6.8-1.5 8 0" : "M8 14.5h8";
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-6"
    >
      <circle cx="9" cy="10" r="0.6" fill="currentColor" />
      <circle cx="15" cy="10" r="0.6" fill="currentColor" />
      <path d={mouth} />
    </svg>
  );
}

function Diario() {
  const [entries, setEntries] = useState<MoodEntry[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [thanks, setThanks] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/mood", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { entries?: MoodEntry[] };
      setEntries(data.entries ?? []);
    } catch {
      setEntries([]);
    }
  }

  // Carga al montar (mismo patrón que chat.tsx: IIFE async + flag cancelled, para
  // no llamar setState sincrónicamente en el cuerpo del effect).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/mood", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { entries?: MoodEntry[] };
        if (!cancelled) setEntries(data.entries ?? []);
      } catch {
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function pick(value: number) {
    if (saving) return;
    setSaving(true);
    setThanks(false);
    try {
      const res = await fetch("/api/mood", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value, context: "manual" }),
      });
      if (res.ok) {
        setThanks(true);
        await load();
      }
    } catch {
      // silencioso: el check-in no debe romper nada
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-base font-bold text-ink">¿Cómo estás ahora?</p>
        <div className="flex justify-center gap-3">
          {FACES.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => pick(f.value)}
              disabled={saving}
              aria-label={f.label}
              className="flex flex-col items-center gap-1.5 disabled:opacity-50"
            >
              <span
                className={`flex size-14 items-center justify-center rounded-full ${f.circle} transition-transform motion-safe:hover:-translate-y-0.5`}
              >
                <FaceIcon value={f.value} />
              </span>
              <span className="text-xs font-bold text-ink-soft">{f.label}</span>
            </button>
          ))}
        </div>
        {thanks && (
          <p className="text-sm font-semibold text-brand-strong">
            Gracias por contarme. Lo anoté en tu diario 🌱
          </p>
        )}
      </div>

      {/* Tendencia */}
      <div className="border-t border-line pt-4">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
          Tus últimos días
        </p>
        {entries === null ? (
          <p className="mt-2 text-sm text-ink-soft">Cargando…</p>
        ) : entries.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">
            Todavía no anotaste nada. Elegí una carita para empezar.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entries
              .slice()
              .reverse()
              .map((e, i) => {
                const f = faceFor(e.value);
                return (
                  <span
                    key={i}
                    title={new Date(e.createdAt).toLocaleDateString("es-AR")}
                    className={`flex size-7 items-center justify-center rounded-full ${f.circle}`}
                  >
                    <FaceIcon value={e.value} />
                  </span>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Contenedor ----------

const TABS: { key: Tab; label: string }[] = [
  { key: "respirar", label: "Respirar" },
  { key: "anclar", label: "Anclar" },
  { key: "diario", label: "Mi diario" },
];

export function Bienestar() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>("respirar");
  const [open, setOpen] = useState(false);

  function openDialog() {
    setTab("respirar");
    setOpen(true);
    dialogRef.current?.showModal();
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-label="Bienestar: respirar, anclar y mi diario"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-card px-2.5 text-sm font-bold text-ink-soft transition-colors hover:border-brand hover:text-brand-strong sm:px-3"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-4"
        >
          <path d="M12 21c-4-2.5-7-6-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 4-3 7.5-7 10z" />
          <path d="M12 8v6M9 11h6" />
        </svg>
        <span className="hidden sm:inline">Calma</span>
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        aria-labelledby="bienestar-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-ink/50"
      >
        {open && (
          <div className="flex flex-col p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 id="bienestar-title" className="text-lg font-extrabold text-ink">
                Un momento para vos
              </h2>
              <form method="dialog">
                <button
                  type="submit"
                  aria-label="Cerrar"
                  className="flex size-9 items-center justify-center rounded-full text-ink-soft hover:bg-sand hover:text-ink"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="size-5"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </form>
            </div>

            {/* Pestañas */}
            <div role="tablist" className="mt-3 flex gap-1 rounded-full bg-sand p-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`min-h-11 flex-1 rounded-full px-2 text-sm font-bold transition-colors ${
                    tab === t.key ? "bg-brand text-brand-fg" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="mt-1">
              {tab === "respirar" && <Breathing />}
              {tab === "anclar" && <Grounding />}
              {tab === "diario" && <Diario />}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
