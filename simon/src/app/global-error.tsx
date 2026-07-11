"use client";

import { useEffect } from "react";
import { SimonAvatar } from "@/components/simon-avatar";
import "./globals.css";

// global-error reemplaza al root layout cuando el propio layout falla, así que
// define su <html>/<body>. No hay providers ni fuentes del layout disponibles;
// solo dependemos de globals.css (tokens de color + Tailwind) y SimonAvatar, que
// se apoya únicamente en variables CSS. Copy/estética espejo de error.tsx, pero
// con recarga completa (no hay `reset` fiable si el árbol raíz cayó).
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error-boundary]", error);
  }, [error]);

  return (
    <html lang="es-AR">
      <body className="min-h-full flex flex-col antialiased">
        <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-cream px-4 text-center">
          <SimonAvatar className="size-16" />
          <p className="max-w-sm text-base text-ink">
            Algo salió mal, pero tu conversación está guardada.
          </p>
          {/* Hard reload a propósito: si el árbol raíz cayó, next/link (soft
              nav) puede no rehidratar; forzamos una navegación completa. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="min-h-11 inline-flex items-center rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
          >
            Volver al chat
          </a>
        </main>
      </body>
    </html>
  );
}
