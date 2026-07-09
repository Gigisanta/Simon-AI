import { SimonAvatar } from "@/components/simon-avatar";

export default function Loading() {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-4 bg-cream px-4 text-center">
      <SimonAvatar className="size-16 motion-safe:animate-pulse" />
      <p className="text-base text-ink-soft">Cargando…</p>
    </main>
  );
}
