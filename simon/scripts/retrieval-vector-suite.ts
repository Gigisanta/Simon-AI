/**
 * Suite determinística del retrieval semántico opcional (lib/ai/retrieval-vector).
 *
 *   pnpm retrieval-vector-suite   (o: tsx scripts/retrieval-vector-suite.ts)
 *
 * NO llama al LLM, ni a embeddings reales, ni a la DB: todo con vectores conocidos
 * y dependencias inyectadas (fakes). Cubre:
 *   1. cosineSimilarity: vectores conocidos (idénticos, ortogonales, opuestos,
 *      cero, longitudes distintas, invariancia de escala).
 *   2. blendScore + rankByBlendedScore: mezcla coseno/léxico, normalización del
 *      léxico, ficha sin embedding que compite solo por léxico, recorte del peso.
 *   3. parsePgVector: parseo del formato "[a,b,c]" + entradas basura → null.
 *   4. resolveVectorConfig / pgvectorEnabled: flag + credenciales, defaults.
 *   5. selectRelevantCardsSemantic: fallback léxico TRANSPARENTE ante cada tipo de
 *      error (flag off, cliente de embeddings que lanza, fuente que lanza, dim
 *      inválida, sin embeddings) + cero red cuando el flag está apagado + happy
 *      path que reordena por semántica.
 *
 * Por qué importa: este módulo toca el camino del chat de menores. El invariante
 * NO negociable es "ante cualquier error, mismo resultado que el retrieval léxico
 * de hoy". Este gate lo prueba caso por caso.
 *
 * Sale con código 1 si algún caso falla.
 */
import { createChecker } from "./suite-helpers";
import type { KnowledgeCard } from "../src/generated/prisma/client";
import { selectRelevantCards } from "../src/lib/ai/system-prompt";
import {
  cosineSimilarity,
  blendScore,
  rankByBlendedScore,
  parsePgVector,
  resolveVectorConfig,
  pgvectorEnabled,
  selectRelevantCardsSemantic,
  type EmbeddingClient,
  type CardEmbeddingSource,
  type ScoredCandidate,
} from "../src/lib/ai/retrieval-vector";

const { check, done } = createChecker("Retrieval-vector suite");

const APPROX = 1e-9;
const near = (a: number, b: number) => Math.abs(a - b) < APPROX;

function card(slug: string, title: string, body: string): KnowledgeCard {
  return {
    id: slug,
    slug,
    category: "test",
    title,
    body,
    source: null,
    reviewed: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

// Fixture: A matchea fuerte por LÉXICO ("apoyos escolares"); C es el más cercano
// por SEMÁNTICA (embedding = query). B no matchea por ninguna vía.
const A = card("a", "Apoyos escolares", "Apoyos escolares e inclusión en la escuela.");
const B = card("b", "Obra social", "Cobertura de la obra social.");
const C = card("c", "Terapias", "Estimulación temprana y terapias.");
const CARDS = [A, B, C];
const QUERY = "apoyos escolares";

// Env base que ACTIVA el retrieval (flag + credencial), con dim chica (3) para
// poder usar vectores conocidos, y peso configurable por test.
function enabledEnv(overrides: Record<string, string> = {}) {
  return {
    RETRIEVAL_PGVECTOR: "1",
    AI_API_KEY: "test-key",
    RETRIEVAL_EMBED_DIM: "3",
    RETRIEVAL_VECTOR_WEIGHT: "1",
    ...overrides,
  };
}

// Embeddings 3D conocidos: query=[0,0,1]; A ortogonal, B ortogonal, C = query.
const QVEC = [0, 0, 1];
const EMB: Record<string, number[]> = { a: [1, 0, 0], b: [0, 1, 0], c: [0, 0, 1] };

function fakeClient(vec: number[], onCall?: () => void): EmbeddingClient {
  return {
    async embedQuery() {
      onCall?.();
      return vec;
    },
  };
}
function throwingClient(err: Error, onCall?: () => void): EmbeddingClient {
  return {
    async embedQuery() {
      onCall?.();
      throw err;
    },
  };
}
function fakeSource(map: Record<string, number[]>): CardEmbeddingSource {
  return {
    async getCardEmbeddings(ids) {
      const out = new Map<string, number[]>();
      for (const id of ids) if (map[id]) out.set(id, map[id]);
      return out;
    },
  };
}
function throwingSource(err: Error): CardEmbeddingSource {
  return {
    async getCardEmbeddings() {
      throw err;
    },
  };
}

// El fallback esperado ante cualquier error = retrieval léxico de hoy, EXACTO.
const LEXICAL_EXPECTED = selectRelevantCards(CARDS, QUERY).map((c) => c.slug);

async function main() {
  // ---------- 1. cosineSimilarity ----------
  {
    check(near(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1), "coseno: idénticos → 1");
    check(near(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0), "coseno: ortogonales → 0");
    check(near(cosineSimilarity([1, 0], [-1, 0]), -1), "coseno: opuestos → -1");
    check(near(cosineSimilarity([0, 0, 2], [0, 0, 1]), 1), "coseno: invariante a la escala");
    check(cosineSimilarity([0, 0, 0], [1, 2, 3]) === 0, "coseno: vector cero → 0");
    check(cosineSimilarity([1, 2, 3], [1, 2]) === 0, "coseno: longitudes distintas → 0");
    check(cosineSimilarity([], []) === 0, "coseno: vacío → 0");
    check(near(cosineSimilarity([1, 1, 0], [1, 0, 0]), Math.SQRT1_2), "coseno: 45° → 1/√2");
  }

  // ---------- 2. blendScore + rankByBlendedScore ----------
  {
    check(near(blendScore(1, 0, 1), 1), "blend: peso 1 → solo semántica");
    check(near(blendScore(1, 0, 0), 0), "blend: peso 0 → solo léxico");
    check(near(blendScore(0.5, 0.5, 0.4), 0.5), "blend: 0.4·0.5 + 0.6·0.5 = 0.5");
    check(near(blendScore(1, 0, 5), 1), "blend: peso >1 se recorta a 1");
    check(near(blendScore(1, 1, -3), 1), "blend: peso <0 se recorta a 0 (solo léxico)");

    const cands: ScoredCandidate[] = [
      { id: "a", lexicalScore: 20, embedding: EMB.a }, // léxico alto, coseno 0
      { id: "b", lexicalScore: 0, embedding: EMB.b }, // nada
      { id: "c", lexicalScore: 0, embedding: EMB.c }, // coseno 1, léxico 0
    ];
    // Peso 1 (semántica pura): C primero.
    const semantic = rankByBlendedScore(QVEC, cands, { vectorWeight: 1, max: 3 });
    check(semantic[0]?.id === "c", "rank: peso 1 → C (más cercano) primero");
    check(near(semantic.find((r) => r.id === "a")?.semantic ?? -1, 0), "rank: A coseno 0");

    // Peso 0 (léxico puro): A primero (léxico normalizado por el máximo del lote).
    const lexical = rankByBlendedScore(QVEC, cands, { vectorWeight: 0, max: 3 });
    check(lexical[0]?.id === "a", "rank: peso 0 → A (léxico) primero");
    check(near(lexical.find((r) => r.id === "a")?.lexical ?? -1, 1), "rank: léxico normalizado a 1 el máx");

    // Ficha SIN embedding no se descarta: compite por léxico (semantic 0).
    const mixed: ScoredCandidate[] = [
      { id: "a", lexicalScore: 10, embedding: null }, // sin embedding
      { id: "c", lexicalScore: 0, embedding: EMB.c }, // coseno 1
    ];
    const r = rankByBlendedScore(QVEC, mixed, { vectorWeight: 0.4, max: 5 });
    check(r.length === 2, "rank: ficha sin embedding NO se descarta");
    check(r[0]?.id === "a", "rank: 0.4 → A (léxico 0.6) supera a C (semántica 0.4)");
    check(near(r.find((x) => x.id === "a")?.semantic ?? -1, 0), "rank: A sin embedding → semántica 0");

    check(rankByBlendedScore(QVEC, cands, { vectorWeight: 1, max: 2 }).length === 2, "rank: respeta max");
    check(rankByBlendedScore(QVEC, cands, { vectorWeight: 1, max: 0 }).length === 0, "rank: max 0 → vacío");
  }

  // ---------- 3. parsePgVector ----------
  {
    const p = parsePgVector("[0.1,0.2,0.3]");
    check(!!p && p.length === 3 && near(p[1], 0.2), "parse: '[0.1,0.2,0.3]' → [0.1,0.2,0.3]");
    check(parsePgVector("[]")?.length === 0, "parse: '[]' → vacío");
    check(parsePgVector(" [1, 2 , 3 ] ")?.length === 3, "parse: tolera espacios");
    check(parsePgVector("0.1,0.2") === null, "parse: sin corchetes → null");
    check(parsePgVector("[0.1,foo]") === null, "parse: componente no numérico → null");
    check(parsePgVector("") === null, "parse: vacío string → null");
    check(parsePgVector(null as unknown as string) === null, "parse: no-string → null");
  }

  // ---------- 4. resolveVectorConfig / pgvectorEnabled ----------
  {
    check(pgvectorEnabled({}) === false, "config: env vacía → deshabilitado");
    check(
      pgvectorEnabled({ RETRIEVAL_PGVECTOR: "1" }) === false,
      "config: flag sin credencial → deshabilitado",
    );
    check(
      pgvectorEnabled({ AI_API_KEY: "k" }) === false,
      "config: credencial sin flag → deshabilitado",
    );
    check(
      pgvectorEnabled({ RETRIEVAL_PGVECTOR: "1", AI_API_KEY: "k" }) === true,
      "config: flag + credencial → habilitado",
    );
    check(
      pgvectorEnabled({ RETRIEVAL_PGVECTOR: "0", AI_API_KEY: "k" }) === false,
      "config: flag '0' → deshabilitado (solo '1' activa)",
    );
    // AI_PROVIDERS también cuenta como credencial (misma fuente que el router).
    check(
      pgvectorEnabled({
        RETRIEVAL_PGVECTOR: "1",
        AI_PROVIDERS: '[{"baseURL":"https://x","apiKey":"k","model":"m"}]',
      }) === true,
      "config: credencial vía AI_PROVIDERS → habilitado",
    );

    const def = resolveVectorConfig({ RETRIEVAL_PGVECTOR: "1", AI_API_KEY: "k" });
    check(def.dim === 1536, "config: dim default 1536");
    check(def.model === "text-embedding-3-small", "config: modelo default");
    check(near(def.vectorWeight, 0.7), "config: peso default 0.7");
    check(def.timeoutMs === 8000, "config: timeout default 8000ms");

    const custom = resolveVectorConfig({
      RETRIEVAL_PGVECTOR: "1",
      AI_API_KEY: "k",
      RETRIEVAL_EMBED_DIM: "768",
      AI_EMBEDDING_MODEL: "mimo-embed",
      RETRIEVAL_VECTOR_WEIGHT: "0.3",
      RETRIEVAL_EMBED_TIMEOUT_MS: "1200",
    });
    check(custom.dim === 768, "config: dim configurable (768)");
    check(custom.model === "mimo-embed", "config: modelo configurable");
    check(near(custom.vectorWeight, 0.3), "config: peso configurable");
    check(custom.timeoutMs === 1200, "config: timeout configurable");

    // Valores inválidos → defaults (parseo defensivo).
    const bad = resolveVectorConfig({
      RETRIEVAL_PGVECTOR: "1",
      AI_API_KEY: "k",
      RETRIEVAL_EMBED_DIM: "-5",
      RETRIEVAL_VECTOR_WEIGHT: "9",
      RETRIEVAL_EMBED_TIMEOUT_MS: "abc",
    });
    check(bad.dim === 1536, "config: dim inválida → default");
    check(near(bad.vectorWeight, 0.7), "config: peso fuera de [0,1] → default");
    check(bad.timeoutMs === 8000, "config: timeout no numérico → default");
  }

  // ---------- 5. selectRelevantCardsSemantic: fallback + happy path ----------
  {
    // 5a. Flag apagado → léxico EXACTO, y CERO llamadas de red.
    let clientCalls = 0;
    const offResult = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: {},
      embeddingClient: fakeClient(QVEC, () => (clientCalls += 1)),
      cardEmbeddingSource: fakeSource(EMB),
      onFallback: () => {},
    });
    check(
      offResult.map((c) => c.slug).join(",") === LEXICAL_EXPECTED.join(","),
      "semantic: flag off → resultado léxico idéntico",
    );
    check(clientCalls === 0, "semantic: flag off → cero red (no se embebe la consulta)");

    // 5b. Peso mixto (0.6): C (semántica) primero, A (léxico) también presente.
    const happy = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: enabledEnv({ RETRIEVAL_VECTOR_WEIGHT: "0.6" }),
      embeddingClient: fakeClient(QVEC),
      cardEmbeddingSource: fakeSource(EMB),
      onFallback: () => {},
    });
    check(happy[0]?.slug === "c", "semantic: peso mixto → C (más cercano) primero");
    check(happy.some((c) => c.slug === "a"), "semantic: peso mixto → A también presente (léxico)");

    // 5b''. Peso 1 (semántica pura): solo C sobrevive (A/B ortogonales → score 0).
    const pureSemantic = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: enabledEnv(),
      embeddingClient: fakeClient(QVEC),
      cardEmbeddingSource: fakeSource(EMB),
      onFallback: () => {},
    });
    check(
      pureSemantic.map((c) => c.slug).join(",") === "c",
      "semantic: peso 1 → solo C (ortogonales quedan en score 0 y se filtran)",
    );

    // 5b'. Peso 0 con flag on → domina el léxico (A primero).
    const lexWeighted = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: enabledEnv({ RETRIEVAL_VECTOR_WEIGHT: "0" }),
      embeddingClient: fakeClient(QVEC),
      cardEmbeddingSource: fakeSource(EMB),
      onFallback: () => {},
    });
    check(lexWeighted[0]?.slug === "a", "semantic: peso 0 → léxico manda (A primero)");

    // 5c. Cliente de embeddings lanza (timeout/red) → fallback léxico transparente.
    let fb1 = "";
    const clientErr = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: enabledEnv(),
      embeddingClient: throwingClient(new Error("ETIMEDOUT")),
      cardEmbeddingSource: fakeSource(EMB),
      onFallback: (reason) => (fb1 = reason),
    });
    check(
      clientErr.map((c) => c.slug).join(",") === LEXICAL_EXPECTED.join(","),
      "semantic: cliente lanza → fallback léxico idéntico",
    );
    check(fb1 === "retrieval-vector", "semantic: cliente lanza → se registra el fallback");

    // 5d. Fuente de embeddings lanza (sin extensión/tabla) → fallback.
    let fb2 = false;
    const sourceErr = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: enabledEnv(),
      embeddingClient: fakeClient(QVEC),
      cardEmbeddingSource: throwingSource(new Error('relation "Embedding" does not exist')),
      onFallback: () => (fb2 = true),
    });
    check(
      sourceErr.map((c) => c.slug).join(",") === LEXICAL_EXPECTED.join(","),
      "semantic: fuente lanza (sin extensión) → fallback léxico idéntico",
    );
    check(fb2, "semantic: fuente lanza → se registra el fallback");

    // 5e. Embedding de dimensión inválida → fallback.
    const badDim = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: enabledEnv(),
      embeddingClient: fakeClient([0, 1]), // dim 2 ≠ 3 configurada
      cardEmbeddingSource: fakeSource(EMB),
      onFallback: () => {},
    });
    check(
      badDim.map((c) => c.slug).join(",") === LEXICAL_EXPECTED.join(","),
      "semantic: embedding con dim inválida → fallback léxico",
    );

    // 5f. Embedding con valores no finitos → fallback.
    const nanEmb = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: enabledEnv(),
      embeddingClient: fakeClient([0, 0, NaN]),
      cardEmbeddingSource: fakeSource(EMB),
      onFallback: () => {},
    });
    check(
      nanEmb.map((c) => c.slug).join(",") === LEXICAL_EXPECTED.join(","),
      "semantic: embedding con NaN → fallback léxico",
    );

    // 5g. Sin ningún embedding de ficha → fallback (no ranking a partir de coseno 0).
    const noEmb = await selectRelevantCardsSemantic(CARDS, QUERY, 4, {
      env: enabledEnv(),
      embeddingClient: fakeClient(QVEC),
      cardEmbeddingSource: fakeSource({}),
      onFallback: () => {},
    });
    check(
      noEmb.map((c) => c.slug).join(",") === LEXICAL_EXPECTED.join(","),
      "semantic: sin embeddings de fichas → fallback léxico",
    );

    // 5h. Cero red por defecto cuando no hay flag: sin inyectar cliente/fuente,
    // env vacía → NO intenta construir cliente real (devuelve léxico sin lanzar).
    const noNetwork = await selectRelevantCardsSemantic(CARDS, QUERY, 4, { env: {} });
    check(
      noNetwork.map((c) => c.slug).join(",") === LEXICAL_EXPECTED.join(","),
      "semantic: sin flag y sin fakes → léxico, sin tocar red",
    );
  }
}

main()
  .then(() => done())
  .catch((err) => {
    console.error("\nRetrieval-vector suite: error inesperado:", err);
    process.exit(1);
  });
