import { generateText, type ModelMessage } from "ai";
import { generationTimeoutMs, resolveProvider } from "@/lib/ai/provider";
import type { GenerationResult } from "./types";

/**
 * Stage `generate` (ADR-1): llamada al LLM con retry transitorio, timeout y
 * abort por desconexión del cliente. Nunca lanza (sentinel ok:false).
 */

// Parámetros de generación por rol (B3). Los tutores/as pueden elaborar más
// (hasta ~5 párrafos) y con un tono algo más determinístico; los menores
// reciben respuestas cortas por diseño y una pizca más de calidez/variación.
const MAX_OUTPUT_TOKENS_GUARDIAN = 1_400;
const MAX_OUTPUT_TOKENS_CHILD = 700;
const TEMPERATURE_GUARDIAN = 0.5;
const TEMPERATURE_CHILD = 0.6;

/** Parámetros de generación según el rol del interlocutor (B3). */
export function generationParams(role: string | null | undefined): {
  maxOutputTokens: number;
  temperature: number;
} {
  const isGuardian = role === "guardian";
  return {
    maxOutputTokens: isGuardian
      ? MAX_OUTPUT_TOKENS_GUARDIAN
      : MAX_OUTPUT_TOKENS_CHILD,
    temperature: isGuardian ? TEMPERATURE_GUARDIAN : TEMPERATURE_CHILD,
  };
}

/**
 * Genera la respuesta completa (no streaming) para poder moderar la salida
 * ANTES de mostrarla. Nunca lanza: envuelve el error en un sentinel para que
 * un fallo de generación NO tumbe el Promise.all y no enmascare una crisis
 * detectada por la moderación de entrada que corre en paralelo.
 *
 * Devuelve un generador por-request (cierra sobre mensajes/params/señal) que
 * se invoca con el system prompt: la generación paralela y la regeneración por
 * "riesgo" pasan por la MISMA función.
 */
export function createReplyGenerator(args: {
  messages: ModelMessage[];
  temperature: number;
  maxOutputTokens: number;
  /** Señal de la request HTTP: distingue desconexión del cliente vs timeout. */
  reqSignal: AbortSignal;
}): (sys: string) => Promise<GenerationResult> {
  const { messages, temperature, maxOutputTokens, reqSignal } = args;
  return async function generateReply(sys: string): Promise<GenerationResult> {
    try {
      // ADR-3: router de proveedores con fallback (primary → AI_FALLBACK_*).
      // El retry transitorio (#36) vive DENTRO de resolveProvider, por
      // proveedor: 1 reintento corto SOLO ante error transitorio (5xx/red).
      // El AbortSignal.timeout se crea DENTRO del callback → cada intento (y
      // cada proveedor) tiene su propia señal fresca (una ya abortada quedaría
      // inservible). Un timeout/abort NO es transitorio → no se reintenta en el
      // MISMO proveedor (es el tope de latencia por intento), pero un primario
      // colgado SÍ pasa al fallback: peor caso real con 2 proveedores ≈
      // 2·timeout-por-intento + backoff, que entra en el maxDuration de la ruta
      // (CHAT_ROUTE_MAX_DURATION_S=90 vs timeout default 25s — ver
      // lib/ai/retry.ts y lib/ai/limits.ts).
      const g = await resolveProvider(
        "main",
        (client) =>
          generateText({
            model: client.model,
            system: sys,
            messages,
            temperature,
            maxOutputTokens, // por rol: corto para menores
            // M3: un modelo colgado no puede dejar al menor esperando hasta el
            // maxDuration de la ruta. Se aborta y el catch de acá abajo devuelve el
            // fallback amable. Cubre la generación paralela y la regeneración por
            // riesgo (ambas pasan por generateReply).
            //
            // #19-1: se combina con `req.signal` (AbortSignal.any): si el cliente
            // corta la conexión (cerró la pestaña, navegó), se aborta la llamada
            // cara al LLM en vez de seguir generando para nadie. La distinción
            // entre timeout y desconexión se hace luego con `req.signal.aborted`
            // (true SOLO si abortó el cliente; el timeout no lo marca).
            abortSignal: AbortSignal.any([
              reqSignal,
              AbortSignal.timeout(generationTimeoutMs()),
            ]),
          }),
        // La desconexión del cliente corta el loop del router: sin failover ni
        // circuit-breaker abierto por un abort que no es culpa del proveedor.
        { signal: reqSignal },
      );
      // #6 (telemetría prefix-cache): visibilidad inmediata en logs del efecto
      // de #4/#5 (system prompt estable + ventana con histéresis), sin esperar
      // una query a InteractionLog (que ya persiste cacheReadTokens vía B4).
      // Provider-dependiente: si el proveedor no reporta cached tokens, no
      // logueamos nada (undefined) en vez de un 0% engañoso.
      const cacheRead = g.usage?.inputTokenDetails?.cacheReadTokens;
      const inputTok = g.usage?.inputTokens;
      if (typeof cacheRead === "number" && typeof inputTok === "number" && inputTok > 0) {
        console.info(
          `[chat] prefix-cache: ${cacheRead}/${inputTok} input tokens cacheados (${Math.round((cacheRead / inputTok) * 100)}%)`,
        );
      }
      return {
        ok: true,
        text: g.text,
        usage: g.usage,
        // B4: latencia de la llamada al modelo (AI SDK v7). El campo performance
        // vive por STEP (no en el result); generamos en un solo step (sin tools),
        // así el último step cubre toda la generación. Defensivo con `?.`.
        generationLatencyMs: g.steps.at(-1)?.performance?.responseTimeMs ?? null,
      };
    } catch (err) {
      // #19-1: desconexión del cliente (req.signal) NO es un error de
      // generación — se loguea como evento esperado, sin stack ruidoso. Un
      // timeout de generación (AbortSignal.timeout) SÍ conserva el log de error.
      if (reqSignal.aborted) {
        console.info("[chat] generación abortada: el cliente cortó la conexión");
      } else {
        console.error("[chat] error generando respuesta:", err);
      }
      return { ok: false };
    }
  };
}
