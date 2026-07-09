"use client";

import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { CalmToggle } from "@/components/calm-toggle";
import { Chat } from "@/components/chat";
import { HelpDialog } from "@/components/help-dialog";
import { SimonAvatar } from "@/components/simon-avatar";
import { authClient, useSession } from "@/lib/auth-client";

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <SimonAvatar className="size-9" />
      <span className="flex flex-col leading-tight">
        <span className="text-lg font-extrabold text-ink">Simón</span>
        <span className="text-xs text-ink-soft">Acompañamos cada paso</span>
      </span>
    </span>
  );
}

export default function Home() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center bg-cream">
        <p className="text-base text-ink-soft motion-safe:animate-pulse">Cargando…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <main className="flex flex-1 flex-col items-center justify-center gap-8 bg-cream px-4 py-10">
        <div className="flex max-w-xl flex-col items-center gap-4 text-center">
          <SimonAvatar className="size-20" />
          <h1 className="text-3xl font-extrabold leading-tight text-ink sm:text-4xl">
            Llegaste a un lugar que te entiende
          </h1>
          <p className="text-base text-ink-soft">
            Simón es un espacio para hablar, entender lo que te pasa y aprender —
            paso a paso, con vos.
          </p>
        </div>
        <AuthForm />
      </main>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-cream">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-line bg-cream/90 px-4 py-2.5">
        <Brand />
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <HelpDialog />
          <CalmToggle />
          {session.user.role === "guardian" && (
            <Link
              href="/tutor"
              className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm font-bold text-ink transition-colors hover:border-brand hover:text-brand-strong"
            >
              Panel del tutor
            </Link>
          )}
          <span className="hidden text-sm text-ink-soft sm:inline">
            {session.user.name || session.user.email}
          </span>
          <button
            onClick={() =>
              void authClient.signOut().then(() => window.location.reload())
            }
            className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline"
          >
            Salir
          </button>
        </div>
      </header>
      <Chat />
    </div>
  );
}
