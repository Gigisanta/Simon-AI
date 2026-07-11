"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { visibleNavItems } from "@/components/site-header";
import { useSession } from "@/lib/auth-client";

/**
 * Nav mobile (md:hidden), mismos ítems que el pill de escritorio.
 * En `/` (chat) se integra como barra compacta al pie del layout, sin robarle
 * prioridad full-screen a la conversación; en el resto de las páginas flota
 * como pill fija sobre el contenido scrolleable.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const items = visibleNavItems(session?.user.role);

  // Con un solo ítem (rol child = solo "Chat") la nav no aporta: no se renderiza
  // y el chat recupera el viewport (el pb-20 de page.tsx va con la misma
  // condición). Nunca cambia entre renders para un mismo rol → sin salto.
  if (items.length <= 1) return null;

  const inChat = pathname === "/";

  return (
    <nav
      aria-label="Navegación principal"
      className={
        inChat
          ? "flex shrink-0 items-center justify-center gap-1 border-t border-line/70 bg-card/95 px-2 py-1 backdrop-blur md:hidden"
          : "fixed inset-x-0 bottom-3 z-40 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border border-line/70 bg-card/85 px-2 py-1 shadow-card backdrop-blur md:hidden"
      }
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
