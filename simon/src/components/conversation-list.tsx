"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { dayGroup, relativeTime } from "@/components/relative-time";

/** Resumen de conversación que devuelve GET /api/conversations (contrato). */
type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
};

/** Mensaje que devuelve GET /api/conversations/:id (solo user/assistant). */
type ConversationDetail = {
  id: string;
  title: string;
  updatedAt: string;
  messages: { id: string; role: string; content: string }[];
};

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const GROUP_ORDER = ["Hoy", "Ayer", "Anteriores"] as const;

/**
 * Lista de conversaciones a pantalla completa (patrón WhatsApp, NO drawer).
 * `<dialog>` nativo modal, mismo patrón que la ficha de /aprender
 * (learn-explorer.tsx). Consume el contrato de /api/conversations; ante fallo
 * de red muestra un estado amable (comportamiento correcto también en prod, ya
 * que la API puede caerse). Sin mocks.
 */
export function ConversationList({
  open,
  currentConversationId,
  onClose,
  onOpenConversation,
  onNewConversation,
}: {
  open: boolean;
  currentConversationId: string | null;
  onClose: () => void;
  onOpenConversation: (detail: ConversationDetail) => void;
  onNewConversation: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Confirmación inline de borrado (NO window.confirm: bloquea el hilo).
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Guarda de single-flight: cada apertura incrementa el contador y captura su
  // valor; al resolver, si ya hubo un click posterior, se descarta la respuesta.
  // Sin esto, dos taps rápidos podían abrir la conversación cuyo fetch resolvía
  // último, no la última clickeada (last-resolved-wins → hilo equivocado).
  const openSeqRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    setConfirmId(null);
    try {
      const res = await fetch("/api/conversations", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        conversations?: ConversationSummary[];
        truncated?: boolean;
      };
      setItems(data.conversations ?? []);
      setTruncated(data.truncated ?? false);
    } catch {
      setError(true);
      setItems(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Sincroniza el estado React con el <dialog> nativo y carga al abrir.
  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      void load();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open, load]);

  // Abrir una conversación: trae el detalle y delega al chat el setMessages.
  async function handleOpen(id: string) {
    const seq = ++openSeqRef.current;
    const isStale = () => seq !== openSeqRef.current;
    setOpeningId(id);
    try {
      const res = await fetch(`/api/conversations/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const detail = (await res.json()) as ConversationDetail;
      // Otra fila fue clickeada después: se ignora este resultado obsoleto.
      if (isStale()) return;
      onOpenConversation(detail);
    } catch {
      // Falla amable: se marca el error general de la lista y no se cierra.
      // Un fallo de una apertura ya superada no debe pisar la UI actual.
      if (isStale()) return;
      setError(true);
    } finally {
      // Solo la última apertura en vuelo limpia el spinner (evita apagarlo
      // mientras otra sigue cargando).
      if (!isStale()) setOpeningId(null);
    }
  }

  async function handleDelete(id: string) {
    // Previene doble-submit mientras el fetch está en vuelo.
    if (deletingId) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setItems((prev) => prev?.filter((c) => c.id !== id) ?? null);
      // Si se borró la conversación abierta, reseteamos el chat para que el ref
      // no apunte a un id inexistente (evita reanudar sobre datos borrados).
      if (id === currentConversationId) onNewConversation();
    } catch {
      setError(true);
    } finally {
      setConfirmId(null);
      setDeletingId(null);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="conversation-list-title"
      onClose={onClose}
      // Pantalla completa: sin márgenes ni max-width, a diferencia de la ficha.
      className="m-0 h-dvh max-h-dvh w-dvw max-w-dvw bg-cream text-ink backdrop:bg-ink/40"
    >
      <div className="flex h-dvh flex-col">
        {/* Header: ← volver · título · ＋ nueva */}
        <div className="flex items-center justify-between gap-2 border-b border-line bg-card/80 px-3 py-2 backdrop-blur sm:px-4">
          <button
            type="button"
            onClick={onClose}
            aria-label="Volver al chat"
            className="flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-ink"
          >
            <svg {...iconProps} className="size-5">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <h2
            id="conversation-list-title"
            className="flex-1 text-center text-base font-extrabold text-ink"
          >
            Conversaciones
          </h2>
          <button
            type="button"
            onClick={onNewConversation}
            aria-label="Nueva conversación"
            className="flex size-11 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors hover:bg-brand-strong"
          >
            <svg {...iconProps} className="size-5">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4 [scrollbar-width:thin] [scrollbar-color:var(--color-line)_transparent]">
          <div className="mx-auto w-full max-w-2xl">
            {loading && (
              <p role="status" className="py-10 text-center text-base text-ink-soft motion-safe:animate-pulse">
                Cargando tus conversaciones…
              </p>
            )}

            {!loading && error && (
              <div role="alert" className="flex flex-col items-center gap-4 py-10 text-center">
                <p className="max-w-sm text-base text-ink">
                  No pudimos cargar tus conversaciones. Puede ser un problema de
                  conexión.
                </p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="min-h-11 rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
                >
                  Reintentar
                </button>
              </div>
            )}

            {!loading && !error && items && items.length === 0 && (
              <div className="flex flex-col items-center gap-4 py-16 text-center">
                <p className="max-w-sm text-base text-ink">
                  Todavía no tenés conversaciones guardadas.
                </p>
                <button
                  type="button"
                  onClick={onNewConversation}
                  className="min-h-11 rounded-full bg-brand px-6 text-base font-bold text-brand-fg transition-colors hover:bg-brand-strong"
                >
                  Empezar una conversación nueva
                </button>
              </div>
            )}

            {!loading && !error && items && items.length > 0 && (
              <div className="flex flex-col gap-6">
                {GROUP_ORDER.map((group) => {
                  const groupItems = items.filter(
                    (c) => dayGroup(c.updatedAt) === group,
                  );
                  if (groupItems.length === 0) return null;
                  return (
                    <section key={group}>
                      <h3 className="px-1 pb-2 text-xs font-extrabold uppercase tracking-wide text-ink-soft">
                        {group}
                      </h3>
                      <ul className="flex flex-col gap-2">
                        {groupItems.map((c) => {
                          const isCurrent = c.id === currentConversationId;
                          return (
                          <li
                            key={c.id}
                            aria-current={isCurrent ? "true" : undefined}
                            className={`flex items-stretch gap-1 rounded-card border bg-card shadow-card ${
                              isCurrent ? "border-brand" : "border-line"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => void handleOpen(c.id)}
                              disabled={openingId === c.id}
                              className="flex min-h-11 flex-1 flex-col items-start gap-0.5 rounded-l-card px-4 py-3 text-left transition-colors hover:bg-sand disabled:opacity-60"
                            >
                              <span className="line-clamp-1 text-base font-bold text-ink">
                                {c.title}
                              </span>
                              <span
                                className={`text-xs ${
                                  isCurrent ? "font-bold text-brand-strong" : "text-ink-soft"
                                }`}
                              >
                                {openingId === c.id
                                  ? "Abriendo…"
                                  : isCurrent
                                    ? "Conversación actual"
                                    : relativeTime(c.updatedAt)}
                              </span>
                            </button>

                            {confirmId === c.id ? (
                              <div className="flex items-center gap-1 pr-2">
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(c.id)}
                                  disabled={deletingId === c.id}
                                  aria-label={`Confirmar borrado de "${c.title}"`}
                                  className="min-h-11 rounded-full px-3 text-sm font-bold text-danger transition-colors hover:bg-sand hover:text-danger-strong disabled:opacity-50"
                                >
                                  {deletingId === c.id ? "Borrando…" : "Borrar"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmId(null)}
                                  disabled={deletingId === c.id}
                                  aria-label="Cancelar borrado"
                                  className="min-h-11 rounded-full px-3 text-sm font-bold text-ink-soft transition-colors hover:bg-sand disabled:opacity-50"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmId(c.id)}
                                aria-label={`Borrar conversación: ${c.title}`}
                                className="flex size-11 shrink-0 items-center justify-center self-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-danger"
                              >
                                <svg {...iconProps} className="size-5">
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                                  <path d="M10 11v6M14 11v6" />
                                </svg>
                              </button>
                            )}
                          </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })}
                {truncated && (
                  <p className="px-1 pb-2 text-center text-xs text-ink-soft">
                    Mostramos tus 50 conversaciones más recientes. Borrá algunas
                    para ver las anteriores.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
