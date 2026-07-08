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
    <div className="flex flex-1 flex-col w-full max-w-2xl mx-auto">
      {/* Divulgación obligatoria: Simón es una IA (único uso de ámbar) */}
      <div className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
        Simón es un asistente de inteligencia artificial, no una persona ni un
        profesional de la salud. Si estás en peligro o en crisis, contactá una
        línea de ayuda: en Argentina, llamá al <strong>135</strong> (CAS) o al{" "}
        <strong>102</strong> (niñas, niños y adolescentes).
      </div>

      {/* Header del chat: timer de sesión discreto (aparece a los 20 min) */}
      <div className="flex min-h-6 items-center justify-end px-4 pt-2">
        <SessionTimer serverWarned={serverWarned} />
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Conversación con Simón"
        className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4"
      >
        {messages.length === 0 && (
          <div className="my-auto flex flex-col items-center gap-6 py-8">
            <div className="flex flex-col items-center gap-3">
              <SimonAvatar className="size-10" />
              <p className="text-center text-base text-stone-700 dark:text-stone-300">
                Hola, soy Simón. ¿De qué querés hablar hoy?
              </p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <p className="text-sm text-stone-600 dark:text-stone-400">
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
            <span className="flex items-center gap-1.5 px-1 text-xs font-medium text-stone-600 dark:text-stone-400">
              {m.role === "assistant" && <SimonAvatar className="size-5" />}
              {m.role === "user" ? "Vos" : "Simón"}
            </span>
            <div
              className={
                m.role === "user"
                  ? "rounded-2xl rounded-br-sm bg-teal-800 px-4 py-2.5 text-base text-white calm:bg-stone-600 dark:bg-teal-900 dark:text-teal-50 dark:calm:bg-stone-700 dark:calm:text-stone-100"
                  : "rounded-2xl rounded-bl-sm border border-stone-200 bg-white px-4 py-2.5 text-base text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
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
          <p className="self-start text-base text-stone-600 motion-safe:animate-pulse dark:text-stone-400">
            Simón está escribiendo…
          </p>
        )}
        {error && (
          <p className="self-center text-base text-red-700 dark:text-red-400">
            Hubo un problema. Probá enviar tu mensaje de nuevo.
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="sticky bottom-0 flex gap-2 border-t border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950"
      >
        <input
          className="min-h-11 flex-1 rounded-full border border-stone-300 bg-white px-4 text-base text-stone-900 outline-none placeholder:text-stone-600 focus:border-teal-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-400 dark:focus:border-teal-400"
          placeholder="Escribí tu mensaje…"
          aria-label="Tu mensaje para Simón"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="min-h-11 rounded-full bg-teal-800 px-5 text-base font-medium text-white transition-colors hover:bg-teal-900 disabled:opacity-50 calm:bg-stone-600 calm:hover:bg-stone-700 dark:bg-teal-300 dark:text-teal-950 dark:hover:bg-teal-200 dark:calm:bg-stone-400 dark:calm:text-stone-950"
        >
          Enviar
        </button>
      </form>
    </div>
  );
}
