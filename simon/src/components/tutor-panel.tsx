"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MAX_CHILD_AGE, MIN_CHILD_AGE } from "@/lib/guardian";

export type ChildRow = {
  id: string;
  name: string;
  username: string;
  birthYear: number | null;
  consentAt: string | null;
  alertsEnabled: boolean;
};

const currentYear = new Date().getFullYear();
const minYear = currentYear - MAX_CHILD_AGE;
const maxYear = currentYear - MIN_CHILD_AGE;

// Tokens compartidos con auth-form/chat (paleta stone/teal, touch target ≥44px).
const inputClass =
  "min-h-11 rounded-lg border border-stone-300 bg-white px-3 text-base text-stone-900 outline-none placeholder:text-stone-600 focus:border-teal-700 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:placeholder:text-stone-400 dark:focus:border-teal-400";

/** Mensaje de error de una respuesta de API (o un fallback). */
async function apiError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

/**
 * Tarjeta de un menor: toggle de alertas de crisis + eliminación de la cuenta
 * con confirmación en dos pasos (advertencia explícita antes de confirmar,
 * porque el borrado es irreversible — Ley 25.326 art. 16).
 */
function ChildCard({ child, onChanged }: { child: ChildRow; onChanged(): void }) {
  const [alertsEnabled, setAlertsEnabled] = useState(child.alertsEnabled);
  // L5: tras un router.refresh() el padre re-renderiza con datos frescos del
  // server; sin esto el checkbox quedaría clavado en el valor inicial (stale).
  // Patrón oficial de React para ajustar estado cuando cambia una prop: se
  // sincroniza DURANTE el render (no en un effect), comparando contra el último
  // valor de server visto. Sin cascada de renders ni effect.
  const [lastServerValue, setLastServerValue] = useState(child.alertsEnabled);
  if (child.alertsEnabled !== lastServerValue) {
    setLastServerValue(child.alertsEnabled);
    setAlertsEnabled(child.alertsEnabled);
  }
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleAlerts() {
    setError(null);
    setPending(true);
    const next = !alertsEnabled;
    try {
      const res = await fetch(`/api/guardian/children/${child.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alertsEnabled: next }),
      });
      if (!res.ok) {
        setError(await apiError(res, "No se pudo actualizar las alertas."));
        return;
      }
      setAlertsEnabled(next);
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setPending(false);
    }
  }

  async function deleteChild() {
    setError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/guardian/children/${child.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        setError(await apiError(res, "No se pudo eliminar la cuenta."));
        return;
      }
      onChanged();
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="flex items-center justify-between">
        <span className="text-stone-900 dark:text-stone-100">
          {child.name} <span className="text-stone-500">· @{child.username}</span>
          {child.birthYear ? (
            <span className="text-stone-500"> · {child.birthYear}</span>
          ) : null}
        </span>
        <span
          className={
            child.consentAt
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-400"
          }
        >
          {child.consentAt ? "Consentimiento OK" : "Sin consentimiento"}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-stone-100 pt-2 dark:border-stone-800">
        <label className="flex min-h-11 items-center gap-2 text-stone-600 dark:text-stone-300">
          <input
            type="checkbox"
            checked={alertsEnabled}
            onChange={toggleAlerts}
            disabled={pending}
            className="size-4 accent-teal-700 dark:accent-teal-400"
          />
          Alertas de crisis por email
        </label>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            className="inline-flex min-h-11 items-center text-red-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            Eliminar cuenta y datos
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          <p>
            Se borra la cuenta de <strong>{child.name}</strong> y{" "}
            <strong>todos sus datos</strong> (conversaciones, memorias y eventos
            de seguridad). <strong>No se puede deshacer.</strong>
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={deleteChild}
              disabled={pending}
              className="min-h-11 rounded-lg bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {pending ? "Eliminando…" : "Sí, eliminar definitivamente"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="min-h-11 rounded-lg border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-100 disabled:opacity-50 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-red-700 dark:text-red-400">{error}</p>}
    </li>
  );
}

export function TutorPanel({
  initialChildren,
  emailVerified,
}: {
  initialChildren: ChildRow[];
  emailVerified: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    setOk(null);

    if (!consent) {
      setError("Necesitás confirmar el consentimiento como tutor/a legal.");
      return;
    }
    const year = Number(birthYear);
    if (!Number.isInteger(year)) {
      setError("Ingresá un año de nacimiento válido.");
      return;
    }

    setPending(true);
    try {
      const res = await fetch("/api/guardian/children", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, username, birthYear: year, password, consent }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: Record<string, string[] | undefined>;
      };
      if (!res.ok) {
        // Mostramos el primer error de campo si vino de la validación zod.
        const fieldError = data.details
          ? Object.values(data.details).flat().filter(Boolean)[0]
          : undefined;
        setError(fieldError || data.error || "No se pudo crear la cuenta.");
        return;
      }
      setOk(`Listo: ${name} ya puede ingresar con el usuario "${username}".`);
      setName("");
      setUsername("");
      setBirthYear("");
      setPassword("");
      setConsent(false);
      router.refresh();
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-50">
        Panel del tutor/a
      </h1>
      <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
        Desde acá das de alta a los chicos/as a tu cargo. Cada menor ingresa con
        su usuario y contraseña; nunca necesita un email propio.
      </p>

      {!emailVerified && (
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Verificá tu email para poder dar de alta a un menor. Revisá tu casilla
          (o la consola del servidor, en desarrollo) el enlace de verificación.
        </div>
      )}

      {/* --- Lista de menores --- */}
      <section className="mt-6">
        <h2 className="text-sm font-medium text-stone-700 dark:text-stone-300">
          Menores a tu cargo
        </h2>
        {initialChildren.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Todavía no diste de alta a nadie.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {initialChildren.map((c) => (
              <ChildCard key={c.id} child={c} onChanged={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>

      {/* --- Alta de menor + consentimiento --- */}
      <section className="mt-8 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-50">
          Dar de alta a un menor
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-stone-700 dark:text-stone-300">Nombre</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-stone-700 dark:text-stone-300">
              Usuario (con el que ingresa el menor)
            </span>
            <input
              className={inputClass}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="ej: sofi_2015"
              pattern="[a-z0-9_]{3,24}"
              title="3 a 24 caracteres: minúsculas, números o guion bajo."
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-stone-700 dark:text-stone-300">Año de nacimiento</span>
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
              min={minYear}
              max={maxYear}
              placeholder={`${minYear}–${maxYear}`}
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-stone-700 dark:text-stone-300">
              Contraseña del menor (mínimo 8 caracteres)
            </span>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              maxLength={72}
              autoComplete="new-password"
              required
            />
          </label>

          {/* --- Pantalla de consentimiento --- */}
          <div className="mt-2 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600 dark:border-stone-800 dark:bg-stone-950 dark:text-stone-300">
            <p className="font-medium text-stone-800 dark:text-stone-100">
              Antes de continuar, es importante que sepas:
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
              <li>
                Simón es una <strong>inteligencia artificial</strong>, no un
                psicólogo ni un profesional de la salud. Acompaña, no reemplaza
                la ayuda de una persona.
              </li>
              <li>
                Se guardan las <strong>conversaciones</strong> del menor con
                Simón y su <strong>año de nacimiento</strong>. No pedimos más
                datos de los necesarios.
              </li>
              <li>
                Si Simón detecta una situación de <strong>crisis</strong> (por
                ejemplo, riesgo para el menor), vas a recibir una{" "}
                <strong>alerta</strong> como tutor/a.
              </li>
              <li>
                Podés pedir la baja de la cuenta y de los datos cuando quieras.
              </li>
            </ul>

            <label className="mt-3 flex items-start gap-2">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4 accent-teal-700 dark:accent-teal-400"
              />
              <span className="text-stone-800 dark:text-stone-100">
                Confirmo que soy el tutor/a legal y doy mi consentimiento para
                que este menor use Simón bajo estas condiciones.
              </span>
            </label>
          </div>

          {error && <p className="text-sm text-red-700 dark:text-red-400">{error}</p>}
          {ok && <p className="text-sm text-emerald-700 dark:text-emerald-400">{ok}</p>}

          <button
            type="submit"
            disabled={pending || !consent || !emailVerified}
            className="mt-1 min-h-11 rounded-lg bg-teal-800 px-3 text-base font-medium text-white hover:bg-teal-900 disabled:opacity-50 dark:bg-teal-300 dark:text-teal-950 dark:hover:bg-teal-200"
          >
            {pending ? "Creando…" : "Dar de alta y registrar consentimiento"}
          </button>
        </form>
      </section>
    </div>
  );
}
