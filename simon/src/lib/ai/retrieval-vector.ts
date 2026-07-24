import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { embed } from "ai";
import type { KnowledgeCard } from "@/generated/prisma/client";
import { parseProviderList, type AiEnvSnapshot } from "./provider";
import { scoreRelevantCards, selectRelevantCards } from "./system-prompt";

/**
 * Retrieval semántico opcional de fichas con pgvector — DETRÁS de un flag.
 *
 * El retrieval de hoy (system-prompt.ts) es LÉXICO: solapamiento de términos.
 * Funciona bien con el corpus chico (< ~200 fichas), pero no captura
 * sinónimos/paráfrasis ("me cuesta prestar atención" no matchea "TDAH").
 * Este módulo agrega una capa semántica: embebe la consulta, la compara por
 * similaridad coseno contra los embeddings guardados de las fichas y MEZCLA esa
 * señal con el score léxico.
 *
 * PRINCIPIO RECTOR — el camino por defecto NO cambia en absoluto:
 *   - Se activa SOLO con `RETRIEVAL_PGVECTOR=1` y credenciales presentes.
 *   - Ante CUALQUIER error (sin flag, sin key, sin extensión pgvector, tabla
 *     inexistente, timeout, embedding inválido, red caída) cae de forma
 *     TRANSPARENTE al retrieval léxico actual (`selectRelevantCards`), con el
 *     MISMO resultado que hoy. Nunca lanza.
 *
 * No está cableado al pipeline todavía (entrega detrás de flag, sin aplicar
 * nada a ninguna DB). Para activarlo cuando exista la tabla `Embedding` (ver
 * prisma/migrations/20260724000000_pgvector_embeddings) y los embeddings estén
 * seedeados, reemplazar en chat-pipeline/build-context.ts:
 *     cards: selectRelevantCards(cards, userText),
 * por:
 *     cards: await selectRelevantCardsSemantic(cards, userText),
 * (buildChatContext ya es async). Con el flag apagado ese await devuelve
 * exactamente lo mismo que hoy.
 */

// ---------------------------------------------------------------------------
// Config por entorno
// ---------------------------------------------------------------------------

/** Dimensión de embedding por defecto (OpenAI text-embedding-3-small / MiMo). */
export const DEFAULT_EMBED_DIM = 1536;
/** Peso por defecto de la señal semántica en la mezcla (0 = solo léxico, 1 = solo coseno). */
export const DEFAULT_VECTOR_WEIGHT = 0.7;
/** Timeout por defecto del embedding de la consulta (ms). */
export const DEFAULT_EMBED_TIMEOUT_MS = 8_000;

export interface VectorRetrievalConfig {
  /** true solo si el flag está en "1" Y hay credenciales de proveedor. */
  enabled: boolean;
  /** Dimensión esperada de los vectores (RETRIEVAL_EMBED_DIM, default 1536). */
  dim: number;
  /** Id del modelo de embeddings (AI_EMBEDDING_MODEL). */
  model: string;
  /** Peso de la señal semántica en la mezcla [0,1] (RETRIEVAL_VECTOR_WEIGHT). */
  vectorWeight: number;
  /** Timeout del embedding de la consulta en ms (RETRIEVAL_EMBED_TIMEOUT_MS). */
  timeoutMs: number;
}

function positiveIntOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && Number.isInteger(n) ? n : fallback;
}

function floatInRangeOr(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/**
 * ¿Hay credenciales reales del proveedor primario? Reutiliza `parseProviderList`
 * (misma fuente que el router de chat) para cubrir tanto `AI_API_KEY` como
 * `AI_PROVIDERS`. El centinela "sin-configurar" del default cuenta como ausente.
 */
function credentialsPresent(env: AiEnvSnapshot): boolean {
  const [primary] = parseProviderList(env);
  return Boolean(
    primary && primary.apiKey && primary.apiKey !== "sin-configurar",
  );
}

/** Resuelve la config del retrieval semántico desde el entorno. Función pura. */
export function resolveVectorConfig(
  env: AiEnvSnapshot = process.env,
): VectorRetrievalConfig {
  const flagOn = env.RETRIEVAL_PGVECTOR === "1";
  return {
    enabled: flagOn && credentialsPresent(env),
    dim: positiveIntOr(env.RETRIEVAL_EMBED_DIM, DEFAULT_EMBED_DIM),
    model: env.AI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small",
    vectorWeight: floatInRangeOr(
      env.RETRIEVAL_VECTOR_WEIGHT,
      0,
      1,
      DEFAULT_VECTOR_WEIGHT,
    ),
    timeoutMs: positiveIntOr(env.RETRIEVAL_EMBED_TIMEOUT_MS, DEFAULT_EMBED_TIMEOUT_MS),
  };
}

/** ¿Está activo el retrieval por pgvector ahora mismo? (flag + credenciales). */
export function pgvectorEnabled(env: AiEnvSnapshot = process.env): boolean {
  return resolveVectorConfig(env).enabled;
}

// ---------------------------------------------------------------------------
// Núcleo puro: similaridad coseno + mezcla + ranking (testeable sin red ni DB)
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Similaridad coseno entre dos vectores. Pura y defensiva:
 *   - longitudes distintas o vector vacío → 0 (no comparables).
 *   - algún vector cero (sin dirección) → 0.
 *   - resultado no finito (NaN/Inf por valores basura) → 0.
 * Rango normal para embeddings de texto: ~[0, 1] (nunca por debajo de -1).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Number.isFinite(sim) ? sim : 0;
}

/**
 * Mezcla la señal semántica (coseno) con la léxica ya normalizada a [0,1]:
 *   score = w · semantic + (1 - w) · lexicalNorm
 * `vectorWeight` se recorta a [0,1]. Pura.
 */
export function blendScore(
  semantic: number,
  lexicalNorm: number,
  vectorWeight: number,
): number {
  const w = clamp01(vectorWeight);
  return w * semantic + (1 - w) * lexicalNorm;
}

/** Ficha candidata con su score léxico crudo y (opcional) su embedding. */
export interface ScoredCandidate {
  id: string;
  /** Score léxico crudo (≥ 0) — el de `scoreRelevantCards`. */
  lexicalScore: number;
  /** Embedding almacenado de la ficha, o null si no lo tiene. */
  embedding: number[] | null;
}

/** Resultado del ranking mezclado, con las componentes para inspección/tests. */
export interface RankedCandidate {
  id: string;
  /** Score final mezclado. */
  score: number;
  /** Similaridad coseno con la consulta (0 si la ficha no tiene embedding). */
  semantic: number;
  /** Score léxico normalizado a [0,1] (relativo al máximo del lote). */
  lexical: number;
}

/**
 * Ranking puro por score mezclado (coseno + léxico). No toca red ni DB: recibe
 * el embedding de la consulta y los candidatos ya materializados.
 *
 * - El léxico se normaliza dividiendo por el máximo del lote → [0,1], comparable
 *   con el coseno. Si el máximo es 0 (ninguna ficha matchea léxicamente), la
 *   componente léxica es 0 y manda el coseno.
 * - Una ficha SIN embedding no se descarta: compite con semantic = 0 (solo su
 *   señal léxica), así el modo semántico nunca pierde un match léxico fuerte por
 *   falta de embedding.
 * - Orden estable descendente; corta en `max`.
 */
export function rankByBlendedScore(
  queryEmbedding: number[],
  candidates: ScoredCandidate[],
  opts: { vectorWeight: number; max: number },
): RankedCandidate[] {
  const maxLexical = candidates.reduce(
    (m, c) => (c.lexicalScore > m ? c.lexicalScore : m),
    0,
  );
  const ranked = candidates.map((c) => {
    const semantic = c.embedding
      ? cosineSimilarity(queryEmbedding, c.embedding)
      : 0;
    const lexical = maxLexical > 0 ? c.lexicalScore / maxLexical : 0;
    return {
      id: c.id,
      semantic,
      lexical,
      score: blendScore(semantic, lexical, opts.vectorWeight),
    };
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, Math.max(0, opts.max));
}

// ---------------------------------------------------------------------------
// Dependencias inyectables (para tests sin red/DB) + defaults de producción
// ---------------------------------------------------------------------------

/** Cliente de embeddings de la consulta. Puede lanzar (timeout, red, key). */
export interface EmbeddingClient {
  embedQuery(text: string): Promise<number[]>;
}

/** Fuente de embeddings de fichas por id. Puede lanzar (sin extensión/tabla). */
export interface CardEmbeddingSource {
  getCardEmbeddings(cardIds: string[]): Promise<Map<string, number[]>>;
}

export interface SemanticDeps {
  /** Snapshot de env (tests). Default `process.env`. */
  env?: AiEnvSnapshot;
  /** Cliente de embeddings (tests). Default: proveedor primario vía AI SDK. */
  embeddingClient?: EmbeddingClient;
  /** Fuente de embeddings de fichas (tests). Default: pgvector vía Prisma. */
  cardEmbeddingSource?: CardEmbeddingSource;
  /** Retrieval léxico de fallback (tests). Default `selectRelevantCards`. */
  lexical?: (cards: KnowledgeCard[], query: string, max: number) => KnowledgeCard[];
  /** Scoring léxico crudo (tests). Default `scoreRelevantCards`. */
  scoreLexical?: (
    cards: KnowledgeCard[],
    query: string,
  ) => { card: KnowledgeCard; score: number }[];
  /** Hook de log del fallback (tests). Default `console.warn`. */
  onFallback?: (reason: string, err: unknown) => void;
}

function defaultOnFallback(reason: string, err: unknown): void {
  // Se loguea el motivo pero NO la consulta (privacidad de menores): un fallback
  // es esperado y benigno, solo interesa para observabilidad.
  console.warn(
    `[retrieval-vector] fallback a léxico (${reason}):`,
    err instanceof Error ? err.message : err,
  );
}

/** Valida el embedding de la consulta contra la dimensión configurada. Lanza si no. */
function assertValidEmbedding(v: unknown, dim: number): asserts v is number[] {
  if (!Array.isArray(v) || v.length !== dim) {
    const got = Array.isArray(v) ? v.length : typeof v;
    throw new Error(`embedding de consulta con dimensión ${got} ≠ ${dim} esperada`);
  }
  for (const x of v) {
    if (typeof x !== "number" || !Number.isFinite(x)) {
      throw new Error("embedding de consulta con valores no finitos");
    }
  }
}

/**
 * pgvector serializa un `vector` como texto "[0.1,0.2,...]". Parseo defensivo:
 * formato inesperado o algún componente no finito → null (la ficha se ignora).
 * Pura y exportada para testear el parseo sin DB.
 */
export function parsePgVector(raw: string): number[] | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (inner === "") return [];
  const out: number[] = [];
  for (const part of inner.split(",")) {
    const n = Number(part);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return out;
}

/** Cliente de embeddings por defecto: proveedor primario (mismo que el chat). */
function defaultEmbeddingClient(
  env: AiEnvSnapshot,
  config: VectorRetrievalConfig,
): EmbeddingClient {
  return {
    async embedQuery(text) {
      const [primary] = parseProviderList(env);
      if (!primary) throw new Error("sin proveedor configurado para embeddings");
      const provider = createOpenAICompatible({
        name: "simon-embeddings",
        baseURL: primary.baseURL,
        apiKey: primary.apiKey,
      });
      const { embedding } = await embed({
        model: provider.textEmbeddingModel(config.model),
        value: text,
        // Un endpoint de embeddings colgado no puede demorar la respuesta al
        // menor: se aborta y el catch de arriba cae a léxico.
        abortSignal: AbortSignal.timeout(config.timeoutMs),
      });
      return embedding as number[];
    },
  };
}

/**
 * Fuente de embeddings de fichas por defecto: lee la tabla `Embedding` (pgvector)
 * vía Prisma `$queryRaw`. Import dinámico de Prisma para que importar este módulo
 * (p.ej. desde una suite pura) no arrastre el cliente de DB. Si la extensión o la
 * tabla no existen, la query lanza y el orquestador cae a léxico.
 */
function defaultCardEmbeddingSource(
  config: VectorRetrievalConfig,
): CardEmbeddingSource {
  return {
    async getCardEmbeddings(cardIds) {
      const out = new Map<string, number[]>();
      if (cardIds.length === 0) return out;
      const { prisma } = await import("@/lib/prisma");
      const { Prisma } = await import("@/generated/prisma/client");
      // `::text` serializa el vector a "[a,b,c]"; el ranking (puro) hace el
      // coseno en JS. Parametrizado (Prisma.join) — nunca interpolar ids crudos.
      const rows = await prisma.$queryRaw<{ ownerId: string; vec: string }[]>(
        Prisma.sql`
          SELECT "ownerId", "embedding"::text AS "vec"
          FROM "Embedding"
          WHERE "ownerType" = 'card'
            AND "model" = ${config.model}
            AND "ownerId" IN (${Prisma.join(cardIds)})
        `,
      );
      for (const row of rows) {
        const parsed = parsePgVector(row.vec);
        if (parsed && parsed.length === config.dim) out.set(row.ownerId, parsed);
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// Orquestador: activo tras flag, con fallback léxico transparente
// ---------------------------------------------------------------------------

/**
 * Selección de fichas relevantes con capa semántica opcional. Contrato:
 *   - flag apagado / sin credenciales → `selectRelevantCards` EXACTO (hoy).
 *   - flag encendido → embebe la consulta, mezcla coseno + léxico y rankea.
 *   - CUALQUIER error en el camino semántico → fallback léxico transparente.
 * NUNCA lanza: siempre devuelve fichas (peor caso, las léxicas de hoy).
 */
export async function selectRelevantCardsSemantic(
  cards: KnowledgeCard[],
  query: string,
  max = 4,
  deps: SemanticDeps = {},
): Promise<KnowledgeCard[]> {
  const env = deps.env ?? process.env;
  const lexicalSelect = deps.lexical ?? selectRelevantCards;
  const config = resolveVectorConfig(env);

  // Flag apagado o sin credenciales → retrieval léxico de hoy, sin tocar red.
  if (!config.enabled) return lexicalSelect(cards, query, max);

  try {
    const client = deps.embeddingClient ?? defaultEmbeddingClient(env, config);
    const source = deps.cardEmbeddingSource ?? defaultCardEmbeddingSource(config);
    const scoreLexical = deps.scoreLexical ?? scoreRelevantCards;

    const queryEmbedding = await client.embedQuery(query);
    assertValidEmbedding(queryEmbedding, config.dim);

    const embeddings = await source.getCardEmbeddings(cards.map((c) => c.id));
    if (embeddings.size === 0) {
      // Sin ningún embedding no hay señal semántica: caé a léxico (no inventamos
      // un ranking a partir de coseno=0 para todo).
      throw new Error("no hay embeddings de fichas disponibles");
    }

    const lexicalById = new Map(
      scoreLexical(cards, query).map((s) => [s.card.id, s.score] as const),
    );
    const candidates: ScoredCandidate[] = cards.map((c) => ({
      id: c.id,
      lexicalScore: lexicalById.get(c.id) ?? 0,
      embedding: embeddings.get(c.id) ?? null,
    }));

    const ranked = rankByBlendedScore(queryEmbedding, candidates, {
      vectorWeight: config.vectorWeight,
      max,
    }).filter((r) => r.score > 0);

    const byId = new Map(cards.map((c) => [c.id, c]));
    const result = ranked
      .map((r) => byId.get(r.id))
      .filter((c): c is KnowledgeCard => Boolean(c));

    // Si la mezcla no dejó nada con señal, no devolvemos vacío en silencio: el
    // léxico podría tener algo. Fallback.
    if (result.length === 0) return lexicalSelect(cards, query, max);
    return result;
  } catch (err) {
    (deps.onFallback ?? defaultOnFallback)("retrieval-vector", err);
    return lexicalSelect(cards, query, max);
  }
}
