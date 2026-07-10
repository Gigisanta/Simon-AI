import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Proveedor de IA intercambiable.
 *
 * Cualquier endpoint compatible con la API de OpenAI funciona cambiando
 * solo variables de entorno (sin tocar código):
 *   - DeepSeek, OpenRouter, Groq, Together, etc.
 *   - Un modelo propio fine-tuneado servido con vLLM u Ollama.
 */

/**
 * AI_EXTRA_BODY: JSON extra que se mergea (shallow) al body de TODA request
 * de chat/completions.
 *
 * POR QUÉ EXISTE: algunos gateways activan modos que rompen el flujo por
 * defecto. Caso real: deepseek-v4-flash detrás del gateway OpenCode Go
 * arranca en modo "thinking" y quema todo `max_tokens` en reasoning_content,
 * devolviendo `content` vacío. El fix (verificado con curl) es mandar
 * `{"thinking":{"type":"disabled"}}` en el body. Como es específico del
 * gateway, va por env y no hardcodeado.
 *
 * Parseo defensivo, UNA sola vez por proceso: JSON inválido o no-objeto →
 * console.error y se ignora (la app nunca muere por esta env).
 */
let extraBodyCache: Record<string, unknown> | null | undefined;

function parseExtraBody(): Record<string, unknown> | null {
  if (extraBodyCache !== undefined) return extraBodyCache;
  extraBodyCache = null;
  const raw = process.env.AI_EXTRA_BODY;
  if (raw?.trim()) {
    // El parser dotenv de Next conserva los `\"` de un valor entre comillas
    // dobles (AI_EXTRA_BODY="{\"a\":1}" llega como `{\"a\":1}`): si el parseo
    // directo falla, se reintenta desescapando. Caso real, no especulativo.
    for (const candidate of [raw, raw.replace(/\\"/g, '"')]) {
      try {
        const parsed: unknown = JSON.parse(candidate);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          extraBodyCache = parsed as Record<string, unknown>;
        } else {
          console.error("[ai] AI_EXTRA_BODY debe ser un objeto JSON — se ignora");
        }
        return extraBodyCache;
      } catch {
        // probar el siguiente candidato
      }
    }
    console.error("[ai] AI_EXTRA_BODY no es JSON válido — se ignora");
  }
  return extraBodyCache;
}

function getProvider() {
  const extraBody = parseExtraBody();
  return createOpenAICompatible({
    name: "simon-llm",
    baseURL: process.env.AI_BASE_URL ?? "https://api.deepseek.com",
    apiKey: process.env.AI_API_KEY ?? "sin-configurar",
    // Hook oficial del SDK para modificar el body de chat/completions antes
    // de enviarlo (streaming y no-streaming). Merge shallow: AI_EXTRA_BODY
    // pisa las claves top-level que colisionen.
    ...(extraBody
      ? { transformRequestBody: (args: Record<string, unknown>) => ({ ...args, ...extraBody }) }
      : {}),
  });
}

/** Id del modelo principal (para telemetría/logging — misma fuente que chatModel). */
export function chatModelId(): string {
  return process.env.AI_MODEL ?? "deepseek-v4-flash";
}

/** Modelo principal de conversación. */
export function chatModel() {
  return getProvider()(chatModelId());
}

/** Modelo barato para tareas auxiliares (títulos, extracción de memoria). */
export function smallModel() {
  return getProvider()(
    process.env.AI_SMALL_MODEL ?? process.env.AI_MODEL ?? "deepseek-v4-flash",
  );
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY);
}

/**
 * Timeout de generación en ms (M3). Un modelo/gateway colgado no puede dejar al
 * menor esperando hasta el `maxDuration` de la ruta: se aborta y el caller da un
 * fallback amable. Configurable por `AI_GENERATION_TIMEOUT_MS` (default 25s, con
 * holgura dentro del maxDuration de la ruta de chat, CHAT_ROUTE_MAX_DURATION_S en
 * lib/ai/limits.ts). Un valor inválido o no
 * positivo cae al default.
 */
export function generationTimeoutMs(): number {
  const raw = Number(process.env.AI_GENERATION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 25_000;
}
