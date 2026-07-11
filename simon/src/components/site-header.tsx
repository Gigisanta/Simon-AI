"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalmToggle } from "@/components/calm-toggle";
import { HelpDialog } from "@/components/help-dialog";
import { SimonAvatar } from "@/components/simon-avatar";
import { authClient, useSession } from "@/lib/auth-client";

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function ChatIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={`shrink-0 ${className}`}>
      <path d="M21 11.5a8.4 8.4 0 0 1-8.4 8.4 8.3 8.3 0 0 1-3.8-.9L3 21l1.9-5.8a8.3 8.3 0 0 1-.9-3.8A8.4 8.4 0 0 1 12.5 3a8.4 8.4 0 0 1 8.4 8.4Z" />
    </svg>
  );
}

function LearnIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={`shrink-0 ${className}`}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
    </svg>
  );
}

function TutorIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg {...iconProps} className={`shrink-0 ${className}`}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

/** Ítems del nav compartidos entre el pill de escritorio y la bottom-nav mobile. */
export const NAV_ITEMS: {
  href: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  guardianOnly?: boolean;
}[] = [
  { href: "/", label: "Chat", Icon: ChatIcon },
  { href: "/aprender", label: "Aprender", Icon: LearnIcon, guardianOnly: true },
  { href: "/tutor", label: "Tutor", Icon: TutorIcon, guardianOnly: true },
];

/** Ítems visibles según el rol. El menor (child) solo ve "Chat". */
export function visibleNavItems(role: string | null | undefined) {
  const isGuardian = role === "guardian";
  return NAV_ITEMS.filter((item) => !item.guardianOnly || isGuardian);
}

export function SiteHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const items = visibleNavItems(session?.user.role);

  return (
    <header className="z-40 shrink-0 border-b border-line/70 bg-card/95 px-2 shadow-[0_1px_3px_rgb(0_0_0/0.08)] backdrop-blur sm:px-4">
      {/* Una sola fila SIEMPRE: nada wrappea ni solapa contenido de la página */}
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between gap-1 md:h-16 md:gap-2">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <SimonAvatar className="size-8 md:size-10" />
          <span className="flex flex-col leading-tight">
            <span className="text-base font-extrabold text-ink md:text-lg">Simón</span>
            <span className="hidden text-xs text-ink-soft md:inline">
              Acompañamos cada paso
            </span>
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
          {/* Nav pill solo en desktop: en mobile navega el bottom-nav */}
          <nav
            aria-label="Navegación principal"
            className="hidden shrink-0 items-center gap-1 rounded-full border border-line/70 bg-card/80 p-1 shadow-sm md:flex"
          >
            {items.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-bold transition-colors ${
                    active
                      ? "bg-brand text-brand-fg"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  <item.Icon />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <span className="hidden sm:contents">
            <HelpDialog />
            <CalmToggle />
          </span>
          {session && (
            <span className="hidden max-w-[10rem] truncate text-sm text-ink-soft lg:inline">
              {session.user.name || session.user.email}
            </span>
          )}
          <button
            type="button"
            onClick={() =>
              void authClient.signOut().then(() => window.location.reload())
            }
            className="inline-flex min-h-11 shrink-0 items-center px-2 text-xs font-semibold text-ink-soft underline-offset-2 hover:text-ink hover:underline md:text-sm"
          >
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}
