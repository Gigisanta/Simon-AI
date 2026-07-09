"use client";

import Link from "next/link";
import { SimonAvatar } from "@/components/simon-avatar";

export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-cream px-4 text-center">
      <SimonAvatar className="size-16" />
      <p className="max-w-sm text-base text-ink">
        Algo salió mal, pero tu conversación está guardada.
      </p>
      <div className="flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-11 rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
        >
          Volver a intentar
        </button>
        <Link
          href="/"
          className="min-h-11 inline-flex items-center text-sm font-semibold text-brand-strong underline-offset-2 hover:underline"
        >
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
