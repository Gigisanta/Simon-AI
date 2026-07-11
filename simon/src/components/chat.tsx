"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { memo, useEffect, useRef, useState } from "react";
import { Bienestar } from "@/components/bienestar";
import { ConversationList } from "@/components/conversation-list";
import { DiagnosisOnboarding } from "@/components/diagnosis-onboarding";
import { HelpNow } from "@/components/help-now";
import { MoodChips } from "@/components/mood-chips";
import { relativeTime } from "@/components/relative-time";
import { SessionTimer } from "@/components/session-timer";
import { SimonAvatar } from "@/components/simon-avatar";
import { useSession } from "@/lib/auth-client";
import { SESSION_WARN_APPENDIX } from "@/lib/session-limit";

/** El aviso de pausa lo emite el server (session-limit); acá solo se detecta. */
const WARN_MARKER = SESSION_WARN_APPENDIX.trim();

/**
 * Id de conversación generado por el CLIENTE (idempotencia del primer mensaje).
 * Se manda desde el primer envío: si el usuario hace doble submit (o doble click
 * en un quick-start), ambos requests llevan el MISMO id y el servidor los
 * converge en una sola Conversation en vez de crear dos. randomUUID es nativo
 * (contexto seguro: https o localhost), sin dependencias.
 */
function newConversationId(): string {
  return crypto.randomUUID();
}

/**
 * Id de mensaje generado por el CLIENTE (idempotencia del reintento, #31-3). Se
 * manda en el body de cada envío y se REUSA al reintentar el MISMO texto tras un
 * error: el servidor deduplica por este id (PK del Message) y no persiste dos
 * veces el mensaje del menor. Un envío nuevo estrena id. randomUUID nativo.
 */
function newClientMessageId(): string {
  return crypto.randomUUID();
}

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
    circle: "bg-brand-soft text-brand-strong",
    kicker: "text-brand-strong",
    icon: (
      <svg {...quickStartIconProps}>
        <path d="M20.8 8.6c0 4.4-8.8 10-8.8 10s-8.8-5.6-8.8-10a4.6 4.6 0 0 1 8.8-1.9A4.6 4.6 0 0 1 20.8 8.6z" />
      </svg>
    ),
  },
  {
    label: "ALGO ME PREOCUPA",
    message: "Hay algo que me preocupa y quiero hablarlo",
    circle: "bg-brand-soft text-brand-strong",
    kicker: "text-brand-strong",
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
    circle: "bg-brand-soft text-brand-strong",
    kicker: "text-brand-strong",
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
    circle: "bg-brand-soft text-brand-strong",
    kicker: "text-brand-strong",
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
    circle: "bg-brand-soft text-brand-strong",
    kicker: "text-brand-strong",
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
    circle: "bg-brand-soft text-brand-strong",
    kicker: "text-brand-strong",
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

/**
 * Burbuja de un mensaje. Memoizada por identidad de `message`: los mensajes ya
 * asentados conservan su referencia entre renders, así que solo la burbuja en
 * streaming (cuya prop cambia) se vuelve a renderizar, no todo el historial.
 */
const MessageBubble = memo(function MessageBubble({
  message: m,
}: {
  message: UIMessage;
}) {
  return (
    <div
      className={
        m.role === "user"
          ? "self-end flex max-w-[88%] flex-col items-end gap-1 sm:max-w-[80%]"
          : "self-start flex max-w-[90%] flex-col items-start gap-1 sm:max-w-[80%]"
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
  );
});

/**
 * Mensaje de error amigable según el status HTTP del stream de /api/chat. Evita
 * mostrar JSON crudo o un genérico cuando el motivo es conocido:
 *   - 429: rate limit (demasiados mensajes seguidos).
 *   - 403: bloqueo (p.ej. consentimiento del tutor/a pendiente / revocado).
 * Cualquier otro caso cae en el genérico tranquilizador de siempre.
 */
function chatErrorMessage(status: number | null): string {
  if (status === 429)
    return "Estás escribiendo muy seguido. Esperá unos segundos y probá de nuevo.";
  if (status === 403)
    return "Ahora mismo no podés enviar mensajes. Si sigue pasando, hablá con tu tutor/a.";
  return "Hubo un problema al enviar tu mensaje. No se perdió lo que escribiste.";
}

export function Chat() {
  const { data: session } = useSession();
  const isGuardian = session?.user.role === "guardian";
  const quickStarts = isGuardian ? GUARDIAN_QUICK_STARTS : CHILD_QUICK_STARTS;

  const [input, setInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [onboardingSkipped, setOnboardingSkipped] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  // Último texto enviado: sobrevive al vaciado del input para poder reintentar
  // si el envío falla (el input se limpia de forma optimista al enviar).
  const [lastText, setLastText] = useState("");
  const conversationIdRef = useRef<string | null>(null);
  // Id del mensaje en vuelo (#31-3): estable entre reintentos del MISMO texto.
  // Lo lee el body del transport en tiempo de request; send() lo renueva salvo
  // que sea un reintento (ver send()).
  const clientMessageIdRef = useRef<string | null>(null);
  // Último status HTTP de error del stream de /api/chat: lo captura el fetch
  // wrapper del transport (abajo) para mapear 429/403 a un mensaje amigable en
  // vez del genérico. El ref lo lee onError (callback, valor fresco); el state
  // espeja el valor para el render (no se pueden leer refs en render).
  const errorStatusRef = useRef<number | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  // Lazy init (patrón de ref perezoso, evaluado una sola vez): el primer mensaje
  // ya viaja con un id, base de la idempotencia server-side (#19-2).
  if (conversationIdRef.current === null) {
    conversationIdRef.current = newConversationId();
  }
  // Espejo en state del id de conversación (el ref no dispara render): se
  // deriva al abrir la lista para marcar la fila actual y resetear si se borra.
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Safari/iOS no siempre respeta interactive-widget=resizes-content. El
  // VisualViewport es la medida real disponible por encima del teclado.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const syncViewport = () => {
      document.documentElement.style.setProperty(
        "--visual-viewport-height",
        `${viewport.height}px`,
      );
      if (document.activeElement === composerRef.current) {
        requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ block: "end" }));
      }
    };
    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
      document.documentElement.style.removeProperty("--visual-viewport-height");
    };
  }, []);

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
          clientMessageId: clientMessageIdRef.current ?? undefined,
        }),
        fetch: (async (info: RequestInfo | URL, init?: RequestInit) => {
          // Reset por-request ANTES de disparar: si el fetch RECHAZA (offline,
          // DNS, corte) nunca llega una respuesta HTTP y, sin esto, el ref
          // conservaría el status de un intento anterior (p.ej. 429) — onError y
          // el render mostrarían un mensaje viejo para un fallo de red. Al
          // resetear primero, un rechazo deja ref/state en null y
          // chatErrorMessage cae en el genérico de conexión.
          errorStatusRef.current = null;
          setErrorStatus(null);
          const res = await fetch(info, init);
          const id = res.headers.get("x-conversation-id");
          if (id) conversationIdRef.current = id;
          // Sólo un status HTTP real de error se recuerda para el mapeo amigable
          // (429/403). Ref para onError (fresco), state para el render.
          if (!res.ok) {
            errorStatusRef.current = res.status;
            setErrorStatus(res.status);
          }
          return res;
        }) as typeof fetch,
      }),
  );

  // Anuncio para lectores de pantalla (live-region sr-only). Es ESTADO, no un
  // valor derivado del render: sólo debe poblarse ante una respuesta RECIÉN
  // generada o un error, nunca al reinyectar historial con setMessages (donde
  // status ya es "ready" y el último mensaje asistente se anunciaría como nuevo
  // — lectura no solicitada de contenido sensible, regresión de a11y). Los
  // callbacks onFinish/onError de useChat sólo disparan en respuestas del stream,
  // así que cargar un hilo del historial nunca anuncia nada.
  const [announcement, setAnnouncement] = useState("");
  const { messages, sendMessage, setMessages, stop, status, error } = useChat({
    transport,
    // Sólo respuestas completadas por streaming: se ignora abort (stop() al
    // cambiar de hilo) y los finales por error (los cubre onError). El stream NO
    // se anuncia token a token — la lista es aria-live="off" — recién acá se
    // toma el texto COMPLETO y el lector lo anuncia una sola vez.
    onFinish: ({ message, isAbort, isError, isDisconnect }) => {
      if (isAbort || isError || isDisconnect || message.role !== "assistant") {
        return;
      }
      setAnnouncement(
        message.parts
          .map((p) => (p.type === "text" ? p.text : ""))
          .join("")
          .trim(),
      );
    },
    onError: () => {
      setAnnouncement(chatErrorMessage(errorStatusRef.current));
    },
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
    // Corta cualquier stream en curso: sin esto, una respuesta en vuelo del
    // hilo actual podía escribirse sobre el historial recién reinyectado.
    stop();
    // Limpia el anuncio del hilo anterior: no debe quedar texto asistente viejo
    // en la live-region al reinyectar historial (no se anuncia, pero se descarta).
    setAnnouncement("");
    setMessages(toUiMessages(resumable.messages));
    conversationIdRef.current = resumable.id;
    setResumable(null);
  }

  // Abrir una conversación desde la lista: mismo mapeo que handleResume.
  function handleOpenConversation(detail: ConversationDetail) {
    // Corta el stream en curso antes de cambiar de hilo: evita que una
    // respuesta en vuelo (p.ej. de crisis) se pegue a la conversación abierta.
    stop();
    setAnnouncement("");
    setMessages(toUiMessages(detail.messages));
    conversationIdRef.current = detail.id;
    setResumable(null);
    setListOpen(false);
  }

  // Nueva conversación: limpia el hilo y el id (el próximo /api/chat crea una).
  function handleNewConversation() {
    // Corta el stream en curso: sin esto, una respuesta en vuelo del hilo
    // anterior seguía escribiéndose en la conversación nueva y vacía.
    stop();
    setAnnouncement("");
    setMessages([]);
    // Id fresco para el hilo nuevo (idempotencia de su primer mensaje, #19-2).
    conversationIdRef.current = newConversationId();
    // Espejo en state: sin esto quedaba stale y la lista seguía marcando la
    // conversación anterior como "actual" tras empezar una nueva.
    setCurrentConversationId(null);
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

  const serverWarned = messages.some(
    (m) =>
      m.role === "assistant" &&
      m.parts.some((p) => p.type === "text" && p.text.includes(WARN_MARKER)),
  );

  function send(text: string) {
    if (!text || busy) return;
    // Idempotencia del reintento (#31-3): reusar el id SÓLO si es un reintento del
    // mismo mensaje — hay un error visible Y el texto coincide con el último
    // enviado (es lo que manda el botón "Reintentar"). Cualquier otro envío
    // (texto distinto, o mismo texto tras un envío exitoso) estrena id.
    const isRetry = !!error && text === lastText && clientMessageIdRef.current !== null;
    if (!isRetry) clientMessageIdRef.current = newClientMessageId();
    setLastText(text);
    void sendMessage({ text });
  }

  function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    requestAnimationFrame(() => {
      if (composerRef.current) composerRef.current.style.height = "auto";
    });
    send(text);
  }

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col md:px-4 md:pb-4">
      {/*
        Divulgación obligatoria: Simón es una IA. Requisito legal: SIEMPRE
        visible y compacta para no quitarle viewport a la conversación.
      */}
      <div className="hidden shrink-0 border-b border-accent/40 bg-peach px-3 py-1 text-center text-[11px] text-accent-deep md:mt-3 md:block md:rounded-2xl md:border md:px-4 md:py-1.5 md:text-xs">
        Simón es una IA, no un profesional · crisis: <strong>135</strong> /{" "}
        <strong>102</strong>
      </div>

      {/* En mobile la conversación es edge-to-edge; desktop conserva la tarjeta. */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-card md:mt-3 md:rounded-card md:border md:border-line md:shadow-card">
        {/* Header del chat */}
        <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-2 pb-0.5 pt-[max(0.125rem,env(safe-area-inset-top))] sm:px-4 md:py-3">
          <span className="flex min-w-0 items-center gap-2 md:hidden">
            <span className="size-2 shrink-0 rounded-full bg-brand motion-safe:animate-pulse" />
            <span className="truncate text-xs font-bold text-ink-soft">
              Siempre acá para vos
            </span>
            <span className="rounded-full bg-peach px-2 py-0.5 text-[10px] font-extrabold text-accent-deep">
              IA
            </span>
          </span>
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
            {/* Ayuda ahora: crisis + recursos cercanos, siempre a mano (§7.3) */}
            <HelpNow />
            {/* Bienestar: respirar, anclar y diario emocional (autorregulación) */}
            <Bienestar />
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
              onClick={() => {
                // Captura el id vigente (ref) para marcar la fila actual.
                setCurrentConversationId(conversationIdRef.current);
                setListOpen(true);
              }}
              aria-label="Ver conversaciones"
              className="flex size-11 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-sand hover:text-ink"
            >
              <svg {...headerIconProps}>
                <path d="M8 6h13M8 12h13M8 18h13" />
                <path d="M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
            </button>
            <SessionTimer serverWarned={serverWarned} userId={session?.user.id} />
          </div>
        </div>

        {/* Live-region dedicada: anuncia el mensaje completo (no los tokens
            parciales) y los errores, una sola vez. Ver `announcement`. */}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <div
          ref={logRef}
          role="log"
          aria-live="off"
          aria-busy={busy}
          aria-label="Conversación con Simón"
          onScroll={(e) => {
            const el = e.currentTarget;
            setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
          }}
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:thin] [scrollbar-color:var(--color-line)_transparent] sm:px-4 sm:py-4"
        >
          {messages.length === 0 && (
            !isGuardian && session?.user.hasDiagnosis == null && !onboardingSkipped ? (
              <DiagnosisOnboarding
                onComplete={() => window.location.reload()}
                onSkip={() => setOnboardingSkipped(true)}
              />
            ) : (
            <div className="my-auto flex flex-col items-center gap-5 py-4 sm:gap-7 sm:py-8">
              {resumable && (
                <div className="w-full max-w-sm rounded-card bg-card p-4 text-center shadow-card">
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

              <div className="simon-rise-in flex flex-col items-center gap-3">
                <SimonAvatar className="simon-pop-in size-14" />
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
                <div className="flex w-full snap-x gap-2 overflow-x-auto pb-2 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
                  {quickStarts.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => send(item.message)}
                      className="flex min-h-11 w-[72vw] max-w-64 shrink-0 snap-start flex-col items-start gap-2 rounded-card border border-line/70 bg-card p-3 text-left shadow-sm transition-[transform,box-shadow] active:scale-[0.98] motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-card-hover sm:w-auto sm:max-w-none sm:p-4"
                    >
                      <span
                        className={`flex size-10 items-center justify-center rounded-full ${item.circle}`}
                      >
                        {item.icon}
                      </span>
                      <span
                        className={`text-xs font-extrabold uppercase tracking-wide ${item.kicker}`}
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
            )
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
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
            <div className="self-center flex flex-col items-center gap-2 text-center">
              <p className="text-base font-semibold text-danger">
                {chatErrorMessage(errorStatus)}
              </p>
              {lastText && (
                <button
                  type="button"
                  onClick={() => send(lastText)}
                  className="min-h-11 rounded-full bg-brand px-5 text-sm font-bold text-brand-fg transition-colors hover:bg-brand-strong"
                >
                  Reintentar
                </button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {busy && !atBottom && (
          <button
            type="button"
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: "smooth" })}
            className="absolute bottom-20 left-1/2 z-10 flex min-h-11 -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-card/95 px-4 text-xs font-extrabold text-brand-strong shadow-card backdrop-blur transition-[transform,opacity] active:scale-95 motion-safe:animate-pulse"
          >
            <span aria-hidden="true">↓</span>
            Simón está respondiendo
          </button>
        )}

        <div className="shrink-0 border-t border-line bg-card/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:px-4 md:pb-3 md:pt-3">
          <form onSubmit={handleSubmit} className="flex items-end gap-2">
            <textarea
              ref={composerRef}
              rows={1}
              className="max-h-28 min-h-11 flex-1 resize-none rounded-[1.4rem] border border-line bg-cream/60 px-4 py-2.5 text-base leading-6 text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-soft focus:border-brand focus:shadow-[0_0_0_3px_rgb(90_127_97/0.12)]"
              placeholder="Escribile a Simón…"
              aria-label="Tu mensaje para Simón"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                e.currentTarget.style.height = "auto";
                e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 112)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  const text = input.trim();
                  if (!text || busy) return;
                  setInput("");
                  requestAnimationFrame(() => {
                    if (composerRef.current) composerRef.current.style.height = "auto";
                  });
                  send(text);
                }
              }}
              maxLength={2000}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Enviar mensaje"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-fg shadow-sm transition-[background-color,transform,opacity] active:scale-90 hover:bg-brand-strong disabled:opacity-40"
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
        currentConversationId={currentConversationId}
        onClose={() => setListOpen(false)}
        onOpenConversation={handleOpenConversation}
        onNewConversation={handleNewConversation}
      />
    </div>
  );
}
