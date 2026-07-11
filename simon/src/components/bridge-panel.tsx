"use client";

import Link from "next/link";
import { useState } from "react";
import type { BridgeCard, BridgeReason } from "@/lib/bridge";

const REASON_HUMAN: Record<BridgeReason, string> = {
  crisis: "señales de angustia intensa",
  abuso: "señales de una posible situación de abuso o violencia",
  riesgo: "momentos de angustia o malestar que se repiten",
  alimentario: "preocupaciones repetidas con la comida o el cuerpo",
};

function relativeDays(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  return `hace ${days} días`;
}

function Card({
  card,
  onDone,
}: {
  card: BridgeCard;
  onDone: (childId: string, next: "in_progress" | "gone") => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = card.recommendation;
  const severe = card.severity === "alta";

  async function act(status: "contacted" | "resolved" | "dismissed") {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/guardian/bridge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ childId: card.childId, reason: card.reason, status }),
      });
      if (!res.ok) {
        setError("No se pudo guardar. Probá de nuevo.");
        return;
      }
      onDone(card.childId, status === "contacted" ? "in_progress" : "gone");
    } catch {
      setError("Error de conexión. Probá de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      className={`rounded-card border bg-card p-5 shadow-[0_10px_30px_-12px_rgb(57_53_41/0.15)] ${
        severe ? "border-l-[6px] border-l-accent border-line" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
            severe ? "bg-peach text-accent-deep" : "bg-sand text-ink-soft"
          }`}
        >
          {severe ? "Atención" : "Para tener en cuenta"}
        </span>
        <span className="text-xs text-ink-soft">
          {card.childName} · última señal {relativeDays(card.lastEventAt)}
        </span>
      </div>

      <h3 className="mt-2 text-base font-bold text-ink">{r.title}</h3>
      <p className="mt-1 text-sm text-ink-soft">
        Simón notó {REASON_HUMAN[card.reason]} ({card.count}{" "}
        {card.count === 1 ? "vez" : "veces"}) en las últimas 2 semanas. No es un
        diagnóstico: es una señal para que puedas dar un paso.
      </p>

      {card.state === "in_progress" ? (
        <div className="mt-3 rounded-2xl border border-brand/40 bg-brand-soft p-3 text-sm text-ink">
          Marcaste que ya contactaste un recurso. ¿Cómo viene?
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => act("resolved")}
              disabled={pending}
              className="min-h-11 rounded-full bg-brand px-4 text-sm font-bold text-brand-fg hover:bg-brand-strong disabled:opacity-50"
            >
              Se resolvió
            </button>
            <button
              type="button"
              onClick={() => act("dismissed")}
              disabled={pending}
              className="min-h-11 rounded-full border border-line bg-card px-4 text-sm font-bold text-ink hover:bg-sand disabled:opacity-50"
            >
              Ocultar
            </button>
          </div>
        </div>
      ) : (
        <>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="rounded-2xl border border-line bg-sand p-3">
              <dt className="font-bold text-ink">Próximo paso</dt>
              <dd className="mt-0.5 text-ink-soft">{r.resourceLabel}</dd>
              <Link
                href="/ayuda/cerca"
                className="mt-1 inline-flex text-sm font-bold text-brand-strong underline-offset-2 hover:underline"
              >
                Ver recursos cerca tuyo →
              </Link>
            </div>
            <div className="rounded-2xl border border-line bg-sand p-3">
              <dt className="font-bold text-ink">Qué decir para pedir ayuda</dt>
              <dd className="mt-0.5 text-ink-soft">{r.script}</dd>
            </div>
            <div className="rounded-2xl border border-line bg-sand p-3">
              <dt className="font-bold text-ink">Cómo acompañar a tu hijo/a</dt>
              <dd className="mt-0.5 text-ink-soft">{r.tip}</dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => act("contacted")}
              disabled={pending}
              className="min-h-11 rounded-full bg-brand px-5 text-sm font-bold text-brand-fg hover:bg-brand-strong disabled:opacity-50"
            >
              Ya contacté un recurso
            </button>
            <button
              type="button"
              onClick={() => act("dismissed")}
              disabled={pending}
              className="min-h-11 rounded-full border border-line bg-card px-4 text-sm font-bold text-ink hover:bg-sand disabled:opacity-50"
            >
              Descartar
            </button>
          </div>
        </>
      )}

      {error && <p className="mt-2 text-sm font-semibold text-danger">{error}</p>}
    </article>
  );
}

export function BridgePanel({ initialCards }: { initialCards: BridgeCard[] }) {
  const [cards, setCards] = useState(initialCards);

  function onDone(childId: string, next: "in_progress" | "gone") {
    setCards((cur) =>
      next === "gone"
        ? cur.filter((c) => c.childId !== childId)
        : cur.map((c) =>
            c.childId === childId ? { ...c, state: "in_progress" as const } : c,
          ),
    );
  }

  return (
    <section className="mb-6">
      <h2 className="text-sm font-bold text-ink">Puente</h2>
      <p className="mt-0.5 text-xs text-ink-soft">
        Cuando Simón detecta señales repetidas, te propone un próximo paso
        concreto. Nunca muestra lo que tu hijo/a escribió.
      </p>
      {cards.length === 0 ? (
        <p className="mt-3 rounded-2xl border border-line bg-brand-soft px-4 py-3 text-sm text-ink">
          Por ahora no hay señales que requieran un paso extra. Seguimos
          acompañando 🌱
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {cards.map((c) => (
            <Card key={c.childId} card={c} onDone={onDone} />
          ))}
        </div>
      )}
    </section>
  );
}
