import type { Metadata } from "next";
import { GateForm } from "@/components/gate-form";

export const metadata: Metadata = {
  title: "Acceso privado",
  robots: { index: false, follow: false },
};

/** Única página visible sin la cookie del candado (ver src/lib/site-lock.ts). */
export default function GatePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <GateForm />
    </main>
  );
}
