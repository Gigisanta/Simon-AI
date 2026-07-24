"use client";

import { useState } from "react";

/**
 * Formulario de la puerta privada (`/gate`): pide la clave de acceso y, si
 * `/api/gate` la acepta (204 + cookie firmada), recarga con
 * `window.location.replace("/")` — recarga completa a propósito, para que el
 * PRÓXIMO request ya pase por el proxy con la cookie puesta.
 */
export function GateForm() {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (res.status === 204) {
        window.location.replace("/");
        return;
      }
      setError(
        res.status === 429
          ? "Demasiados intentos. Esperá un momento y probá de nuevo."
          : res.status === 503
            ? "El acceso no está disponible en este momento."
            : "Clave incorrecta.",
      );
    } catch {
      setError("No se pudo verificar. Revisá tu conexión.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-sm mx-auto rounded-card border border-line bg-card p-6 shadow-card">
      <h1 className="text-xl font-extrabold text-ink">Acceso privado</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Este espacio está en fase privada. Ingresá la clave de acceso.
      </p>
      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <input
          className="min-h-11 rounded-2xl border border-line bg-card px-4 text-base text-ink outline-none placeholder:text-ink-soft focus:border-brand"
          placeholder="Clave de acceso"
          aria-label="Clave de acceso"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          required
          autoComplete="off"
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-brand px-4 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {pending ? "Un momento…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
