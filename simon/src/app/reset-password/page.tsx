"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { SimonAvatar } from "@/components/simon-avatar";
import { validateNewPassword } from "@/lib/password";

/**
 * Página de reseteo de contraseña del tutor/a (contraparte de
 * `sendResetPassword` en lib/auth.ts). El menor NUNCA llega acá: no tiene email
 * real y entra con usuario/contraseña.
 *
 * FLUJO (better-auth 1.6): `requestPasswordReset({ email, redirectTo })` manda un
 * mail con un link a `/api/auth/reset-password/{token}?callbackURL=/reset-password`.
 * Al abrirlo, better-auth valida el token y redirige acá con `?token=…` (válido)
 * o `?error=INVALID_TOKEN` (inválido/expirado). Esta página lee ese query param y:
 *   - sin token / error → mensaje claro + link para pedir otro enlace.
 *   - con token → formulario de contraseña nueva → `resetPassword({ newPassword, token })`.
 *
 * El query param se lee con `useSearchParams()` (no en un effect: evita el
 * antipatrón setState-en-effect). Se envuelve en <Suspense> porque Next lo exige
 * para ese hook.
 */

const inputClass =
  "min-h-11 rounded-2xl border border-line bg-card px-4 text-base text-ink outline-none placeholder:text-ink-soft focus:border-brand";

const cardClass =
  "w-full max-w-sm mx-auto rounded-card border border-line bg-card p-6 shadow-card";

/** better-auth responde en inglés; mapeamos lo esperable de `resetPassword`. */
function translateResetError(message: string | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("token")) return "El enlace no es válido o ya venció.";
  if (m.includes("password") && m.includes("short"))
    return "La contraseña es muy corta (mínimo 8 caracteres).";
  if (m.includes("password") && m.includes("long"))
    return "La contraseña es demasiado larga.";
  return "No se pudo restablecer la contraseña. Probá de nuevo.";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-8 bg-cream px-4 py-10">
      <SimonAvatar className="size-16" />
      {children}
    </main>
  );
}

function ResetPasswordForm() {
  const params = useSearchParams();
  // better-auth redirige con ?error=INVALID_TOKEN cuando el token no sirve.
  const token = params.get("error") ? "" : params.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    // Validación client-side (feedback inmediato). El server revalida igual.
    const invalid = validateNewPassword(password, confirm);
    if (invalid) {
      setError(invalid);
      return;
    }
    setPending(true);
    try {
      const res = await authClient.resetPassword({ newPassword: password, token });
      if (res.error) {
        setError(translateResetError(res.error.message));
        return;
      }
      setDone(true);
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setPending(false);
    }
  }

  // Éxito: contraseña cambiada.
  if (done) {
    return (
      <div className={cardClass}>
        <h1 className="text-xl font-extrabold text-ink">Listo</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Tu contraseña se actualizó. Ya podés iniciar sesión con la nueva.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
        >
          Iniciar sesión
        </Link>
      </div>
    );
  }

  // Link inválido o expirado (o sin token).
  if (!token) {
    return (
      <div className={cardClass}>
        <h1 className="text-xl font-extrabold text-ink">Enlace inválido o vencido</h1>
        <p className="mt-2 text-sm text-ink-soft">
          El enlace para restablecer tu contraseña no es válido o ya venció.
          Pedí uno nuevo desde el inicio de sesión.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex min-h-11 items-center rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
        >
          Volver al inicio
        </Link>
      </div>
    );
  }

  // Formulario de contraseña nueva.
  return (
    <div className={cardClass}>
      <h1 className="text-xl font-extrabold text-ink">Elegí una contraseña nueva</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Ingresá tu nueva contraseña (mínimo 8 caracteres).
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <input
          className={inputClass}
          placeholder="Contraseña nueva"
          aria-label="Contraseña nueva"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />
        <input
          className={inputClass}
          placeholder="Repetí la contraseña"
          aria-label="Repetí la contraseña"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
        />

        {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-brand px-4 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? "Guardando…" : "Guardar contraseña"}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <Shell>
          <p role="status" className="text-base text-ink-soft motion-safe:animate-pulse">
            Un momento…
          </p>
        </Shell>
      }
    >
      <Shell>
        <ResetPasswordForm />
      </Shell>
    </Suspense>
  );
}
