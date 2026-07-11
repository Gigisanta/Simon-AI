"use client";

import { useState } from "react";
import { SimonAvatar } from "@/components/simon-avatar";

/**
 * Onboarding inicial para el menor: pregunta si tiene diagnóstico o no,
 * y orienta los primeros pasos según la respuesta.
 *
 * Se muestra en el empty state del chat cuando `hasDiagnosis` es null
 * (el chico todavía no respondió). Después de responder, el padre
 * refresca para mostrar el chat normal.
 */

type Step = "ask" | "with-dx" | "without-dx" | "saving";

export function DiagnosisOnboarding({
  onComplete,
  onSkip,
}: {
  /** Se llama cuando el usuario respondió y se guardó exitosamente. */
  onComplete(): void;
  /** Permite entrar al chat sin persistir una respuesta. */
  onSkip(): void;
}) {
  const [step, setStep] = useState<Step>("ask");
  const [error, setError] = useState<string | null>(null);

  async function answer(hasDiagnosis: boolean) {
    setError(null);
    setStep("saving");
    try {
      const res = await fetch("/api/user/diagnosis", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hasDiagnosis }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "No se pudo guardar. Probá de nuevo.");
        setStep("ask");
        return;
      }
      // Mostrar pantalla según respuesta antes de pasar al chat
      setStep(hasDiagnosis ? "with-dx" : "without-dx");
    } catch {
      setError("Error de conexión. Probá de nuevo.");
      setStep("ask");
    }
  }

  return (
    <div className="simon-rise-in my-auto flex flex-col items-center gap-6 py-8">
      <SimonAvatar className="simon-pop-in size-14" />

      {step === "ask" && (
        <>
          <div className="simon-rise-in flex flex-col items-center gap-2 text-center">
            <p className="max-w-sm text-base font-bold text-ink">
              ¡Hola! Antes de empezar, quiero conocerte un poco mejor
            </p>
            <p className="max-w-sm text-sm text-ink-soft">
              ¿Tenés algún diagnóstico como TEA, TDAH, o alguna otra condición?
              Decime lo que sepas, así puedo ayudarte mejor.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-sm font-semibold text-danger">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => answer(true)}
              className="min-h-11 rounded-full bg-brand px-6 text-sm font-bold text-brand-fg transition-colors hover:bg-brand-strong"
            >
              Sí, tengo un diagnóstico
            </button>
            <button
              type="button"
              onClick={() => answer(false)}
              className="min-h-11 rounded-full border border-line bg-card px-6 text-sm font-bold text-ink transition-colors hover:bg-sand"
            >
              No, no tengo
            </button>
          </div>

          <button
            type="button"
            onClick={onSkip}
            className="text-sm font-semibold text-ink-soft underline-offset-2 hover:underline"
          >
            Prefiero no decirlo ahora
          </button>
        </>
      )}

      {step === "saving" && (
        <div className="simon-pop-in flex flex-col items-center gap-3">
          <div
            aria-hidden="true"
            className="size-10 rounded-full border-2 border-brand border-r-transparent motion-safe:animate-spin"
          />
          <p className="text-sm text-ink-soft">Guardando…</p>
        </div>
      )}

      {step === "with-dx" && (
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p className="text-base font-bold text-ink">
            ¡Gracias por contarme! 💙
          </p>
          <p className="text-sm text-ink-soft">
            Ahora sé un poco más de vos. Vamos a charlar a tu ritmo — contame
            lo que quieras, lo que te gusta, lo que te preocupa, o simplemente
            cómo estás hoy.
          </p>
          <p className="text-sm text-ink-soft">
            Siempre que quieras, puedo ayudarte a entender lo que te pasa y
            encontrar formas de sentirte mejor.
          </p>
          <button
            type="button"
            onClick={onComplete}
            className="mt-2 min-h-11 rounded-full bg-brand px-6 text-sm font-bold text-brand-fg transition-colors hover:bg-brand-strong"
          >
            ¡Empezar!
          </button>
        </div>
      )}

      {step === "without-dx" && (
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p className="text-base font-bold text-ink">
            ¡Gracias por contarme! 🌟
          </p>
          <p className="text-sm text-ink-soft">
            No hace falta tener un diagnóstico para que podamos hablar. Simón
            está acá para escucharte y acompañarte con lo que sea que estés
            viviendo.
          </p>
          <p className="text-sm text-ink-soft">
            Podemos empezar por donde quieras: contame cómo te sentís, si hay
            algo que te preocupa, o si querés conocer herramientas para
            entenderte mejor.
          </p>
          <button
            type="button"
            onClick={onComplete}
            className="mt-2 min-h-11 rounded-full bg-brand px-6 text-sm font-bold text-brand-fg transition-colors hover:bg-brand-strong"
          >
            ¡Empezar!
          </button>
        </div>
      )}
    </div>
  );
}
