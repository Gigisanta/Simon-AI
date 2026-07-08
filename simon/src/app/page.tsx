"use client";

import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { CalmToggle } from "@/components/calm-toggle";
import { Chat } from "@/components/chat";
import { HelpDialog } from "@/components/help-dialog";
import { SimonAvatar } from "@/components/simon-avatar";
import { authClient, useSession } from "@/lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-base text-stone-600 motion-safe:animate-pulse dark:text-stone-400">
          Cargando…
        </p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-1 items-center justify-center bg-stone-50 p-4 dark:bg-stone-950">
        <AuthForm />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col bg-stone-50 dark:bg-stone-950">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-stone-200 px-4 py-2 dark:border-stone-800">
        <span className="flex items-center gap-2 text-lg font-bold text-stone-900 dark:text-stone-50">
          <SimonAvatar className="size-6" />
          Simón
        </span>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <HelpDialog />
          <CalmToggle />
          {session.user.role === "guardian" && (
            <Link
              href="/tutor"
              className="inline-flex min-h-11 items-center px-1 text-sm text-stone-700 underline-offset-2 hover:underline dark:text-stone-300"
            >
              Panel del tutor
            </Link>
          )}
          <span className="hidden text-sm text-stone-600 sm:inline dark:text-stone-400">
            {session.user.name || session.user.email}
          </span>
          <button
            onClick={() =>
              void authClient.signOut().then(() => window.location.reload())
            }
            className="inline-flex min-h-11 items-center px-1 text-sm text-stone-700 underline-offset-2 hover:underline dark:text-stone-300"
          >
            Salir
          </button>
        </div>
      </header>
      <Chat />
    </div>
  );
}
