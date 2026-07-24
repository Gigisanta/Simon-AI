/**
 * Observabilidad mínima in-process (objetivo b).
 *
 * Contadores + latencias por ETAPA del pipeline de IA (generación, moderación,
 * memoria) y por PROVEEDOR (config.name del router — "primary"/"fallback",
 * ADR-3), sin dependencias nuevas: todo vive en memoria del proceso (se
 * resetea en cada deploy/cold-start, igual que el circuit-breaker de
 * provider.ts — mismo trade-off, aceptado por ser observabilidad barata, no
 * un sistema de series temporales).
 *
 * SIN PII (invariante, app de menores): esta capa JAMÁS recibe contenido de
 * mensajes ni userIds — solo (stage, provider, ms, categoría de error). Los
 * call sites que instrumentan (provider.ts, moderation.ts) ya tienen esa
 * disciplina; este módulo ni siquiera acepta un parámetro para texto/usuario,
 * así que no hay vector de fuga por descuido de un caller futuro.
 *
 * PERCENTILES BARATOS (p50/p95): reservoir sampling necesitaría guardar N
 * muestras y ordenar (memoria no acotada + no determinístico sin semilla fija
 * para tests). En su lugar, histograma de buckets FIJOS (potencias de ~2 en
 * ms): cada llamada solo incrementa un contador de bucket (O(1), memoria
 * constante). El percentil se aproxima devolviendo el LÍMITE SUPERIOR del
 * bucket donde cae el rango — una sobre-estimación acotada y determinística,
 * suficiente para "¿estamos degradando?", no para SLOs finos.
 */

/** Etapas instrumentadas del pipeline de IA. */
export type MetricStage = "generation" | "moderation" | "memory";

/**
 * Categorías de error observadas:
 *  - "timeout": abort/timeout (presupuesto de latencia agotado — ver ai/retry.ts).
 *  - "http": error HTTP (4xx/5xx) o de red del proveedor.
 *  - "breaker-open": el circuit-breaker del router (ADR-3) tenía TODOS los
 *    proveedores marcados no-sanos y este intento se hizo igual (fallback de
 *    último recurso) — señal de degradación del proveedor, no del request.
 *  - "moderation": la cascada de moderación (moderation.ts) no pudo concluir
 *    con NINGUNA capa (OpenAI ni LLM) — degradación de la capa de seguridad 2.
 *  - "other": cualquier error que no calce en las anteriores (catch-all —
 *    mejor una categoría "other" visible que perder la señal o lanzar).
 */
export type ErrorCategory = "timeout" | "http" | "breaker-open" | "moderation" | "other";

const ERROR_CATEGORIES: readonly ErrorCategory[] = [
  "timeout",
  "http",
  "breaker-open",
  "moderation",
  "other",
];

/**
 * Límites superiores (ms) de los buckets finitos del histograma, ORDENADOS
 * ascendente. Cubren desde una respuesta rápida de moderación (OpenAI, timeout
 * 3s) hasta una generación colgada (timeout default 25s) con margen. Hay un
 * bucket adicional implícito "overflow" (> último límite) — por eso todo array
 * de conteos por bucket tiene `BUCKET_BOUNDS_MS.length + 1` posiciones.
 */
export const BUCKET_BOUNDS_MS: readonly number[] = [
  50, 100, 200, 400, 800, 1_500, 3_000, 6_000, 12_000, 25_000,
];

/** Índice del bucket (0-based) donde cae `ms`. El último índice es "overflow". */
function bucketIndexFor(ms: number, bounds: readonly number[] = BUCKET_BOUNDS_MS): number {
  const clamped = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  for (let i = 0; i < bounds.length; i += 1) {
    if (clamped <= bounds[i]) return i;
  }
  return bounds.length; // overflow
}

/**
 * Percentil aproximado a partir de conteos por bucket. Pura y testeable con
 * datos conocidos (scripts/metrics-suite.ts). `bucketCounts` debe tener
 * `bounds.length + 1` posiciones (la última es el overflow). Devuelve el
 * LÍMITE SUPERIOR del bucket cuyo conteo acumulado alcanza el rango
 * `ceil(p/100 * total)` (1-indexado) — una sobre-estimación determinística.
 * `null` si no hay muestras (total === 0). El bucket overflow se reporta como
 * el último límite finito (piso: el valor real puede ser mayor).
 */
export function percentileFromBuckets(
  bucketCounts: readonly number[],
  bounds: readonly number[],
  p: number,
): number | null {
  const total = bucketCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = Math.ceil((p / 100) * total);
  let cumulative = 0;
  for (let i = 0; i < bucketCounts.length; i += 1) {
    cumulative += bucketCounts[i];
    if (cumulative >= rank) {
      // Índice del último bucket finito = bounds.length - 1; el overflow
      // (índice bounds.length) no tiene límite propio, se reporta con el
      // último finito como piso.
      return bounds[Math.min(i, bounds.length - 1)];
    }
  }
  return bounds[bounds.length - 1];
}

/** Snapshot serializable de un par (stage, provider). */
export interface StageProviderSnapshot {
  count: number;
  errors: Record<ErrorCategory, number>;
  p50: number | null;
  p95: number | null;
}

/** Snapshot completo: por etapa, por proveedor. */
export type MetricsSnapshot = Partial<Record<MetricStage, Record<string, StageProviderSnapshot>>>;

interface StageProviderState {
  count: number;
  buckets: number[]; // BUCKET_BOUNDS_MS.length + 1 posiciones
  errors: Record<ErrorCategory, number>;
}

function emptyErrors(): Record<ErrorCategory, number> {
  const errors = {} as Record<ErrorCategory, number>;
  for (const cat of ERROR_CATEGORIES) errors[cat] = 0;
  return errors;
}

function newState(): StageProviderState {
  return {
    count: 0,
    buckets: new Array(BUCKET_BOUNDS_MS.length + 1).fill(0),
    errors: emptyErrors(),
  };
}

/** Store de métricas — interfaz inyectable (tests) con default por proceso. */
export interface MetricsStore {
  /**
   * Registra UN intento (stage, provider): incrementa el conteo y el bucket
   * de latencia; si `error` está presente, suma también esa categoría.
   * Nunca lanza.
   */
  recordCall(stage: MetricStage, provider: string, ms: number, error?: ErrorCategory): void;
  /** Snapshot inmutable apto para JSON (Response.json de la ruta interna). */
  snapshot(): MetricsSnapshot;
}

/** Crea un store aislado (default del proceso + tests deterministas). */
export function createMetricsStore(): MetricsStore {
  const state = new Map<MetricStage, Map<string, StageProviderState>>();

  return {
    recordCall(stage, provider, ms, error) {
      let byProvider = state.get(stage);
      if (!byProvider) {
        byProvider = new Map();
        state.set(stage, byProvider);
      }
      let entry = byProvider.get(provider);
      if (!entry) {
        entry = newState();
        byProvider.set(provider, entry);
      }
      entry.count += 1;
      entry.buckets[bucketIndexFor(ms)] += 1;
      if (error) entry.errors[error] += 1;
    },
    snapshot() {
      const out: MetricsSnapshot = {};
      for (const [stage, byProvider] of state) {
        const providers: Record<string, StageProviderSnapshot> = {};
        for (const [provider, entry] of byProvider) {
          providers[provider] = {
            count: entry.count,
            errors: { ...entry.errors },
            p50: percentileFromBuckets(entry.buckets, BUCKET_BOUNDS_MS, 50),
            p95: percentileFromBuckets(entry.buckets, BUCKET_BOUNDS_MS, 95),
          };
        }
        out[stage] = providers;
      }
      return out;
    },
  };
}

/** Métricas del proceso (singleton — mismo patrón que processProviderHealth). */
const processMetrics = createMetricsStore();

/** Registra un intento en el store del proceso (usan provider.ts/moderation.ts). */
export function recordCall(
  stage: MetricStage,
  provider: string,
  ms: number,
  error?: ErrorCategory,
): void {
  processMetrics.recordCall(stage, provider, ms, error);
}

/** Snapshot del store del proceso (lo expone GET /api/internal/metrics). */
export function snapshotMetrics(): MetricsSnapshot {
  return processMetrics.snapshot();
}

// ---------- Clasificación de errores (reintento acotado, ver ai/retry.ts) ----------

/** Recorre el error y su cadena de `cause` (acotada) sin ciclar. */
function* errorChain(err: unknown, maxDepth = 4): Generator<Record<string, unknown>> {
  let current: unknown = err;
  const seen = new Set<unknown>();
  for (let i = 0; i < maxDepth && current && typeof current === "object"; i += 1) {
    if (seen.has(current)) return;
    seen.add(current);
    yield current as Record<string, unknown>;
    current = (current as { cause?: unknown }).cause;
  }
}

function nameOf(e: Record<string, unknown>): string {
  return typeof e.name === "string" ? e.name : "";
}
function codeOf(e: Record<string, unknown>): string {
  return typeof e.code === "string" ? e.code : "";
}
function messageOf(e: Record<string, unknown>): string {
  return typeof e.message === "string" ? e.message : "";
}
function statusOf(e: Record<string, unknown>): number | undefined {
  return typeof e.statusCode === "number"
    ? e.statusCode
    : typeof e.status === "number"
      ? e.status
      : undefined;
}

const TRANSIENT_NET_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EPIPE",
]);

/**
 * Clasifica un error de una llamada al proveedor de IA en una `ErrorCategory`.
 * Pura y testeable con shapes representativos (mismo patrón de detección que
 * `isTransientError`, lib/ai/retry.ts, pero para telemetría en vez de decidir
 * reintento). NO decide "breaker-open" ni "moderation" — esas las asigna el
 * caller (son señales de contexto del router/cascada, no del error en sí).
 */
export function classifyAiError(err: unknown): ErrorCategory {
  for (const e of errorChain(err)) {
    if (nameOf(e) === "AbortError" || nameOf(e) === "TimeoutError") return "timeout";
  }
  for (const e of errorChain(err)) {
    const status = statusOf(e);
    if (typeof status === "number") return "http";
    if (TRANSIENT_NET_CODES.has(codeOf(e))) return "http";
    if (/\bfetch failed\b|socket hang up|network error/i.test(messageOf(e))) return "http";
  }
  return "other";
}
