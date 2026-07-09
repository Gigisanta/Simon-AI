"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/components/site-header";
import { useSession } from "@/lib/auth-client";

/** Nav flotante mobile (md:hidden): mismos ítems que el pill de escritorio. */
export function BottomNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const isGuardian = session?.user.role === "guardian";
  const items = NAV_ITEMS.filter((item) => !item.guardianOnly || isGuardian);

  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-3 z-40 mx-auto flex w-fit max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-full border border-line/70 bg-card/85 px-2 py-1 shadow-[0_10px_30px_-12px_rgb(57_53_41/0.3)] backdrop-blur md:hidden"
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
              className={`text-[11px] font-bold ${active ? "text-ink" : "text-ink-soft"}`}
            >
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
