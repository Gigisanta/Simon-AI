"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { childEmail } from "@/lib/guardian";

/** better-auth devuelve mensajes en inglés; los mapeamos a un español cercano. */
function translateAuthError(message: string | undefined, audience: Audience): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid email or password") || m.includes("invalid password"))
    return audience === "child"
      ? "Usuario o contraseña incorrectos."
      : "Email o contraseña incorrectos.";
  if (m.includes("email not verified") || m.includes("not verified"))
    return "Tenés que verificar tu email antes de entrar. Revisá tu casilla.";
  if (m.includes("already exists") || m.includes("already registered"))
    return "Ya existe una cuenta con ese email. Probá iniciar sesión.";
  if (m.includes("password") && m.includes("short"))
    return "La contraseña es muy corta (mínimo 8 caracteres).";
  if (m.includes("invalid email")) return "Ese email no parece válido.";
  return message || "No se pudo completar. Probá de nuevo.";
}

type Audience = "adult" | "child";
type Mode = "signin" | "signup";

const inputClass =
  "min-h-11 rounded-2xl border border-line bg-card px-4 text-base text-ink outline-none placeholder:text-ink-soft focus:border-brand";

export function AuthForm() {
  const [audience, setAudience] = useState<Audience>("adult");
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchAudience(next: Audience) {
    setAudience(next);
    setMode("signin");
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      let res;
      if (audience === "child") {
        // El menor ingresa con "usuario": el email sintético se arma detrás.
        res = await authClient.signIn.email({ email: childEmail(username), password });
      } else if (mode === "signin") {
        res = await authClient.signIn.email({ email, password });
      } else {
        res = await authClient.signUp.email({ email, password, name });
      }
      if (res.error) {
        setError(translateAuthError(res.error.message, audience));
      } else if (audience === "adult" && mode === "signup") {
        // Con verificación de email, el registro no inicia sesión: avisamos.
        setError(null);
        setMode("signin");
        setPassword("");
        setNotice(
          "Te enviamos un email para verificar tu cuenta. Confirmalo y después iniciá sesión.",
        );
      } else {
        window.location.reload();
      }
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setPending(false);
    }
  }

  const tabClass = (active: boolean) =>
    `min-h-11 flex-1 rounded-full px-3 text-sm font-bold transition-colors ${
      active ? "bg-brand text-brand-fg shadow-sm" : "text-ink-soft hover:text-ink"
    }`;

  return (
    <div className="w-full max-w-sm mx-auto rounded-card border border-line bg-card p-6 shadow-card">
      {/* --- Tabs de audiencia --- */}
      <div role="tablist" aria-label="Tipo de cuenta" className="mb-5 flex gap-1 rounded-full bg-sand p-1">
        <button
          type="button"
          role="tab"
          aria-selected={audience === "adult"}
          onClick={() => switchAudience("adult")}
          className={tabClass(audience === "adult")}
        >
          Adulto / tutor
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={audience === "child"}
          onClick={() => switchAudience("child")}
          className={tabClass(audience === "child")}
        >
          Soy chico/chica
        </button>
      </div>

      <h2 className="text-xl font-extrabold text-ink">
        {audience === "child"
          ? "Entrá con tu usuario"
          : mode === "signin"
            ? "Iniciá sesión"
            : "Creá tu cuenta"}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">
        {audience === "child"
          ? "Usá el usuario y la contraseña que te dio tu tutor/a."
          : "Simón — un espacio para hablar y aprender."}
      </p>

      {notice && (
        <div className="mt-4 rounded-2xl border border-brand/40 bg-brand-soft p-3 text-sm text-brand-strong">
          {notice}
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        {audience === "adult" && mode === "signup" && (
          <input
            className={inputClass}
            placeholder="Nombre"
            aria-label="Nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
          />
        )}

        {audience === "child" ? (
          <input
            className={inputClass}
            placeholder="Usuario"
            aria-label="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            required
            autoComplete="username"
            pattern="[a-z0-9_]{3,24}"
          />
        ) : (
          <input
            className={inputClass}
            placeholder="Email"
            aria-label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        )}

        <input
          className={inputClass}
          placeholder="Contraseña"
          aria-label="Contraseña"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={
            audience === "adult" && mode === "signup" ? "new-password" : "current-password"
          }
        />

        {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-full bg-brand px-4 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong disabled:opacity-50"
        >
          {pending
            ? "Un momento…"
            : audience === "child"
              ? "Entrar"
              : mode === "signin"
                ? "Entrar"
                : "Registrarme"}
        </button>
      </form>

      {audience === "adult" && (
        <button
          type="button"
          onClick={() => {
            setMode(mode === "signin" ? "signup" : "signin");
            setError(null);
            setNotice(null);
          }}
          className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand-strong underline-offset-2 hover:underline"
        >
          {mode === "signin"
            ? "¿No tenés cuenta? Registrate"
            : "¿Ya tenés cuenta? Iniciá sesión"}
        </button>
      )}
    </div>
  );
}
