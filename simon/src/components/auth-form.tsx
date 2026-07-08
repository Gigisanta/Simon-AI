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

export function AuthForm() {
  const [audience, setAudience] = useState<Audience>("adult");
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function switchAudience(next: Audience) {
    setAudience(next);
    setMode("signin");
    setError(null);
  }

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
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
        alert(
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

  return (
    <div className="w-full max-w-sm mx-auto rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      {/* --- Tabs de audiencia --- */}
      <div className="mb-4 flex gap-1 rounded-lg bg-stone-100 p-1 dark:bg-stone-800">
        <button
          type="button"
          onClick={() => switchAudience("adult")}
          className={`min-h-11 flex-1 rounded-md px-3 text-sm font-medium transition ${
            audience === "adult"
              ? "bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-50"
              : "text-stone-600 dark:text-stone-400"
          }`}
        >
          Adulto / tutor
        </button>
        <button
          type="button"
          onClick={() => switchAudience("child")}
          className={`min-h-11 flex-1 rounded-md px-3 text-sm font-medium transition ${
            audience === "child"
              ? "bg-white text-stone-900 shadow-sm dark:bg-stone-950 dark:text-stone-50"
              : "text-stone-600 dark:text-stone-400"
          }`}
        >
          Soy chico/chica
        </button>
      </div>

      <h1 className="text-xl font-semibold text-stone-900 dark:text-stone-50">
        {audience === "child"
          ? "Entrá con tu usuario"
          : mode === "signin"
            ? "Iniciá sesión"
            : "Creá tu cuenta"}
      </h1>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
        {audience === "child"
          ? "Usá el usuario y la contraseña que te dio tu tutor/a."
          : "Simón — un espacio para hablar y aprender."}
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        {audience === "adult" && mode === "signup" && (
          <input
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none placeholder:text-stone-600 focus:border-teal-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-400 dark:focus:border-teal-400"
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
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none placeholder:text-stone-600 focus:border-teal-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-400 dark:focus:border-teal-400"
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
            className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none placeholder:text-stone-600 focus:border-teal-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-400 dark:focus:border-teal-400"
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
          className="min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none placeholder:text-stone-600 focus:border-teal-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-400 dark:focus:border-teal-400"
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

        {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="min-h-11 rounded-lg bg-teal-800 px-3 text-base font-medium text-white hover:bg-teal-900 disabled:opacity-50 dark:bg-teal-300 dark:text-teal-950 dark:hover:bg-teal-200"
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
          }}
          className="mt-2 inline-flex min-h-11 items-center text-sm text-stone-700 underline-offset-2 hover:underline dark:text-stone-300"
        >
          {mode === "signin"
            ? "¿No tenés cuenta? Registrate"
            : "¿Ya tenés cuenta? Iniciá sesión"}
        </button>
      )}
    </div>
  );
}
