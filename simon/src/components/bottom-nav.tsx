"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { visibleNavItems } from "@/components/site-header";
import { useSession } from "@/lib/auth-client";

/** Nav flotante mobile (md:hidden): mismos ítems que el pill de escritorio. */
export function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const items = visibleNavItems(session?.user.role);

  // En la ruta de chat la conversación tiene prioridad absoluta en mobile.
  // La navegación sigue disponible desde las páginas secundarias y en desktop.
  if (pathname === "/") return null;

  // Con un solo ítem (rol child = solo "Chat") la nav no aporta: no se renderiza
  // y el chat recupera el viewport (el pb-20 de page.tsx va con la misma
  // condición). Nunca cambia entre renders para un mismo rol → sin salto.
  if (items.length <= 1) return null;

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-3 z-40 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border border-line/70 bg-card/85 px-2 py-1 shadow-card backdrop-blur md:hidden"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}
    >
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-full px-3 py-1"
          >
            <span
              className={`flex size-7 items-center justify-center rounded-full transition-colors ${
                active ? "bg-brand text-brand-fg" : "text-ink-soft"
              }`}
            >
              <item.Icon className="size-4" />
            </span>
            <span
              className={`text-xs font-bold ${active ? "text-ink" : "text-ink-soft"}`}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
