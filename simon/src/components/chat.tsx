"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useRef, useState } from "react";
import { MoodChips } from "@/components/mood-chips";
import { SessionTimer } from "@/components/session-timer";
import { SimonAvatar } from "@/components/simon-avatar";
import { SESSION_WARN_APPENDIX } from "@/lib/session-limit";

/** El aviso de pausa lo emite el server (session-limit); acá solo se detecta. */
const WARN_MARKER = SESSION_WARN_APPENDIX.trim();

export function Chat() {
  const [input, setInput] = useState("");
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

  const { messages, sendMessage, status, error } = useChat({
    transport,
  });

  useEffect(() => {
    // Scroll instantáneo si el usuario pidió menos movimiento (OS o modo calma)
    const reduceMotion =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.hasAttribute("data-calm");
    bottomRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, [messages]);

  const busy = status === "submitted" || status === "streaming";

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
    <div className="flex w-full max-w-2xl flex-1 flex-col mx-auto px-3 pb-3 sm:px-4 sm:pb-4">
      {/* Divulgación obligatoria: Simón es una IA */}
      <div className="mt-3 rounded-2xl border border-accent/60 bg-peach px-4 py-2.5 text-sm text-accent-deep">
        Simón es un asistente de inteligencia artificial, no una persona ni un
        profesional de la salud. Si estás en peligro o en crisis, contactá una
        línea de ayuda: en Argentina, llamá al <strong>135</strong> (CAS) o al{" "}
        <strong>102</strong> (niñas, niños y adolescentes).
      </div>

      {/* Tarjeta principal del chat (estilo simon-mocha) */}
      <div className="mt-3 flex flex-1 flex-col overflow-hidden rounded-card border border-line bg-card shadow-sm">
        {/* Header del chat */}
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <span className="flex items-center gap-2.5">
            <SimonAvatar className="size-8" />
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-extrabold text-ink">Simón</span>
              <span className="text-xs text-ink-soft">siempre acá para vos</span>
            </span>
          </span>
          <SessionTimer serverWarned={serverWarned} />
        </div>

        <div
          role="log"
          aria-live="polite"
          aria-label="Conversación con Simón"
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4"
        >
          {messages.length === 0 && (
            <div className="my-auto flex flex-col items-center gap-6 py-8">
              <div className="flex flex-col items-center gap-3">
                <SimonAvatar className="size-14" />
                <p className="max-w-sm text-center text-base text-ink">
                  Hola, soy Simón. ¿De qué querés hablar hoy?
                </p>
              </div>
              <div className="flex flex-col items-center gap-3">
                <p className="text-sm font-semibold text-ink-soft">
                  Si querés, empezá contándome cómo te sentís:
                </p>
                <MoodChips onPick={send} />
              </div>
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
                    ? "rounded-2xl rounded-br-sm bg-peach px-4 py-2.5 text-base text-ink"
                    : "rounded-2xl rounded-bl-sm bg-brand-soft px-4 py-2.5 text-base text-ink"
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
            <p className="self-start text-base text-ink-soft motion-safe:animate-pulse">
              Simón está escribiendo…
            </p>
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
          <p className="mt-2 text-center text-xs text-ink-soft">
            Simón acompaña, no reemplaza la ayuda de una persona.
          </p>
        </div>
      </div>
    </div>
  );
}
