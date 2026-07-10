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

// Tokens compartidos con auth-form/chat (design system simon-mocha, touch ≥44px).
const inputClass =
  "min-h-11 rounded-2xl border border-line bg-card px-4 text-base text-ink outline-none placeholder:text-ink-soft focus:border-brand";

/** Mensaje de error de una respuesta de API (o un fallback). */
async function apiError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error || fallback;
}

/** Evento de seguridad (SOLO metadata: nunca contenido del menor). */
type SafetyEventRow = {
  category: string;
  layer: string;
  createdAt: string;
  notifiedAt: string | null;
};

// Categoría técnica del SafetyEvent → etiqueta legible en español. Incluye los
// SafetyFlag internos y las topCategory crudas de la Moderation API. Cualquier
// otra cae en un genérico neutro (nunca se muestra jerga técnica al tutor/a).
const CATEGORY_LABELS: Record<string, string> = {
  crisis: "Angustia intensa",
  abuso: "Posible situación de abuso",
  riesgo: "Malestar o angustia",
  alimentario: "Alimentación e imagen corporal",
  "self-harm": "Angustia intensa",
  "self-harm/intent": "Angustia intensa",
  "self-harm/instructions": "Angustia intensa",
  "sexual/minors": "Contenido sexual con menores",
  violence: "Violencia",
  harassment: "Hostigamiento",
  hate: "Discurso de odio",
  sexual: "Contenido sexual",
  illicit: "Contenido inseguro",
};

function readableCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? "Señal de seguridad";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("es-AR", { dateStyle: "medium", timeStyle: "short" });
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

  // --- Historial de eventos de seguridad (lazy: se pide al abrir) ---
  const [eventsOpen, setEventsOpen] = useState(false);
  const [events, setEvents] = useState<SafetyEventRow[] | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState<string | null>(null);

  // --- Descarga de datos (export) ---
  const [confirmingExport, setConfirmingExport] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function loadEvents() {
    setEventsError(null);
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/guardian/children/${child.id}/safety-events`);
      if (!res.ok) {
        setEventsError(await apiError(res, "No se pudo cargar la actividad."));
        return;
      }
      const data = (await res.json()) as { events: SafetyEventRow[] };
      setEvents(data.events);
    } catch {
      setEventsError("Error de conexión. Probá de nuevo.");
    } finally {
      setEventsLoading(false);
    }
  }

  function toggleEvents() {
    const next = !eventsOpen;
    setEventsOpen(next);
    // Se carga una sola vez, al abrir por primera vez.
    if (next && events === null && !eventsLoading) void loadEvents();
  }

  async function downloadData() {
    setDownloadError(null);
    setDownloading(true);
    try {
      const res = await fetch(`/api/guardian/children/${child.id}/export`);
      if (!res.ok) {
        setDownloadError(await apiError(res, "No se pudo descargar los datos."));
        return;
      }
      // Nombre sugerido por el server (Content-Disposition); fallback local.
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] ?? `simon-datos-${child.username}.json`;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setConfirmingExport(false);
    } catch {
      setDownloadError("Error de conexión. Probá de nuevo.");
    } finally {
      setDownloading(false);
    }
  }

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
    <li className="rounded-2xl border border-line bg-card px-4 py-3 text-sm shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-ink">
          {child.name} <span className="font-normal text-ink-soft">· @{child.username}</span>
          {child.birthYear ? (
            <span className="font-normal text-ink-soft"> · {child.birthYear}</span>
          ) : null}
        </span>
        <span
          className={
            child.consentAt
              ? "rounded-full bg-brand-soft px-3 py-1 text-xs font-bold text-brand-strong"
              : "rounded-full bg-peach px-3 py-1 text-xs font-bold text-accent-deep"
          }
        >
          {child.consentAt ? "Consentimiento OK" : "Sin consentimiento"}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
        <label className="flex min-h-11 items-center gap-2 text-ink-soft">
          <input
            type="checkbox"
            checked={alertsEnabled}
            onChange={toggleAlerts}
            disabled={pending}
            className="size-4 accent-brand"
          />
          Alertas de crisis por email
        </label>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={pending}
            className="inline-flex min-h-11 items-center font-semibold text-danger underline-offset-2 hover:underline disabled:opacity-50"
          >
            Eliminar cuenta y datos
          </button>
        )}
      </div>

      {/* --- Actividad de seguridad + descarga de datos --- */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2">
        <button
          type="button"
          onClick={toggleEvents}
          aria-expanded={eventsOpen}
          className="inline-flex min-h-11 items-center font-semibold text-brand-strong underline-offset-2 hover:underline"
        >
          {eventsOpen ? "Ocultar actividad de seguridad" : "Ver actividad de seguridad"}
        </button>
        {!confirmingExport && (
          <button
            type="button"
            onClick={() => setConfirmingExport(true)}
            disabled={downloading}
            className="inline-flex min-h-11 items-center font-semibold text-ink-soft underline-offset-2 hover:underline disabled:opacity-50"
          >
            Descargar datos
          </button>
        )}
      </div>

      {confirmingExport && (
        <div className="mt-2 rounded-2xl border border-line bg-sand p-4 text-ink">
          <p>
            Se descarga un archivo con <strong>todos los datos</strong> de{" "}
            <strong>{child.name}</strong> (perfil, conversaciones, memorias y
            eventos de seguridad). Guardalo en un lugar seguro.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadData}
              disabled={downloading}
              className="min-h-11 rounded-full bg-brand px-4 py-1.5 font-bold text-brand-fg hover:bg-brand-strong disabled:opacity-50"
            >
              {downloading ? "Preparando…" : "Descargar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingExport(false)}
              disabled={downloading}
              className="min-h-11 rounded-full border border-line bg-card px-4 py-1.5 font-semibold text-ink hover:bg-sand disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
          {downloadError && (
            <p role="alert" className="mt-2 font-semibold text-danger">{downloadError}</p>
          )}
        </div>
      )}

      {eventsOpen && (
        <div className="mt-2 rounded-2xl border border-line bg-sand p-4">
          {eventsLoading ? (
            <p className="text-ink-soft">Cargando actividad…</p>
          ) : eventsError ? (
            <p role="alert" className="font-semibold text-danger">{eventsError}</p>
          ) : events && events.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {events.map((e, i) => (
                <li
                  key={`${e.createdAt}-${i}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                >
                  <span className="font-semibold text-ink">{readableCategory(e.category)}</span>
                  <span className="text-xs text-ink-soft">{formatDate(e.createdAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">
              No hay actividad de seguridad registrada. Es una buena señal.
            </p>
          )}
          <p className="mt-3 border-t border-line pt-2 text-xs text-ink-soft">
            Solo mostramos el tipo de señal y la fecha. Nunca guardamos ni
            compartimos lo que {child.name} escribió.
          </p>
        </div>
      )}

      {confirming && (
        <div className="mt-2 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-ink">
          <p>
            Se borra la cuenta de <strong>{child.name}</strong> y{" "}
            <strong>todos sus datos</strong> (conversaciones, memorias y eventos
            de seguridad). <strong>No se puede deshacer.</strong>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={deleteChild}
              disabled={pending}
              className="min-h-11 rounded-full bg-danger px-4 py-1.5 font-bold text-white hover:bg-danger-strong disabled:opacity-50"
            >
              {pending ? "Eliminando…" : "Sí, eliminar definitivamente"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="min-h-11 rounded-full border border-line bg-card px-4 py-1.5 font-semibold text-ink hover:bg-sand disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p role="alert" className="mt-2 font-semibold text-danger">{error}</p>}
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
      <h1 className="text-2xl font-extrabold text-ink">Panel del tutor/a</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Desde acá das de alta a los chicos/as a tu cargo. Cada menor ingresa con
        su usuario y contraseña; nunca necesita un email propio.
      </p>

      {!emailVerified && (
        <div className="mt-4 rounded-2xl border border-accent/60 bg-peach p-4 text-sm text-accent-deep">
          Verificá tu email para poder dar de alta a un menor. Revisá tu casilla
          (o la consola del servidor, en desarrollo) el enlace de verificación.
        </div>
      )}

      {/* --- Lista de menores --- */}
      <section className="mt-6">
        <h2 className="text-sm font-bold text-ink">Menores a tu cargo</h2>
        {initialChildren.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Todavía no diste de alta a nadie.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {initialChildren.map((c) => (
              <ChildCard key={c.id} child={c} onChanged={() => router.refresh()} />
            ))}
          </ul>
        )}
      </section>

      {/* --- Alta de menor + consentimiento --- */}
      <section className="mt-8 rounded-card border border-line bg-card p-6 shadow-card">
        <h2 className="text-lg font-extrabold text-ink">Dar de alta a un menor</h2>

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink">Nombre</span>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold text-ink">
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
            <span className="font-semibold text-ink">Año de nacimiento</span>
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
            <span className="font-semibold text-ink">
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
          <div className="mt-2 rounded-2xl border border-line bg-sand p-4 text-sm text-ink-soft">
            <p className="font-bold text-ink">Antes de continuar, es importante que sepas:</p>
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
              <li>Podés pedir la baja de la cuenta y de los datos cuando quieras.</li>
            </ul>

            <label className="mt-3 flex min-h-11 items-start gap-2">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4 accent-brand"
              />
              <span className="text-ink">
                Confirmo que soy el tutor/a legal y doy mi consentimiento para
                que este menor use Simón bajo estas condiciones.
              </span>
            </label>
          </div>

          {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
          {ok && <p role="status" className="text-sm font-semibold text-brand-strong">{ok}</p>}

          <button
            type="submit"
            disabled={pending || !consent || !emailVerified}
            className="mt-1 min-h-11 rounded-full bg-brand px-4 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? "Creando…" : "Dar de alta y registrar consentimiento"}
          </button>
        </form>
      </section>
    </div>
  );
}
