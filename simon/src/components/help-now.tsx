"use client";

import { useRef, useState } from "react";

type ResourceLite = {
  id: string;
  name: string;
  kind: string;
  province: string;
  localidad: string | null;
  phone: string | null;
  whatsapp: string | null;
  hours: string | null;
  url: string | null;
  notes: string | null;
};

/**
 * Líneas de crisis SIEMPRE presentes (hardcodeadas). No dependen del fetch: si
 * la red falla, el chico igual ve estos números (research-safety §7.3 — los
 * recursos de crisis deben estar permanentemente accesibles). Coinciden con las
 * plantillas de safety.ts §3.3.
 */
const ALWAYS_ON: { label: string; phone: string; note: string }[] = [
  { label: "Emergencias", phone: "911", note: "las 24 hs" },
  { label: "Crisis emocional (CAS)", phone: "135 · 0800-345-1435", note: "8 a 0 hs · gratis y anónimo" },
  { label: "Niñas, niños y adolescentes", phone: "102", note: "gratuito" },
  { label: "Violencia familiar o sexual", phone: "137", note: "24 hs · gratuito" },
];

function firstDialable(phone: string): string | null {
  const m = phone.match(/[\d][\d\s-]{1,}/);
  if (!m) return null;
  const d = m[0].replace(/[^\d]/g, "");
  return d.length >= 3 ? d : null;
}

/** Botón "Ayuda ahora" + hoja con líneas de crisis y recursos cercanos. */
export function HelpNow() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [resources, setResources] = useState<ResourceLite[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  function open() {
    dialogRef.current?.showModal();
    // Carga best-effort: si falla, quedan las líneas hardcodeadas de ALWAYS_ON.
    if (!loaded) {
      setLoaded(true);
      fetch("/api/resources?kind=crisis,linea,salud_mental", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { resources?: ResourceLite[] } | null) => {
          setResources(data?.resources ?? []);
        })
        .catch(() => setResources([]));
    }
  }

  // Recursos locales (no nacionales): lo que suma valor por encima de las líneas.
  const local = (resources ?? []).filter((r) => r.province !== "nacional");

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-accent/60 bg-peach px-3 text-sm font-bold text-accent-deep transition-colors hover:bg-peach-tint"
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
          <path d="M12 3 4 6v6c0 4.4 3.4 7.6 8 9 4.6-1.4 8-4.6 8-9V6z" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        Ayuda ahora
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="help-now-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-ink/50"
      >
        <div className="p-6">
          <h2 id="help-now-title" className="text-xl font-extrabold text-ink">
            Si la estás pasando mal, pedí ayuda
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            No estás solo/a. Estas líneas atienden gratis. Si hay peligro ahora
            mismo, llamá al <strong>911</strong>.
          </p>

          {/* Líneas siempre presentes */}
          <ul className="mt-4 flex flex-col gap-2">
            {ALWAYS_ON.map((l) => {
              const dial = firstDialable(l.phone);
              return (
                <li
                  key={l.label}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-sand px-4 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-ink">{l.label}</span>
                    <span className="block text-xs text-ink-soft">{l.note}</span>
                  </span>
                  <a
                    href={dial ? `tel:${dial}` : undefined}
                    className="shrink-0 rounded-full bg-brand px-4 py-2 text-sm font-bold text-brand-fg transition-colors hover:bg-brand-strong"
                  >
                    {l.phone}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Recursos locales (si hay validados) */}
          {local.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                Cerca tuyo
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {local.map((r) => {
                  const dial = r.phone ? firstDialable(r.phone) : null;
                  return (
                    <li
                      key={r.id}
                      className="rounded-2xl border border-line bg-card px-4 py-2.5"
                    >
                      <span className="block text-sm font-bold text-ink">{r.name}</span>
                      {r.localidad && (
                        <span className="block text-xs text-ink-soft">{r.localidad}</span>
                      )}
                      {r.phone && (
                        <a
                          href={dial ? `tel:${dial}` : undefined}
                          className="mt-1 inline-flex text-sm font-bold text-brand-strong underline-offset-2 hover:underline"
                        >
                          📞 {r.phone}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <p className="mt-4 text-xs text-ink-soft">
            Simón es una IA y no puede ayudarte como una persona real. Estas
            líneas sí pueden.
          </p>

          <form method="dialog" className="mt-5 flex justify-end">
            <button
              type="submit"
              className="min-h-11 rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
            >
              Cerrar
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
