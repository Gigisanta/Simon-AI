"use client";

import { useMemo, useState } from "react";

export type ResourceRow = {
  id: string;
  name: string;
  kind: string;
  province: string;
  localidad: string | null;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  hours: string | null;
  cost: string;
  takesChildren: boolean;
  noAppointment: boolean;
  url: string | null;
  notes: string | null;
};

const KIND_LABELS: Record<string, string> = {
  crisis: "Crisis / Emergencia",
  linea: "Líneas de ayuda",
  salud_mental: "Salud mental",
  discapacidad: "Discapacidad",
  escuela: "Escuela",
  ong: "ONG",
};

// Orden lógico (crisis primero: es lo que más urge encontrar).
const KIND_KEYS = ["crisis", "linea", "salud_mental", "discapacidad", "escuela", "ong"] as const;

const KIND_ORDER: Record<string, number> = Object.fromEntries(
  KIND_KEYS.map((k, i) => [k, i] as const),
);

const COST_LABELS: Record<string, string> = {
  gratis: "Gratis",
  obra_social: "Obra social",
  arancel: "Con arancel",
};

/** Normaliza para búsqueda case/acentos-insensitive. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Primer número "discable" del campo phone (para el link tel:). */
function firstDialable(phone: string | null): string | null {
  if (!phone) return null;
  const m = phone.match(/[\d][\d\s-]{1,}/);
  if (!m) return null;
  const digits = m[0].replace(/[^\d]/g, "");
  return digits.length >= 3 ? digits : null;
}

function ResourceCard({ r }: { r: ResourceRow }) {
  const dial = firstDialable(r.phone);
  const wa = r.whatsapp?.replace(/[^\d]/g, "");
  const isCrisis = r.kind === "crisis";

  return (
    <article
      className={`rounded-card border bg-card p-5 shadow-[0_10px_30px_-12px_rgb(57_53_41/0.15)] ${
        isCrisis ? "border-l-[6px] border-l-accent border-line" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`text-[11px] font-extrabold uppercase tracking-wide ${
            isCrisis ? "text-accent-deep" : "text-ink-soft"
          }`}
        >
          {KIND_LABELS[r.kind] ?? r.kind}
        </span>
        {r.province === "nacional" && (
          <span className="rounded-full bg-sand px-2 py-0.5 text-[11px] font-bold text-ink-soft">
            Todo el país
          </span>
        )}
        {r.noAppointment && (
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand-strong">
            Sin turno
          </span>
        )}
      </div>

      <h3 className="mt-1.5 text-base font-bold text-ink">{r.name}</h3>

      <dl className="mt-2 flex flex-col gap-1 text-sm text-ink-soft">
        {r.localidad && <div>{r.localidad}</div>}
        {r.hours && <div>🕑 {r.hours}</div>}
        <div>{COST_LABELS[r.cost] ?? r.cost}</div>
        {r.notes && <div className="text-ink">{r.notes}</div>}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        {r.phone && (
          <a
            href={dial ? `tel:${dial}` : undefined}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-bold text-brand-fg transition-colors hover:bg-brand-strong"
          >
            📞 {r.phone}
          </a>
        )}
        {wa && (
          <a
            href={`https://wa.me/${wa.startsWith("54") ? wa : `54${wa}`}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-card px-4 text-sm font-bold text-ink transition-colors hover:bg-sand"
          >
            WhatsApp
          </a>
        )}
        {r.url && (
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-full border border-line bg-card px-4 text-sm font-bold text-ink transition-colors hover:bg-sand"
          >
            Más info
          </a>
        )}
      </div>
    </article>
  );
}

export function ResourceExplorer({
  resources,
  province,
}: {
  resources: ResourceRow[];
  province: string;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<string>("all");

  // Solo mostramos chips de los tipos que realmente hay.
  const availableKinds = useMemo(
    () =>
      KIND_KEYS.filter((k) => resources.some((r) => r.kind === k)),
    [resources],
  );

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return resources
      .filter((r) => {
        if (kind !== "all" && r.kind !== kind) return false;
        if (!q) return true;
        return (
          normalize(r.name).includes(q) ||
          normalize(r.notes ?? "").includes(q) ||
          normalize(r.localidad ?? "").includes(q)
        );
      })
      .sort(
        (a, b) =>
          (KIND_ORDER[a.kind] ?? 99) - (KIND_ORDER[b.kind] ?? 99) ||
          a.name.localeCompare(b.name, "es"),
      );
  }, [resources, query, kind]);

  const provinceLabel =
    province === "neuquen"
      ? "Neuquén"
      : province === "rionegro"
        ? "Río Negro"
        : "tu zona";

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-ink">Cerca tuyo</h1>
      <p className="mt-2 max-w-2xl text-base text-ink-soft">
        Lugares y líneas de ayuda reales para {provinceLabel}. Las líneas
        nacionales están verificadas; los recursos locales se suman a medida que
        se confirman. Ante peligro inmediato, siempre <strong>911</strong>.
      </p>

      {/* --- Búsqueda --- */}
      <div className="mt-6 flex items-center gap-2 rounded-full border border-line bg-white px-4 py-1 shadow-sm">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-soft"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar un lugar o línea de ayuda…"
          aria-label="Buscar en el directorio de recursos"
          className="min-h-11 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-soft"
        />
      </div>

      {/* --- Chips de tipo --- */}
      <div role="group" aria-label="Filtrar por tipo" className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setKind("all")}
          className={`min-h-11 rounded-full border px-4 text-sm font-bold transition-colors ${
            kind === "all"
              ? "border-brand bg-brand text-brand-fg"
              : "border-line bg-card text-ink-soft hover:border-brand hover:text-brand-strong"
          }`}
        >
          Todos
        </button>
        {availableKinds.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`min-h-11 rounded-full border px-4 text-sm font-bold transition-colors ${
              kind === k
                ? "border-brand bg-brand text-brand-fg"
                : "border-line bg-card text-ink-soft hover:border-brand hover:text-brand-strong"
            }`}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {/* --- Grid de recursos --- */}
      {filtered.length === 0 ? (
        <p className="mt-10 text-center text-base text-ink-soft">
          Todavía no hay recursos cargados para esta búsqueda. Mientras tanto,
          las líneas nacionales de ayuda atienden en todo el país.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <ResourceCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
