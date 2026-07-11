"use client";

import { useOnline } from "@/lib/use-online";

/**
 * Aviso no intrusivo de "sin conexión" (research-ux): cuando el navegador pierde
 * la red, aparece una tira sutil arriba; se va sola al volver la conexión. No
 * bloquea la interacción (es solo informativo — el reintento real lo maneja cada
 * request). Accesible: role="status" + aria-live="polite" para que el lector de
 * pantalla lo anuncie sin interrumpir. Cuando hay conexión no renderiza nada.
 *
 * Usa los tokens del design system (accent/peach) — el mismo lenguaje cálido del
 * resto de la app, sin el rojo de `danger` (perder wifi un momento no es un error
 * grave que asuste al menor).
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-50 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-b-xl border border-blush border-t-0 bg-peach px-4 py-1.5 text-sm font-semibold text-accent-deep shadow-card"
    >
      <span aria-hidden="true">📡</span>
      Sin conexión. Estamos esperando que vuelva…
    </div>
  );
}
