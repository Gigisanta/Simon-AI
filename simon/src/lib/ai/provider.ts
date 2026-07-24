import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { withTransientRetry, type RetryOpts } from "./retry";
import { classifyAiError, recordCall, type MetricStage } from "@/lib/metrics";

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
/**
 * Parseo defensivo de una env que debe ser un objeto JSON. Reintenta
 * desescapando comillas dobles (el parser dotenv de Next conserva los `\"`
 * de un valor entre comillas: AI_EXTRA_BODY="{\"a\":1}" llega como
 * `{\"a\":1}`). Nunca lanza: JSON inválido o no-objeto → console.error + null.
 * Compartido por AI_EXTRA_BODY (abajo) y AI_FALLBACK_EXTRA_BODY (ADR-3).
 */
function parseJsonObjectEnv(raw: string | undefined, label: string): Record<string, unknown> | null {
  if (!raw?.trim()) return null;
  for (const candidate of [raw, raw.replace(/\\"/g, '"')]) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      console.error(`[ai] ${label} debe ser un objeto JSON — se ignora`);
      return null;
    } catch {
      // probar el siguiente candidato
    }
  }
  console.error(`[ai] ${label} no es JSON válido — se ignora`);
  return null;
}

let extraBodyCache: Record<string, unknown> | null | undefined;

function parseExtraBody(): Record<string, unknown> | null {
  if (extraBodyCache !== undefined) return extraBodyCache;
  extraBodyCache = parseJsonObjectEnv(process.env.AI_EXTRA_BODY, "AI_EXTRA_BODY");
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

// ---------------------------------------------------------------------------
// ADR-3 — Router de proveedores IA con fallback [arch H2]
//
// `resolveProvider(tier, run)` prueba una lista ORDENADA de proveedores
// (config por env) contra el callback `run`, con el MISMO patrón de retry por
// backoff+jitter que ya usa moderation.ts (`withTransientRetry`, lib/ai/retry)
// y health-tracking en memoria: un proveedor que falla se marca no-sano y se
// saltea (circuit-breaker) hasta `PROVIDER_CIRCUIT_REPROBE_MS` después — mismo
// patrón que el re-probe de la key de OpenAI en moderation.ts
// (`openAiKeyUsable`), aplicado por proveedor.
//
// ACTIVADO: los call sites (chat-pipeline/generate.ts, ai/memory.ts,
// moderation.ts) pasan por `resolveProvider` desde que existe un segundo
// proveedor real (MiMo v2.5 vía AI_FALLBACK_* — el primario OpenCode Go se
// queda sin tokens de suscripción). Con UN solo proveedor en env el
// comportamiento es observacionalmente idéntico al anterior (lista de 1).
// chatModel()/smallModel() quedan para scripts/tests que quieran el primario
// directo; chatModelId() sigue siendo el id del PRIMARIO y es lo que se
// telemetría en chat-pipeline/run.ts — si el fallback atendió la request, el
// console.error del router lo deja registrado (no se cambió el shape de la
// telemetría por esto). El router multi-modelo por riesgo/costo sigue fuera
// de alcance.
// ---------------------------------------------------------------------------

/** Snapshot de env para el parseo (inyectable en tests; default process.env). */
export type AiEnvSnapshot = Record<string, string | undefined>;

/** Config resuelta de UN proveedor de la lista ordenada. */
export interface ProviderConfig {
  /** Nombre estable — clave del circuit-breaker y de logging. */
  name: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** Modelo barato para tier "small"; si falta, cae al `model` principal. */
  smallModel?: string;
  extraBody?: Record<string, unknown> | null;
}

function isProviderShape(v: unknown): v is ProviderConfig {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.baseURL === "string" &&
    o.baseURL.length > 0 &&
    typeof o.apiKey === "string" &&
    typeof o.model === "string" &&
    o.model.length > 0 &&
    (o.name === undefined || typeof o.name === "string") &&
    (o.smallModel === undefined || typeof o.smallModel === "string") &&
    (o.extraBody === undefined ||
      o.extraBody === null ||
      (typeof o.extraBody === "object" && !Array.isArray(o.extraBody)))
  );
}

/**
 * `AI_PROVIDERS`: array JSON con la lista COMPLETA de proveedores, ordenada
 * (el primero es el preferido). Gana sobre los pares `AI_*`/`AI_FALLBACK_*` si
 * está presente y es válido. Parseo defensivo: JSON inválido, no-array, vacío
 * o con algún elemento sin forma de proveedor → console.error + null (cae a
 * los pares).
 */
function parseProvidersJson(raw: string | undefined): ProviderConfig[] | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error("[ai] AI_PROVIDERS no es JSON válido — se ignora, cae a AI_*/AI_FALLBACK_*");
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isProviderShape)) {
    console.error(
      "[ai] AI_PROVIDERS debe ser un array JSON no vacío de proveedores válidos " +
        "({baseURL, apiKey, model}) — se ignora, cae a AI_*/AI_FALLBACK_*",
    );
    return null;
  }
  return parsed.map((p, i) => ({
    name: p.name ?? `provider-${i}`,
    baseURL: p.baseURL,
    apiKey: p.apiKey,
    model: p.model,
    smallModel: p.smallModel,
    extraBody: p.extraBody ?? null,
  }));
}

/**
 * Lista por pares `AI_*` (primario) / `AI_FALLBACK_*` (único fallback), MISMOS
 * defaults que `chatModel()`/`smallModel()` para el primario — con la env de
 * hoy (sin `AI_FALLBACK_*`) la lista queda con un solo elemento, idéntico al
 * comportamiento actual. El fallback solo entra a la lista si hay señal
 * explícita de un segundo proveedor configurado.
 */
function parseProviderPairs(env: AiEnvSnapshot): ProviderConfig[] {
  const list: ProviderConfig[] = [
    {
      name: "primary",
      baseURL: env.AI_BASE_URL ?? "https://api.deepseek.com",
      apiKey: env.AI_API_KEY ?? "sin-configurar",
      model: env.AI_MODEL ?? "deepseek-v4-flash",
      smallModel: env.AI_SMALL_MODEL ?? env.AI_MODEL ?? "deepseek-v4-flash",
      extraBody: parseJsonObjectEnv(env.AI_EXTRA_BODY, "AI_EXTRA_BODY"),
    },
  ];

  const hasFallback = Boolean(
    env.AI_FALLBACK_BASE_URL || env.AI_FALLBACK_API_KEY || env.AI_FALLBACK_MODEL,
  );
  if (hasFallback) {
    list.push({
      name: "fallback",
      baseURL: env.AI_FALLBACK_BASE_URL ?? "https://api.deepseek.com",
      apiKey: env.AI_FALLBACK_API_KEY ?? "sin-configurar",
      model: env.AI_FALLBACK_MODEL ?? "deepseek-v4-flash",
      smallModel:
        env.AI_FALLBACK_SMALL_MODEL ?? env.AI_FALLBACK_MODEL ?? "deepseek-v4-flash",
      extraBody: parseJsonObjectEnv(env.AI_FALLBACK_EXTRA_BODY, "AI_FALLBACK_EXTRA_BODY"),
    });
  }

  return list;
}

/**
 * Lista ordenada de proveedores a partir de la env: `AI_PROVIDERS` (JSON) si
 * está presente y válida, si no los pares `AI_*`/`AI_FALLBACK_*`. Función pura
 * — testeada en scripts/provider-router-suite.ts con snapshots de env (sin
 * red, sin tocar process.env real).
 */
export function parseProviderList(env: AiEnvSnapshot = process.env): ProviderConfig[] {
  return parseProvidersJson(env.AI_PROVIDERS) ?? parseProviderPairs(env);
}

// ---------- Health-tracking (circuit-breaker en memoria) ----------

/**
 * TTL del circuit-breaker por proveedor: cuánto se saltea un proveedor
 * marcado no-sano antes de reprobrarlo. Mismo patrón que el re-probe de la key
 * de OpenAI en moderation.ts (`OPENAI_KEY_REPROBE_MS`/`openAiKeyUsable`),
 * aplicado por proveedor — más corto acá: el que falla es el proveedor
 * PRINCIPAL del chat (no una capa de moderación con piso propio), conviene
 * reprobrar rápido en vez de esperar horas.
 */
export const PROVIDER_CIRCUIT_REPROBE_MS = 5 * 60 * 1_000; // 5 min

/**
 * ¿Se puede usar el proveedor ahora? Pura y testeable con reloj falso — mismo
 * shape que `openAiKeyUsable` (moderation.ts).
 */
export function providerUsable(
  unhealthySince: number | null,
  now: number,
  reprobeMs: number = PROVIDER_CIRCUIT_REPROBE_MS,
): boolean {
  if (unhealthySince === null) return true;
  return now - unhealthySince >= reprobeMs;
}

/** Health-tracking: interfaz inyectable (tests) con default por proceso. */
export interface ProviderHealthStore {
  isUsable(name: string, now: number): boolean;
  markUnhealthy(name: string, now: number): void;
  markHealthy(name: string): void;
  /**
   * OPCIONAL: sincroniza el estado COMPARTIDO (Upstash) al espejo local antes de
   * una decisión — UN solo round-trip a Redis (o cero si el espejo está fresco).
   * El store in-memory NO lo implementa (queda `undefined`): sin este método, el
   * router se comporta EXACTO como antes (solo espejo por instancia). Nunca
   * lanza: si Redis está caído, se queda con el espejo local (degradación segura).
   */
  refresh?(names: string[], now: number): Promise<void>;
}

/** Crea un store de health-tracking aislado (default del proceso + tests). */
export function createProviderHealthStore(
  reprobeMs: number = PROVIDER_CIRCUIT_REPROBE_MS,
): ProviderHealthStore {
  const unhealthySince = new Map<string, number>();
  return {
    isUsable(name, now) {
      return providerUsable(unhealthySince.get(name) ?? null, now, reprobeMs);
    },
    markUnhealthy(name, now) {
      unhealthySince.set(name, now);
    },
    markHealthy(name) {
      unhealthySince.delete(name);
    },
  };
}

// ---------- Circuit-breaker COMPARTIDO en Upstash Redis (REST) [obj-a] ----------
//
// En serverless cada instancia tiene su propio `createProviderHealthStore` en
// memoria: cuando un proveedor se cae, CADA instancia lo reaprende con su
// primer fallo (N marcas en vez de una compartida). Este store respalda el
// mismo circuit-breaker en Upstash para que la marca de "no-sano" sea VISIBLE
// entre instancias — misma semántica (umbral = 1 fallo, ventana/reprobe =
// PROVIDER_CIRCUIT_REPROBE_MS), mismo patrón REST que lib/rate-limit.ts (fetch
// nativo, sin SDK, timeout corto, /pipeline, fallback a memoria).
//
// Mapeo a Redis (una clave por proveedor):
//   - markUnhealthy → SET clave = <since> PX <reprobeMs>: la clave EXPIRA sola
//     al cumplirse la ventana de reprobe (auto-reprobe, sin sweep). Su mera
//     existencia = "no-sano dentro de la ventana".
//   - refresh(names) → un ÚNICO /pipeline de GETs que reconcilia el espejo local
//     (fuente de las lecturas SYNC `isUsable`). Cacheado unos segundos para no
//     pegarle a Redis en cada request.
//   - markHealthy → DEL, pero SOLO si había marca local (transición no-sano→sano):
//     evita un write por cada request exitosa (el 99% del tráfico).
//
// Interfaz SYNC intacta: `isUsable/markUnhealthy/markHealthy` leen/escriben el
// espejo local al instante; la parte async (compartir con Redis) va por
// `refresh` (lecturas) y writes best-effort. Así la API pública del router
// (`resolveProvider`, `ProviderHealthStore`) no cambia de forma.

const UPSTASH_HEALTH_PREFIX = "simon:pcb:"; // provider circuit breaker
const UPSTASH_HEALTH_TIMEOUT_MS = 2_000;
/** Frescura del espejo local: dentro de esta ventana, `refresh` NO pega a Redis. */
export const PROVIDER_HEALTH_CACHE_TTL_MS = 3_000;

/** Comando(s) Upstash REST: valor de `result` por comando, o `null` si falló. */
type UpstashResult = Array<{ result?: unknown; error?: string }> | null;

export interface UpstashProviderHealthOpts {
  restUrl: string;
  restToken: string;
  reprobeMs?: number;
  cacheTtlMs?: number;
  timeoutMs?: number;
  /** `fetch` inyectable (tests con fake fetch). Default el global. */
  fetchImpl?: typeof fetch;
  /** Logger inyectable (tests). Ya viene deduplicado ("log once"). */
  onError?: (msg: string, err?: unknown) => void;
}

/**
 * Store del circuit-breaker respaldado en Upstash REST, con espejo local y
 * fallback a memoria. Función pura respecto de la red: toda la I/O pasa por
 * `fetchImpl`, así la suite la testea con fake fetch (Upstash OK / caído /
 * carreras entre instancias) sin red ni timers reales.
 */
export function createUpstashProviderHealthStore(
  opts: UpstashProviderHealthOpts,
): ProviderHealthStore {
  const reprobeMs = opts.reprobeMs ?? PROVIDER_CIRCUIT_REPROBE_MS;
  const cacheTtlMs = opts.cacheTtlMs ?? PROVIDER_HEALTH_CACHE_TTL_MS;
  const timeoutMs = opts.timeoutMs ?? UPSTASH_HEALTH_TIMEOUT_MS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.restUrl.replace(/\/$/, "");

  // "Log once": un incidente de Redis no debe inundar los logs (se degrada a
  // memoria en silencio tras el primer aviso accionable).
  let errorLogged = false;
  const report = (msg: string, err?: unknown) => {
    if (errorLogged) return;
    errorLogged = true;
    (opts.onError ?? ((m, e) => console.error(m, e instanceof Error ? e.message : (e ?? ""))))(msg, err);
  };

  // Espejo local: fuente de verdad de las lecturas SYNC entre refresh y refresh.
  const unhealthySince = new Map<string, number>();
  let lastRefresh = Number.NEGATIVE_INFINITY;
  const keyFor = (name: string) => `${UPSTASH_HEALTH_PREFIX}${name}`;

  async function pipeline(commands: unknown[][]): Promise<UpstashResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${base}/pipeline`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.restToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(commands),
        signal: controller.signal,
      });
      if (!res.ok) {
        report(`[provider-health] Upstash respondió ${res.status}; degradando a espejo local`);
        return null;
      }
      return (await res.json()) as UpstashResult;
    } catch (err) {
      report("[provider-health] fallo de red/timeout contra Upstash; degradando a espejo local", err);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    isUsable(name, now) {
      return providerUsable(unhealthySince.get(name) ?? null, now, reprobeMs);
    },
    markUnhealthy(name, now) {
      unhealthySince.set(name, now);
      // Best-effort: propagar a Redis con TTL = ventana de reprobe (auto-reprobe).
      // Fire-and-forget para no meter latencia en el camino de fallo; si no
      // llega, otra instancia lo reaprende con su primer fallo (= hoy).
      void pipeline([["SET", keyFor(name), String(now), "PX", String(reprobeMs)]]);
    },
    markHealthy(name) {
      const had = unhealthySince.delete(name);
      // Solo un DEL cuando hubo transición real no-sano→sano (no en cada éxito).
      if (had) void pipeline([["DEL", keyFor(name)]]);
    },
    async refresh(names, now) {
      if (names.length === 0) return;
      // Cache en memoria: dentro de la ventana, un solo espejo sirve todas las
      // requests sin pegarle a Redis (≤1 round-trip por decisión).
      if (now - lastRefresh < cacheTtlMs) return;
      lastRefresh = now;
      const data = await pipeline(names.map((n) => ["GET", keyFor(n)]));
      if (data === null) return; // Redis caído: seguimos con el espejo local.
      names.forEach((n, i) => {
        const raw = data[i]?.result;
        const since =
          typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : null;
        if (since !== null && Number.isFinite(since)) {
          // Estado compartido: otra instancia lo marcó no-sano.
          unhealthySince.set(n, since);
        } else {
          // `null` en Redis = sano (expiró o lo limpiaron). No pisamos una marca
          // local MÁS NUEVA que este refresh (carrera con un markUnhealthy que
          // ocurrió durante el await): esa marca todavía no llegó al GET.
          const local = unhealthySince.get(n);
          if (local === undefined || local <= now) unhealthySince.delete(n);
        }
      });
    },
  };
}

/**
 * Store del proceso (circuit-breaker real, ACTIVO): Upstash-compartido si hay
 * `UPSTASH_REDIS_REST_URL`+`TOKEN`, si no in-memory por instancia (idéntico al
 * comportamiento previo). Lazy + un solo log de aviso en el modo no-compartido.
 */
let processProviderHealth: ProviderHealthStore | undefined;
let loggedNoUpstash = false;
function getProcessProviderHealth(): ProviderHealthStore {
  if (processProviderHealth) return processProviderHealth;
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restToken) {
    processProviderHealth = createUpstashProviderHealthStore({ restUrl, restToken });
  } else {
    if (!loggedNoUpstash) {
      loggedNoUpstash = true;
      console.error(
        "[provider-health] sin UPSTASH_REDIS_REST_URL/TOKEN: circuit-breaker de " +
          "proveedores en memoria por instancia (no compartido entre instancias serverless)",
      );
    }
    processProviderHealth = createProviderHealthStore();
  }
  return processProviderHealth;
}

// ---------- Resolución + retry + fallback ----------

/**
 * Arma un cliente concreto (proveedor + modelo del SDK) para UN elemento de la
 * lista ordenada. Exportada para callers que necesitan probar un proveedor
 * puntual SIN pasar por el failover/circuit-breaker de `resolveProvider` — p.ej.
 * el health-check del cron (api/cron/health), que reporta el estado de cada
 * proveedor por separado en vez de "el primero que responda".
 */
export function buildClient(config: ProviderConfig, tier: "main" | "small") {
  const modelId = tier === "small" ? (config.smallModel ?? config.model) : config.model;
  const provider = createOpenAICompatible({
    name: config.name,
    baseURL: config.baseURL,
    apiKey: config.apiKey,
    ...(config.extraBody
      ? {
          transformRequestBody: (args: Record<string, unknown>) => ({
            ...args,
            ...config.extraBody,
          }),
        }
      : {}),
  });
  return { config, modelId, model: provider(modelId) };
}

/** Cliente resuelto: proveedor concreto + modelo del SDK listo para `generateText`. */
export type ResolvedProviderClient = ReturnType<typeof buildClient>;

export interface ResolveProviderOpts {
  /** Reloj inyectable (tests). Default `Date.now()`. */
  now?: number;
  /** Snapshot de env inyectable (tests). Default `process.env`. */
  env?: AiEnvSnapshot;
  /** Store de health-tracking inyectable (tests). Default el del proceso. */
  healthStore?: ProviderHealthStore;
  /** Reintento por proveedor — mismo módulo/patrón que moderation.ts. */
  retry?: RetryOpts;
  /**
   * Señal de la REQUEST del cliente (no el timeout por-intento). Si está
   * abortada cuando un proveedor falla, el error se relanza tal cual SIN
   * marcar el proveedor no-sano ni probar el siguiente: que un cliente cierre
   * la pestaña no dice nada de la salud del proveedor, y hacer failover sería
   * generar para nadie (además de abrir el circuit-breaker 5 min por un
   * abort ajeno al proveedor).
   */
  signal?: AbortSignal;
  /**
   * Etapa para telemetría (metrics.ts, objetivo b). Default por `tier`:
   * "generation" para "main", "memory" para "small" — moderation.ts pasa
   * "moderation" explícito para su uso de tier "small" (el único caso donde
   * el default por tier no alcanza). Nunca cambia el comportamiento del
   * router, solo a qué etiqueta se atribuye el conteo/latencia.
   */
  stage?: MetricStage;
}

/**
 * Router de proveedores con fallback (ADR-3). Prueba `run` contra cada
 * proveedor de la lista ordenada (saltando los que el circuit-breaker tiene
 * marcados no-sanos), con reintento transitorio por proveedor (mismo patrón
 * de backoff que moderation.ts vía `withTransientRetry`). Un proveedor que
 * falla (agotado el retry, o error no-transitorio) se marca no-sano y se
 * prueba el siguiente; si TODOS están marcados no-sanos se reintentan igual
 * (mejor un intento que un corte total mientras dura el TTL). Relanza el
 * último error si se agota la lista completa.
 */
export async function resolveProvider<T>(
  tier: "main" | "small",
  run: (client: ResolvedProviderClient) => Promise<T>,
  opts: ResolveProviderOpts = {},
): Promise<T> {
  const now = opts.now ?? Date.now();
  const env = opts.env ?? process.env;
  const health = opts.healthStore ?? getProcessProviderHealth();
  const stage: MetricStage = opts.stage ?? (tier === "main" ? "generation" : "memory");
  const providers = parseProviderList(env);
  if (providers.length === 0) {
    throw new Error("[ai] resolveProvider: no hay proveedores configurados");
  }

  // Estado COMPARTIDO: si el store lo soporta (Upstash), traer las marcas de
  // otras instancias antes de decidir — UN round-trip (o cero si el espejo está
  // fresco). `refresh` nunca lanza; ausente en el store in-memory (sin cambio).
  if (health.refresh) await health.refresh(providers.map((p) => p.name), now);

  const usable = providers.filter((p) => health.isUsable(p.name, now));
  const tryOrder = usable.length > 0 ? usable : providers;
  // Si `usable` quedó vacío, TODOS los proveedores de la lista están no-sanos y
  // este intento es el fallback de último recurso (ver comentario de la
  // función): telemetría "breaker-open" en vez de clasificar el error, porque
  // la señal que importa acá es "el breaker estaba abierto", no la causa
  // puntual del fallo.
  const allBreakerOpen = usable.length === 0;

  let lastErr: unknown;
  for (let i = 0; i < tryOrder.length; i += 1) {
    const config = tryOrder[i];
    const client = buildClient(config, tier);
    const attemptStartedAt = Date.now();
    try {
      const result = await withTransientRetry(() => run(client), opts.retry);
      health.markHealthy(config.name);
      recordCall(stage, config.name, Date.now() - attemptStartedAt);
      return result;
    } catch (err) {
      lastErr = err;
      // Desconexión del cliente: no es un fallo del proveedor. Relanzar sin
      // marcar no-sano ni hacer failover (ver `ResolveProviderOpts.signal`), y
      // sin telemetría: un abort ajeno al proveedor no es una señal de su salud.
      if (opts.signal?.aborted) throw err;
      health.markUnhealthy(config.name, now);
      recordCall(
        stage,
        config.name,
        Date.now() - attemptStartedAt,
        allBreakerOpen ? "breaker-open" : classifyAiError(err),
      );
      const next = tryOrder[i + 1];
      console.error(
        `[ai] proveedor "${config.name}" falló` +
          (next ? `; probando "${next.name}".` : "; sin más proveedores.") +
          ` (no-sano por ${PROVIDER_CIRCUIT_REPROBE_MS}ms)`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  throw lastErr;
}
