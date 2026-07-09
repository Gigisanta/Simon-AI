"use client";

import { useMemo, useRef, useState } from "react";

export type KnowledgeCardRow = {
  id: string;
  slug: string;
  category: string;
  title: string;
  body: string;
  source: string | null;
  reviewed: boolean;
};

const CATEGORY_LABELS: Record<string, string> = {
  neuro: "Neurodesarrollo",
  intel: "Intelectual",
  motora: "Motora",
  sensorial: "Sensorial",
  pocofrec: "Poco frecuentes",
  tramites: "Trámites",
};

// Orden lógico de categorías (no alfabético): manda en chips y en el grid.
const CATEGORY_KEYS = [
  "neuro",
  "intel",
  "motora",
  "sensorial",
  "pocofrec",
  "tramites",
] as const;

const CATEGORY_ORDER: Record<string, number> = Object.fromEntries(
  CATEGORY_KEYS.map((key, i) => [key, i] as const),
);

// Clases literales completas por categoría: Tailwind no compila clases
// interpoladas, así que kicker y arco van con strings estáticos.
const CAT_STYLES = {
  neuro: { kicker: "text-neuro", arc: "border-neuro" },
  intel: { kicker: "text-intel", arc: "border-intel" },
  motora: { kicker: "text-motora", arc: "border-motora" },
  sensorial: { kicker: "text-sensorial", arc: "border-sensorial" },
  pocofrec: { kicker: "text-pocofrec", arc: "border-pocofrec" },
  tramites: { kicker: "text-tramites", arc: "border-tramites" },
} as const;

function catStyle(category: string): { kicker: string; arc: string } {
  return (
    CAT_STYLES[category as keyof typeof CAT_STYLES] ?? {
      kicker: "text-ink-soft",
      arc: "border-line",
    }
  );
}

/** Normaliza para búsqueda case/acentos-insensitive. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function LearnExplorer({ cards }: { cards: KnowledgeCardRow[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<KnowledgeCardRow | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    return cards
      .filter((c) => {
        if (category !== "all" && c.category !== category) return false;
        if (!q) return true;
        return normalize(c.title).includes(q) || normalize(c.body).includes(q);
      })
      .sort(
        (a, b) =>
          (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99) ||
          a.title.localeCompare(b.title, "es"),
      );
  }, [cards, query, category]);

  function openCard(card: KnowledgeCardRow) {
    setSelected(card);
    dialogRef.current?.showModal();
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-4xl font-extrabold tracking-tight text-ink">
        Mapa de diagnósticos y trámites
      </h1>
      <p className="mt-2 max-w-2xl text-base text-ink-soft">
        Fichas con información orientativa sobre diagnósticos, condiciones y
        trámites frecuentes. No reemplazan una consulta profesional. Las fichas
        están en revisión profesional.
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
          placeholder="Buscar por diagnóstico, trámite o palabra clave…"
          aria-label="Buscar en el mapa de diagnósticos y trámites"
          className="min-h-11 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-soft"
        />
      </div>

      {/* --- Chips de categoría --- */}
      <div role="group" aria-label="Filtrar por categoría" className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={`min-h-11 rounded-full border px-4 text-sm font-bold transition-colors ${
            category === "all"
              ? "border-brand bg-brand text-brand-fg"
              : "border-line bg-card text-ink-soft hover:border-brand hover:text-brand-strong"
          }`}
        >
          Todas
        </button>
        {CATEGORY_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setCategory(key)}
            className={`min-h-11 rounded-full border px-4 text-sm font-bold transition-colors ${
              category === key
                ? "border-brand bg-brand text-brand-fg"
                : "border-line bg-card text-ink-soft hover:border-brand hover:text-brand-strong"
            }`}
          >
            {CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>

      {/* --- Grid de fichas --- */}
      {filtered.length === 0 ? (
        <p className="mt-10 text-center text-base text-ink-soft">
          No encontramos fichas para tu búsqueda. Probá con otra palabra o
          elegí otra categoría.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((card) => {
            const style = catStyle(card.category);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => openCard(card)}
                className={`rounded-card rounded-l-[26px] border-l-[6px] bg-card p-5 text-left shadow-[0_10px_30px_-12px_rgb(57_53_41/0.15)] transition-[transform,box-shadow] motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_16px_36px_-14px_rgb(57_53_41/0.22)] ${style.arc}`}
              >
                <span
                  className={`text-xs font-extrabold uppercase tracking-wide ${style.kicker}`}
                >
                  {CATEGORY_LABELS[card.category] ?? card.category}
                </span>
                <p className="mt-1.5 text-base font-bold text-ink">{card.title}</p>
              </button>
            );
          })}
        </div>
      )}

      {/* --- Detalle de ficha --- */}
      <dialog
        ref={dialogRef}
        aria-labelledby="learn-dialog-title"
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-card border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-ink/50"
      >
        {selected && (
          <div className="p-6">
            <span
              className={`text-xs font-extrabold uppercase tracking-wide ${catStyle(selected.category).kicker}`}
            >
              {CATEGORY_LABELS[selected.category] ?? selected.category}
            </span>
            <h2 id="learn-dialog-title" className="mt-1 text-xl font-extrabold text-ink">
              {selected.title}
            </h2>
            {!selected.reviewed && (
              <span className="mt-2 inline-flex rounded-full bg-sand px-2.5 py-0.5 text-[11px] font-bold text-ink-soft">
                Contenido en revisión profesional
              </span>
            )}
            <p className="mt-4 whitespace-pre-wrap text-base text-ink">
              {selected.body.split("\n").map((line, i, arr) => {
                // "Etiqueta: texto" -> etiqueta en negrita para escaneo rápido
                const m = line.match(/^([A-ZÁÉÍÓÚ][^:]{0,30}):\s/);
                return (
                  <span key={i}>
                    {m ? (
                      <>
                        <strong>{m[1]}:</strong>
                        {line.slice(m[1].length + 1)}
                      </>
                    ) : (
                      line
                    )}
                    {i < arr.length - 1 ? "\n" : null}
                  </span>
                );
              })}
            </p>
            {selected.source && (
              <p className="mt-4 text-sm text-ink-soft">Fuente: {selected.source}</p>
            )}
            <form method="dialog" className="mt-6 flex justify-end">
              <button
                type="submit"
                className="min-h-11 rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
              >
                Cerrar
              </button>
            </form>
          </div>
        )}
      </dialog>
    </div>
  );
}
