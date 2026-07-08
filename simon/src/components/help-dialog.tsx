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
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-teal-700 bg-teal-50 px-3 text-sm font-medium text-teal-900 hover:bg-teal-100 calm:border-stone-400 calm:bg-stone-100 calm:text-stone-800 calm:hover:bg-stone-200 dark:border-teal-500 dark:bg-teal-950 dark:text-teal-100 dark:hover:bg-teal-900 dark:calm:border-stone-500 dark:calm:bg-stone-900 dark:calm:text-stone-200"
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
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-950/50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
      >
        <div className="p-6">
          <h2
            id="help-dialog-title"
            className="text-lg font-bold text-stone-900 dark:text-stone-50"
          >
            Ayuda urgente
          </h2>
          <p className="mt-2 text-base text-stone-700 dark:text-stone-300">
            Si estás en peligro o la estás pasando muy mal, estas líneas te
            pueden ayudar ahora. Son gratuitas y podés llamar vos.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {RESOURCE_ITEMS.map((item) => (
              <li
                key={item}
                className="rounded-lg bg-stone-100 px-3 py-2 text-base text-stone-800 dark:bg-stone-800 dark:text-stone-200"
              >
                {item}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-base font-medium text-teal-900 calm:text-stone-800 dark:text-teal-200 dark:calm:text-stone-200">
            {URGENT_LINE}
          </p>
          <form method="dialog" className="mt-6 flex justify-end">
            <button
              type="submit"
              className="min-h-11 rounded-full bg-stone-900 px-5 text-base font-medium text-white hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              Cerrar
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
