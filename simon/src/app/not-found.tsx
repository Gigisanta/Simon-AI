import Link from "next/link";
import { SimonAvatar } from "@/components/simon-avatar";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-6 bg-cream px-4 text-center">
      <SimonAvatar className="size-16" />
      <p className="max-w-sm text-base text-ink">Esta página no existe.</p>
      <Link
        href="/"
        className="min-h-11 inline-flex items-center rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
      >
        Volver al chat
      </Link>
    </main>
  );
}
