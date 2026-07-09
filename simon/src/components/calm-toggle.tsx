"use client";

import { useSyncExternalStore } from "react";

/**
 * Toggle manual de "modo calma" (research-ux §1.5 / §1.6 item 3):
 * independiente de prefers-reduced-motion porque en dispositivos compartidos
 * (tablet familiar) la preferencia del OS no es por usuario. Activa data-calm
 * en <html> (ver globals.css) y persiste en localStorage. Un script inline en
 * layout.tsx lo re-aplica antes del primer paint.
 *
 * La fuente de verdad es el atributo data-calm del DOM (lo setea el script
 * inline antes de hidratar), así que se lee con useSyncExternalStore.
 */

const STORAGE_KEY = "simon-calm";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-calm"],
  });
  return () => observer.disconnect();
}

function getSnapshot() {
  return document.documentElement.hasAttribute("data-calm");
}

export function CalmToggle() {
  const calm = useSyncExternalStore(subscribe, getSnapshot, () => false);

  function toggle() {
    const next = !calm;
    if (next) {
      document.documentElement.setAttribute("data-calm", "");
    } else {
      document.documentElement.removeAttribute("data-calm");
    }
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // sin localStorage (modo privado): el toggle vale solo para esta visita
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={calm}
      aria-label="Modo calma"
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-bold transition-colors lg:px-4 ${
        calm
          ? "border-brand bg-brand-soft text-brand-strong"
          : "border-line bg-card text-ink-soft hover:border-brand hover:text-brand-strong"
      }`}
    >
      {/* Media luna geométrica */}
      <svg
        viewBox="0 0 24 24"
        fill={calm ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="size-4 shrink-0"
      >
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />
      </svg>
      {/* Icon-only en pantallas chicas: el aria-label mantiene el nombre accesible */}
      <span className="hidden lg:inline">Modo calma</span>
    </button>
  );
}
