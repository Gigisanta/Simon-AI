"use client";

import { useRef } from "react";
import { CRISIS_RESOURCES_AR } from "@/lib/safety";

/**
 * Botón permanente de ayuda urgente (research-safety §7.3: recursos de crisis
 * siempre accesibles, estilo distinto pero no alarmista). Usa <dialog> nativo:
 * focus trap, Escape y aria-modal vienen dados por showModal().
 * Los recursos se importan de lib/safety.ts — única fuente de los números.
 */

// CRISIS_RESOURCES_AR: 1ª línea = título, "• ..." = recursos, última = urgencia.
const lines = CRISIS_RESOURCES_AR.split("\n");
const RESOURCE_ITEMS = lines
  .filter((l) => l.startsWith("• "))
  .map((l) => l.slice(2));
const URGENT_LINE = lines[lines.length - 1];

export function HelpDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-brand/40 bg-brand-soft px-4 text-sm font-bold text-brand-strong transition-colors hover:bg-brand hover:text-brand-fg"
      >
        {/* Salvavidas geométrico */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
          className="size-4 shrink-0"
        >
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
          <path d="M5.6 5.6 9 9M15 15l3.4 3.4M18.4 5.6 15 9M9 15l-3.4 3.4" />
        </svg>
        ¿Necesitás ayuda urgente?
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="help-dialog-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-card border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-ink/50"
      >
        <div className="p-6">
          <h2 id="help-dialog-title" className="text-lg font-extrabold text-ink">
            Ayuda urgente
          </h2>
          <p className="mt-2 text-base text-ink-soft">
            Si estás en peligro o la estás pasando muy mal, estas líneas te
            pueden ayudar ahora. Son gratuitas y podés llamar vos.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {RESOURCE_ITEMS.map((item) => (
              <li
                key={item}
                className="rounded-2xl bg-sand px-4 py-2.5 text-base text-ink"
              >
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-base font-bold text-brand-strong">
            {URGENT_LINE}
          </p>
          <form method="dialog" className="mt-6 flex justify-end">
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
