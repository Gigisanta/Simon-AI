"use client";

import { AuthForm } from "@/components/auth-form";
import { BottomNav } from "@/components/bottom-nav";
import { Chat } from "@/components/chat";
import { SimonAvatar } from "@/components/simon-avatar";
import { SiteHeader } from "@/components/site-header";
import { useSession } from "@/lib/auth-client";

/** Hoja decorativa suelta (mismo estilo que la ilustración hero), aria-hidden. */
function Leaf({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M4 20 Q4 4 20 4 Q20 16 4 20 Z" />
    </svg>
  );
}

/** Ilustración hero exacta del design system: adulto y niño de la mano. */
function HeroIllustration() {
  return (
    <div className="relative mx-auto w-full max-w-sm">
      <Leaf className="absolute -left-3 -top-4 size-9 text-brand-ill opacity-60" />
      <Leaf className="absolute -right-2 top-2 size-6 rotate-45 text-brand opacity-50" />
      <svg viewBox="0 0 220 150" fill="none" className="h-auto w-full" aria-hidden="true">
        <circle cx="185" cy="32" r="16" fill="var(--color-blush)" opacity="0.85" />
        <ellipse cx="110" cy="136" rx="88" ry="9" fill="var(--color-ill-sand)" />
        <circle cx="82" cy="52" r="15" fill="var(--color-brand-ill)" />
        <path
          d="M82 67 C64 67 58 84 60 104 Q61 118 66 128 L98 128 Q103 118 104 104 C106 84 100 67 82 67 Z"
          fill="var(--color-brand-ill)"
        />
        <circle cx="132" cy="82" r="11" fill="var(--color-ill-terra)" />
        <path
          d="M132 93 C120 93 116 104 117 116 Q118 124 121 128 L143 128 Q146 124 147 116 C148 104 144 93 132 93 Z"
          fill="var(--color-ill-terra)"
        />
        <path
          d="M100 88 Q110 96 119 100"
          stroke="var(--color-ill-line)"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.5"
        />
        <path
          d="M110 68 c2.6 -4.6 9 -2.2 8 2.4 c-0.8 3.4 -5.4 6 -8 7.6 c-2.6 -1.6 -7.2 -4.2 -8 -7.6 c-1 -4.6 5.4 -7 8 -2.4 Z"
          fill="var(--color-ill-terra)"
          opacity="0.9"
        />
        <path
          d="M22 128 Q18 112 32 104 Q34 120 22 128 Z"
          fill="var(--color-ill-leaf)"
          opacity="0.7"
        />
        <path
          d="M198 126 Q206 112 194 102 Q188 116 198 126 Z"
          fill="var(--color-brand-ill)"
          opacity="0.7"
        />
      </svg>
    </div>
  );
}

export default function Home() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    // Shell estable (header + skeleton del chat) para no saltar el layout cuando
    // resuelve la sesión: mismo esqueleto que la vista autenticada.
    return (
      <div className="flex h-dvh flex-col">
        <SiteHeader />
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-3 pb-3 sm:px-4 sm:pb-4">
            <div
              aria-hidden="true"
              className="mt-3 h-9 rounded-2xl border border-accent/60 bg-peach/50 motion-safe:animate-pulse"
            />
            <div
              aria-hidden="true"
              className="mt-3 flex-1 rounded-card border border-line bg-card shadow-card motion-safe:animate-pulse"
            />
            <span className="sr-only" role="status">
              Cargando…
            </span>
          </div>
        </main>
      </div>
    );
  }

  if (!session) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
        <div className="flex max-w-xl flex-col items-center gap-5 text-center">
          <SimonAvatar className="size-16" />
          <HeroIllustration />
          <h1 className="text-3xl font-extrabold leading-[1.25] tracking-[-1px] text-ink sm:text-4xl">
            Llegaste a un lugar que te entiende
          </h1>
          <p className="max-w-md text-base text-ink-soft">
            Simón es un espacio para hablar, entender lo que te pasa y aprender —
            paso a paso, con vos.
          </p>
        </div>
        <AuthForm />
        <p className="text-center text-xs text-ink-soft">
          Simón acompaña, no reemplaza la ayuda de una persona 🌱
        </p>
      </main>
    );
  }

  return (
    // En mobile el chat es la aplicación: ocupa todo el viewport visible y el
    // único scroll es el historial. `min-h-0` evita que el composer salga al
    // abrir el teclado virtual.
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <SiteHeader chatMode />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Chat />
      </main>
      <BottomNav />
    </div>
  );
}
