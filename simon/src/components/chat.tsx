"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useRef, useState } from "react";
import { ConversationList } from "@/components/conversation-list";
import { MoodChips } from "@/components/mood-chips";
import { relativeTime } from "@/components/relative-time";
import { SessionTimer } from "@/components/session-timer";
import { SimonAvatar } from "@/components/simon-avatar";
import { useSession } from "@/lib/auth-client";
import { SESSION_WARN_APPENDIX } from "@/lib/session-limit";

/** El aviso de pausa lo emite el server (session-limit); acá solo se detecta. */
const WARN_MARKER = SESSION_WARN_APPENDIX.trim();

/** Conversación previa que se puede retomar (la devuelve /api/chat/resume). */
type Resumable = {
  id: string;
  updatedAt: string;
  messages: { id: string; role: string; content: string }[];
};

/** Detalle que devuelve GET /api/conversations/:id (contrato). */
type ConversationDetail = {
  id: string;
  title: string;
  updatedAt: string;
  messages: { id: string; role: string; content: string }[];
};

const quickStartIconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "size-5 shrink-0",
} as const;

type QuickStart = {
  label: string;
  message: string;
  circle: string;
  kicker: string;
  icon: React.ReactNode;
};

/** Accesos rápidos del empty state: mensajes reales enviados al chat (SH-U3). */
const CHILD_QUICK_STARTS: QuickStart[] = [
  {
    label: "CÓMO ME SIENTO",
    message: "Quiero contarte cómo me siento hoy",
    circle: "bg-peach-tint text-terra",
    kicker: "text-terra",
    icon: (
      <svg {...quickStartIconProps}>
        <path d="M20.8 8.6c0 4.4-8.8 10-8.8 10s-8.8-5.6-8.8-10a4.6 4.6 0 0 1 8.8-1.9A4.6 4.6 0 0 1 20.8 8.6z" />
      </svg>
    ),
  },
  {
    label: "ALGO ME PREOCUPA",
    message: "Hay algo que me preocupa y quiero hablarlo",
    circle: "bg-sky-tint text-tramites",
    kicker: "text-tramites",
    icon: (
      <svg {...quickStartIconProps}>
        <path d="M12 9v4M12 17h.01" />
        <path d="M10.3 3.9 2.7 17a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
    ),
  },
  {
    label: "APRENDER",
    message: "Quiero entender mejor lo que me pasa",
    circle: "bg-green-tint text-intel",
    kicker: "text-intel",
    icon: (
      <svg {...quickStartIconProps}>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
      </svg>
    ),
  },
];

/** Accesos del tutor/a (F3): orientación familiar, derechos, trámites. */
const GUARDIAN_QUICK_STARTS: QuickStart[] = [
  {
    label: "TRÁMITES",
    message: "¿Cómo tramito el CUD?",
    circle: "bg-sky-tint text-tramites",
    kicker: "text-tramites",
    icon: (
      <svg {...quickStartIconProps}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 13h6M9 17h6" />
      </svg>
    ),
  },
  {
    label: "DERECHOS",
    message: "Derechos y prestaciones",
    circle: "bg-green-tint text-intel",
    kicker: "text-intel",
    icon: (
      <svg {...quickStartIconProps}>
        <path d="M12 3 4 6v6c0 4.4 3.4 7.6 8 9 4.6-1.4 8-4.6 8-9V6z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    label: "ACOMPAÑAR",
    message: "Cómo acompañar a mi hijo/a",
    circle: "bg-peach-tint text-terra",
    kicker: "text-terra",
    icon: (
      <svg {...quickStartIconProps}>
        <path d="M20.8 8.6c0 4.4-8.8 10-8.8 10s-8.8-5.6-8.8-10a4.6 4.6 0 0 1 8.8-1.9A4.6 4.6 0 0 1 20.8 8.6z" />
      </svg>
    ),
  },
];

const headerIconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  className: "size-5",
} as const;

export function Chat() {
  const { data: session } = useSession();
  const isGuardian = session?.user.role === "guardian";
  const quickStarts = isGuardian ? GUARDIAN_QUICK_STARTS : CHILD_QUICK_STARTS;

  const [input, setInput] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Lazy init: se crea una sola vez y es estable entre renders. El ref
  // conversationIdRef solo se lee/escribe dentro de los callbacks async
  // (body/fetch) en tiempo de request, nunca durante el render; la regla
  // react-hooks/refs lo marca como falso positivo al capturarlo en el factory.
  const [transport] = useState(
    // eslint-disable-next-line react-hooks/refs
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        body: () => ({
          conversationId: conversationIdRef.current ?? undefined,
        }),
        fetch: (async (info: RequestInfo | URL, init?: RequestInit) => {
          const res = await fetch(info, init);
          const id = res.headers.get("x-conversation-id");
          if (id) conversationIdRef.current = id;
          return res;
        }) as typeof fetch,
      }),
  );

  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
  });

  // Retomar conversación: al montar con el chat vacío, se consulta la última
  // conversación. Falla silenciosa → estado sin resume (nunca rompe el chat).
  const [resumable, setResumable] = useState<Resumable | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/resume", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { resumable?: Resumable | null };
        if (!cancelled && data?.resumable) setResumable(data.resumable);
      } catch {
        // sin resume
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Mapea los mensajes persistidos a UIMessage (parts text), como handleResume. */
  function toUiMessages(
    rows: { id: string; role: string; content: string }[],
  ): UIMessage[] {
    return rows
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        id: m.id,
        role: m.role as UIMessage["role"],
        parts: [{ type: "text", text: m.content }],
      }));
  }

  // La elección es explícita: nunca se reinyecta el historial en silencio
  // (control del chico sobre retomar un tema sensible).
  function handleResume() {
    if (!resumable) return;
    setMessages(toUiMessages(resumable.messages));
    conversationIdRef.current = resumable.id;
    setResumable(null);
  }

  // Abrir una conversación desde la lista: mismo mapeo que handleResume.
  function handleOpenConversation(detail: ConversationDetail) {
    setMessages(toUiMessages(detail.messages));
    conversationIdRef.current = detail.id;
    setResumable(null);
    setListOpen(false);
  }

  // Nueva conversación: limpia el hilo y el id (el próximo /api/chat crea una).
  function handleNewConversation() {
    setMessages([]);
    conversationIdRef.current = null;
    setResumable(null);
    setListOpen(false);
  }

  useEffect(() => {
    // Sin mensajes no hay nada que seguir: evita dejar el empty state
    // scrolleado al fondo (el saludo quedaba oculto en mobile).
    if (messages.length === 0) return;
    // Scroll instantáneo si el usuario pidió menos movimiento (OS o modo calma)
    const reduceMotion =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.hasAttribute("data-calm");
    bottomRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";
  const hasMessages = messages.length > 0;

  const serverWarned = messages.some(
    (m) =>
      m.role === "assistant" &&
      m.parts.some((p) => p.type === "text" && p.text.includes(WARN_MARKER)),
  );

  function send(text: string) {
    if (!text || busy) return;
    void sendMessage({ text });
  }

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    send(text);
  }

  return (
    <div className="flex min-h-0 w-full max-w-2xl flex-1 flex-col mx-auto px-3 pb-3 sm:px-4 sm:pb-4">
      {/*
        Divulgación obligatoria: Simón es una IA. Requisito legal: SIEMPRE
        visible. Con mensajes en pantalla colapsa a una línea (libera viewport
        mobile, F1.2); en empty state va el texto completo.
      */}
      {hasMessages ? (
        <div className="mt-3 rounded-2xl border border-accent/60 bg-peach px-4 py-1.5 text-center text-xs text-accent-deep">
          Simón es una IA · en crisis: <strong>135</strong> / <strong>102</strong>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-accent/60 bg-peach px-4 py-2.5 text-xs text-accent-deep sm:text-sm">
          Simón es un asistente de inteligencia artificial, no una persona ni un
          profesional de la salud. Si estás en peligro o en crisis, contactá una
          línea de ayuda: en Argentina, llamá al <strong>135</strong> (CAS) o al{" "}
          <strong>102</strong> (niñas, niños y adolescentes).
        </div>
      )}

      {/* Tarjeta principal del chat (estilo simon-mocha) */}
      <div className="mt-3 flex flex-1 flex-col overflow-hidden rounded-card border border-line bg-card shadow-[0_10px_30px_-12px_rgb(57_53_41/0.15)]">
        {/* Header del chat */}
        <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 sm:px-4 sm:py-3">
          {/* Identidad: duplica el SiteHeader → solo en md+ (F1.3) */}
          <span className="hidden items-center gap-2.5 md:flex">
            <SimonAvatar className="size-8" />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-extrabold text-ink">Simón</span>
              <span className="text-xs text-ink-soft">siempre acá para vos</span>
            </span>
          </span>

          {/* Acciones de conversación + timer (ambos breakpoints, ≥44px) */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleNewConversation}
              aria-label="Nueva conversación"
              className="flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-ink"
            >
              <svg {...headerIconProps}>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setListOpen(true)}
              aria-label="Ver conversaciones"
              className="flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-ink"
            >
              <svg {...headerIconProps}>
                <path d="M8 6h13M8 12h13M8 18h13" />
                <path d="M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </button>
            <SessionTimer serverWarned={serverWarned} />
          </div>
        </div>

        <div
          role="log"
          aria-live="polite"
          aria-label="Conversación con Simón"
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4 [scrollbar-width:thin] [scrollbar-color:var(--color-line)_transparent]"
        >
          {messages.length === 0 && (
            <div className="my-auto flex flex-col items-center gap-7 py-8">
              {resumable && (
                <div className="w-full max-w-sm rounded-card bg-card p-4 text-center shadow-[0_10px_30px_-12px_rgb(57_53_41/0.15)]">
                  <p className="text-base font-bold text-ink">
                    ¿Seguimos donde quedamos?
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Tu última charla fue {relativeTime(resumable.updatedAt)}.
                  </p>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <button
                      type="button"
                      onClick={handleResume}
                      className="min-h-11 rounded-full bg-brand px-5 text-sm font-bold text-brand-fg transition-colors hover:bg-brand-strong"
                    >
                      Continuar
                    </button>
                    <button
                      type="button"
                      onClick={() => setResumable(null)}
                      className="min-h-11 rounded-full border border-line px-5 text-sm font-bold text-ink transition-colors hover:bg-sand"
                    >
                      Empezar de nuevo
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col items-center gap-3">
                <SimonAvatar className="size-14" />
                {isGuardian ? (
                  <>
                    <p className="max-w-sm text-center text-base text-ink">
                      Hola, soy Simón. Estoy para ayudarte a acompañar a tu hijo
                      o hija.
                    </p>
                    <p className="max-w-sm text-center text-sm text-ink-soft">
                      Puedo orientarte sobre trámites, derechos y prestaciones, y
                      cómo sostener el día a día. No reemplazo el consejo
                      profesional.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="max-w-sm text-center text-base text-ink">
                      Hola, soy Simón. ¿De qué querés hablar hoy?
                    </p>
                    <p className="max-w-sm text-center text-sm text-ink-soft">
                      No hace falta que cuentes datos personales. Si veo que
                      estás en peligro, aviso a tu tutor/a para que te cuiden.
                    </p>
                  </>
                )}
              </div>

              <div className="flex w-full max-w-xl flex-col items-center gap-3">
                <p className="text-sm font-semibold text-ink-soft">
                  ¿Por dónde querés empezar?
                </p>
                <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
                  {quickStarts.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => send(item.message)}
                      className="flex min-h-11 flex-col items-start gap-2 rounded-card bg-card p-4 text-left shadow-[0_10px_30px_-12px_rgb(57_53_41/0.15)] transition-[transform,box-shadow] motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-[0_16px_36px_-14px_rgb(57_53_41/0.22)]"
                    >
                      <span
                        className={`flex size-10 items-center justify-center rounded-full ${item.circle}`}
                      >
                        {item.icon}
                      </span>
                      <span
                        className={`text-[11px] font-extrabold uppercase tracking-wide ${item.kicker}`}
                      >
                        {item.label}
                      </span>
                      <span className="text-sm font-bold text-ink">{item.message}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Check-in emocional: entrada guiada para el menor (no aplica al tutor/a). */}
              {!isGuardian && (
                <div className="flex flex-col items-center gap-3">
                  <p className="text-sm font-semibold text-ink-soft">
                    Si querés, empezá contándome cómo te sentís:
                  </p>
                  <MoodChips onPick={send} />
                </div>
              )}
            </div>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === "user"
                  ? "self-end flex max-w-[80%] flex-col items-end gap-1"
                  : "self-start flex max-w-[80%] flex-col items-start gap-1"
              }
            >
              {/* Etiqueta de rol visible: no solo color/alineación (SH-U5) */}
              <span className="flex items-center gap-1.5 px-1 text-xs font-bold text-ink-soft">
                {m.role === "assistant" && <SimonAvatar className="size-5" />}
                {m.role === "user" ? "Vos" : "Simón"}
              </span>
              <div
                className={
                  m.role === "user"
                    ? "rounded-2xl rounded-br-sm bg-peach px-4 py-2.5 text-base leading-relaxed text-ink"
                    : "rounded-2xl rounded-bl-sm bg-brand-soft px-4 py-2.5 text-base leading-relaxed text-ink"
                }
              >
                {m.parts.map((part, i) =>
                  part.type === "text" ? (
                    <span key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          ))}
          {status === "submitted" && (
            <div className="self-start flex max-w-[80%] flex-col items-start gap-1">
              <span className="flex items-center gap-1.5 px-1 text-xs font-bold text-ink-soft">
                <SimonAvatar className="size-5" />
                Simón
              </span>
              <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm bg-brand-soft px-4 py-3">
                {/* Fallback accesible: oculto salvo lectores de pantalla o modo calma */}
                <span className="sr-only calm:not-sr-only calm:text-sm calm:font-semibold calm:text-brand-strong">
                  Simón está escribiendo…
                </span>
                <span aria-hidden="true" className="flex items-center gap-1">
                  <span className="size-2 rounded-full bg-brand-strong motion-safe:animate-bounce [animation-delay:-0.3s]" />
                  <span className="size-2 rounded-full bg-brand-strong motion-safe:animate-bounce [animation-delay:-0.15s]" />
                  <span className="size-2 rounded-full bg-brand-strong motion-safe:animate-bounce" />
                </span>
              </div>
            </div>
          )}
          {error && (
            <p className="self-center text-base font-semibold text-danger">
              Hubo un problema. Probá enviar tu mensaje de nuevo.
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-line bg-card px-3 pb-3 pt-3 sm:px-4">
          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            <input
              className="min-h-11 flex-1 rounded-full border border-line bg-white px-5 text-base text-ink outline-none placeholder:text-ink-soft focus:border-brand"
              placeholder="Contale a Simón lo que estás viviendo…"
              aria-label="Tu mensaje para Simón"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Enviar mensaje"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg transition-colors hover:bg-brand-strong disabled:opacity-50"
            >
              {/* Avión de papel */}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-5 -translate-x-px"
              >
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22l-4-9-9-4z" />
              </svg>
            </button>
          </form>
          {/* Recordatorio de encuadre: se oculta en mobile para liberar alto (F1.4) */}
          <p className="mt-2 hidden text-center text-xs text-ink-soft md:block">
            Simón acompaña, no reemplaza la ayuda de una persona.
          </p>
        </div>
      </div>

      <ConversationList
        open={listOpen}
        onClose={() => setListOpen(false)}
        onOpenConversation={handleOpenConversation}
        onNewConversation={handleNewConversation}
      />
    </div>
  );
}
