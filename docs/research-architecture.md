# Simón AI — Technical Architecture Research

> Status: research draft — July 2026  
> Scope: Next.js chat app, swappable low-cost LLM, lightweight RAG, future local fine-tuned model  
> Stack baseline: Next.js 16 / React 19 / Tailwind v4 (already in repo)

---

## 1. LLM Landscape: Current Models and Pricing

### 1.1 DeepSeek — Clarification on "V4 Flash"

The user reference "deepseek v4flash" is correct and current. DeepSeek shipped V4 Preview on **April 24, 2026**, with two variants. Legacy IDs `deepseek-chat` and `deepseek-reasoner` are deprecated as of **2026-07-24 15:59 UTC** — update any existing code before that date.

| Model ID | Params (active) | Input $/MTok | Cache Hit $/MTok | Output $/MTok | Context |
|---|---|---|---|---|---|
| `deepseek-v4-flash` | 284B (13B active) | $0.14 | $0.0028 | $0.28 | 1M |
| `deepseek-v4-pro` | 1.6T (49B active) | $0.435 | $0.003625 | $0.87 | 1M |

Both models support 384K max output tokens, thinking and non-thinking modes.  
Source: [DeepSeek API Docs — Pricing](https://api-docs.deepseek.com/quick_start/pricing)

### 1.2 Low-Cost LLM Comparison Table (July 2026)

| Model | Provider | Input $/MTok | Output $/MTok | Context | Latency note | Spanish quality |
|---|---|---|---|---|---|---|
| **DeepSeek V4 Flash** | DeepSeek API | $0.14 | $0.28 | 1M | ~300ms TTFT | Tier 2 (good, review advised) |
| **GPT-4.1 Nano** | OpenAI | $0.10 | $0.40 | 1M | ~200ms TTFT | Tier 1 (strong) |
| **GPT-4.1 Nano (batch)** | OpenAI | $0.05 | $0.20 | 1M | async | Tier 1 |
| **Gemini 2.5 Flash** | Google AI | $0.30 | $2.50 | 1M | ~150ms TTFT | Tier 1 |
| **Qwen 2.5 72B** | Alibaba / OpenRouter | $0.36 | $0.40 | 131K | ~300ms TTFT | Tier 1 multilingual |
| **Qwen 2.5 72B** | DeepInfra | ~$0.23 | ~$0.23 | 131K | varies | Tier 1 multilingual |
| **Llama 3.3 70B** | Groq (LPU) | $0.59 | $0.79 | 128K | ~80ms TTFT (~400 tok/s) | Tier 1 |
| **Llama 3.1 8B** | Groq (LPU) | $0.05 | $0.08 | 128K | ~50ms TTFT | Tier 2 |
| **Llama 3.3 70B** | Together / Fireworks | ~$0.20 | ~$0.20 | 128K | ~200ms TTFT | Tier 1 |
| DeepSeek V4 Pro | DeepSeek API | $0.435 | $0.87 | 1M | ~500ms TTFT | Tier 2 (review) |

**Key pricing sources:** [pricepertoken.com](https://pricepertoken.com/), [tldl.io LLM pricing](https://www.tldl.io/resources/llm-api-pricing), [Groq pricing](https://groq.com/pricing), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing)

### 1.3 Safety and Behavior Notes

**DeepSeek V4 Flash** is cheapest, but has documented safety risks relevant to mental health / minors contexts:

- A June 2025 academic study found DeepSeek-32B had an attack success rate of **48%** vs **24%** for GPT-4 Turbo on HarmBench. Earlier testing of R1 found a **100% jailbreak rate** — though V4 models have not been independently red-teamed to the same depth.
- DeepSeek's hosted service applies **Chinese content policy filters** — political topic refusals mixed with the LLM layer. Self-hosted open weights remove this, but do not add safety alignment.
- For mental health use with possible minors: **do not rely on DeepSeek alone**. A mandatory pre/post moderation layer is required (see Section 5).
- **GPT-4.1 Nano** shows stronger broad-spectrum refusal behavior; for sensitive use cases it is the safer default for the LLM layer itself.
- **Gemini 2.5 Flash** and **Llama 3.3 70B** are middle ground — safer than DeepSeek, cheaper than GPT-4.1.

Source: [arXiv:2506.18543 — Jailbreak resilience study](https://arxiv.org/abs/2506.18543), [DeepSeek safety guide](https://www.esafety.gov.au/key-topics/esafety-guide/deepseek)

### 1.4 Recommendation for Simón

**Default (launch):** `deepseek-v4-flash` via env var — cheapest frontier, good Spanish, acceptable for psychoeducation if paired with a moderation layer.  
**Safer alternative:** `gpt-4.1-nano` — slightly pricier output but stronger alignment, simpler compliance story for minors.  
**High-quality answer needed:** route to `deepseek-v4-pro` or `gpt-4.1` (full).  
**Ultra-low latency:** Groq `llama-3.3-70b-versatile` at ~80ms TTFT for real-time feel.

Design for easy swap via env var (Section 2).

---

## 2. Provider Abstraction: Vercel AI SDK

### 2.1 Current Version

As of July 2026, the `ai` npm package is at **v7.0.17**. The major milestones:
- v5 — released July 31, 2025 (UIMessage/ModelMessage split, SSE streaming, transport-based useChat)
- v6 — late 2025 (Language Model Spec v3, agents, minor breaking changes)
- v7 — current stable (npm install `ai@latest`)

**Key packages:**

```
ai                          # core (streamText, generateText, createProviderRegistry, etc.)
@ai-sdk/react               # useChat, useCompletion
@ai-sdk/openai-compatible   # createOpenAICompatible for any OpenAI-compat endpoint
@ai-sdk/openai              # official OpenAI provider
@ai-sdk/google              # Gemini
@ai-sdk/groq                # Groq
ollama-ai-provider-v2       # community Ollama provider (recommended over v1)
```

Source: [Vercel AI SDK npm](https://www.npmjs.com/package/ai), [AI SDK 5 release](https://vercel.com/blog/ai-sdk-5), [AI SDK 6 release](https://vercel.com/blog/ai-sdk-6)

### 2.2 Env-Driven Provider Registry Pattern

Create a single `lib/ai-registry.ts` that reads env vars to select provider and model at runtime. No code changes needed to swap models.

```ts
// lib/ai-registry.ts
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createProviderRegistry, customProvider } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';

const deepseek = createOpenAICompatible({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY });
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

// Local/self-hosted: Ollama or vLLM both expose OpenAI-compatible endpoints
const local = createOpenAICompatible({
  name: 'local',
  baseURL: process.env.LOCAL_LLM_BASE_URL ?? 'http://localhost:11434/v1',
  apiKey: process.env.LOCAL_LLM_API_KEY ?? 'none',
});

export const registry = createProviderRegistry({
  deepseek,
  openai,
  google,
  groq,
  local,
});

// Resolve model from env, default to deepseek-v4-flash
export function getDefaultModel() {
  const modelStr = process.env.SIMON_DEFAULT_MODEL ?? 'deepseek:deepseek-v4-flash';
  return registry.languageModel(modelStr);
}
```

**.env.local pattern:**
```
DEEPSEEK_API_KEY=sk-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk_...
GOOGLE_API_KEY=AIza...
LOCAL_LLM_BASE_URL=http://localhost:11434/v1

# Switch model by changing this one var:
SIMON_DEFAULT_MODEL=deepseek:deepseek-v4-flash
# SIMON_DEFAULT_MODEL=openai:gpt-4.1-nano
# SIMON_DEFAULT_MODEL=groq:llama-3.3-70b-versatile
# SIMON_DEFAULT_MODEL=local:qwen2.5:7b
```

Sources: [AI SDK Provider Management](https://ai-sdk.dev/docs/ai-sdk-core/provider-management), [createOpenAICompatible npm](https://www.npmjs.com/package/@ai-sdk/openai-compatible), [Provider Registry template](https://vercel.com/templates/next.js/ai-sdk-provider-registry)

### 2.3 Streaming Chat Route — Next.js App Router

```ts
// app/api/chat/route.ts
import { streamText, convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream, type UIMessage } from 'ai';
import { getDefaultModel } from '@/lib/ai-registry';

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: getDefaultModel(),
    system: process.env.SIMON_SYSTEM_PROMPT ?? 'Eres Simón, un asistente de psicoeducación.',
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
```

```tsx
// app/page.tsx (client)
'use client';
import { useChat } from '@ai-sdk/react';
import { useState } from 'react';

export default function ChatPage() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status } = useChat();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  };

  return (
    <div>
      {messages.map(m => (
        <div key={m.id}>
          <strong>{m.role}:</strong>{' '}
          {m.parts.map((p, i) => p.type === 'text' ? <span key={i}>{p.text}</span> : null)}
        </div>
      ))}
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={e => setInput(e.target.value)} />
        <button disabled={status === 'streaming'}>Enviar</button>
      </form>
    </div>
  );
}
```

**v7 API notes:**
- `useChat` is from `@ai-sdk/react`, not `ai`
- `append` → replaced by `sendMessage({ text: '...' })`
- `reload` → renamed `regenerate`
- `input` is no longer managed internally — must manage with `useState`
- `status`: `'ready' | 'submitted' | 'streaming' | 'error'`
- Message `.content` string → now `.parts[]` array

Source: [useChat docs](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat), [Migration guide v4→v5](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0)

### 2.4 Local Model Path (Ollama / vLLM)

**Ollama (development, single user):**
```ts
import { ollama } from 'ollama-ai-provider-v2';
// streamText({ model: ollama('qwen2.5:7b'), ... })
```
Or via registry with `LOCAL_LLM_BASE_URL=http://localhost:11434/v1` and `createOpenAICompatible`.

**vLLM (production self-hosted, GPU):**
vLLM exposes an OpenAI-compatible endpoint on port 8000 by default.  
Set `LOCAL_LLM_BASE_URL=http://vllm-host:8000/v1` and `LOCAL_LLM_API_KEY=none`.  
The same `createOpenAICompatible` provider handles it — no code change.

**When to use local:**
- vLLM when you have a dedicated GPU and need >100 concurrent users (continuous batching, 10–50x vs Ollama)
- Ollama for single-dev iteration with a downloaded fine-tuned model
- Both work via the same `SIMON_DEFAULT_MODEL=local:<model-id>` env var pattern

Sources: [AI SDK Ollama community provider](https://ai-sdk.dev/providers/community-providers/ollama), [vLLM OpenAI compat](https://github.com/vercel/ai/issues/2231)

---

## 3. Lightweight RAG

### 3.1 Corpus Scale Decision: RAG vs System-Prompt Injection

For 100–500 psychoeducation content cards:

| Approach | When to use | Trade-offs |
|---|---|---|
| **Full context injection** | Corpus fits in context; content is static; query volume < few thousand/day | Simple, no embedding infra; loses precision if relevance ratio low; costs grow linearly with corpus size |
| **Curated prompt stuffing** | Pick top ~20 cards by keyword match, inject them | Good middle ground; fast to build |
| **RAG with vector search** | Corpus updates frequently; >500 chunks; need per-answer citations; high query volume | Best precision; extra infra; worth it at scale |

**For Simón at launch (100–500 cards, static corpus):**  
DeepSeek V4 Flash has a 1M token context window. At ~150 tokens/card average, 500 cards = ~75K tokens — easily fits in one prompt. **System-prompt injection is viable and sufficient for launch**. Implement RAG only when: (a) corpus grows past ~800 cards, (b) you need verifiable per-answer citations, or (c) daily query cost of always sending 75K tokens exceeds the value.

Context "lost in the middle" research confirms models retrieve better from short focused context vs. entire corpus — so a hybrid approach (retrieve top 10–15 cards, inject those) gives the best quality/cost ratio.

Source: [Long-Context vs RAG 2026](https://tianpan.co/blog/2026-04-09-long-context-vs-rag-production-decision-framework), [RAG review 2025](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)

### 3.2 Embedding Options (when RAG is warranted)

| Model | Provider | $/MTok | Dimensions | Context | Multilingual | Recommendation |
|---|---|---|---|---|---|---|
| `text-embedding-3-small` | OpenAI | $0.02 | 1536 | 8K | Fair | Best cost for Spanish-primary, simple setup |
| `text-embedding-3-large` | OpenAI | $0.13 | 3072 | 8K | Good | When quality matters more than cost |
| `embed-v4.0` | Cohere | $0.12 | 1536 | 128K | Excellent | Best multilingual MTEB, worth it if corpus is multilingual |
| `multilingual-e5-small` | Self-hosted (HF) | Free | 384 | 512 | Good | Zero cost if you have infra; 384-dim is smaller |
| `BGE-M3` | Self-hosted (HF) | Free | 1024 | 8K | Excellent | Best free multilingual; fits on CPU |
| `Nomic Embed v2` | Self-hosted / API | Low | 768 | — | Strong | Released Q3 2025, strong benchmark |

**For Simón:** Start with `text-embedding-3-small` ($0.02/MTok). One-time cost to embed 500 cards at ~200 tokens each = $0.002 — negligible. For a Spanish-dominant corpus, it performs well. Upgrade to Cohere embed-v4 only if multilingual retrieval quality is measurably poor.

Sources: [Best Embedding Models 2026](https://milvus.io/blog/choose-embedding-model-rag-2026.md), [Embedding pricing](https://embeddingcost.com/), [OpenAI embeddings](https://openai.com/business/pricing/)

### 3.3 Vector Store for Small Corpus

| Store | When | Notes |
|---|---|---|
| **In-memory JS array** | <200 cards, single user, no persistence | Zero infra; cosine similarity in ~50 lines; fast to iterate |
| **SQLite + sqlite-vec** | <10K chunks, single-process, serverless / edge | Single file, zero network overhead, easy backup, WASM-compatible; successor to sqlite-vss |
| **pgvector (Postgres)** | Existing Postgres DB, multi-user concurrent writes | Better for multi-user; HNSW index; heavier infra |
| **Dedicated vector DB** (Pinecone, Qdrant, Weaviate) | >100K chunks, multi-tenant, managed | Overkill at 100-500 cards |

**For Simón at 100–500 cards:** In-memory at first (store in a JSON file, load at boot). Graduate to **sqlite-vec** once persistence is needed.

```ts
// Minimal in-memory RAG
import { openai } from '@ai-sdk/openai';
import { embed } from 'ai';

const cards = await loadCards(); // from JSON
const cardEmbeddings = await Promise.all(
  cards.map(c => embed({ model: openai.embedding('text-embedding-3-small'), value: c.content }))
);

async function retrieve(query: string, k = 8) {
  const { embedding } = await embed({ model: openai.embedding('text-embedding-3-small'), value: query });
  return cards
    .map((c, i) => ({ card: c, score: cosineSimilarity(embedding, cardEmbeddings[i].embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
```

Sources: [pgvector vs sqlite-vec 2026](https://llbbl.blog/2026/04/26/pgvector-vs-sqlitevec-you-probably.html), [sqlite-vec embedded RAG](https://dev.to/aairom/embedded-intelligence-how-sqlite-vec-delivers-fast-local-vector-search-for-ai-3dpb)

### 3.4 Chunking for Psychoeducation Content

- Cards are already atomic units — **one card = one chunk**. Don't split cards.
- Add: card title + category tag as prefix in embedded text for better recall.
- Metadata filter before vector search: if you know user is asking about anxiety, pre-filter `category = 'ansiedad'` before cosine similarity — avoids irrelevant card retrieval.
- Target chunk size: 100–300 tokens per card for clean embedding. Trim to that if needed.

---

## 4. Memory and User-Learning Patterns

### 4.1 Architecture

Three-layer approach (in order of implementation complexity):

**Layer 1 — Session context (launch):** Sliding window of last N messages in prompt. Simple, no storage. `N = 20` messages covers most conversations without overflow.

**Layer 2 — Conversation summary (v2):** After each session ends (or when window approaches limit), use a cheap LLM call to summarize the conversation into ~200 tokens. Store per user. Inject at start of next session.

**Layer 3 — Fact extraction (v3):** After each session, extract atomic facts about the user (e.g., "usuario mencionó insomnio", "tiene 14 años", "tiene exámenes próximos"). Store as structured records per user. Retrieve semantically relevant facts at session start.

```ts
// Example fact extraction prompt (runs as background task after session ends)
const extractionPrompt = `
  Analiza este diálogo y extrae hechos cortos y concretos sobre el usuario.
  Responde SOLO con un JSON array de strings. Máximo 5 hechos. 
  No incluyas datos sensibles como nombres o información identificable.
  Diálogo: ${sessionSummary}
`;
```

Sources: [LLM Memory Management](https://mem0.ai/blog/ai-memory-management-for-llms-and-agents), [Chat history summarization 2026](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025), [How to build custom memory layer](https://towardsdatascience.com/how-to-build-your-own-custom-llm-memory-layer-from-scratch/)

### 4.2 Safe Storage of Minors' Data (COPPA + Argentina)

**Critical legal context as of 2026:**

The **FTC COPPA Final Rule** (effective June 23, 2025, full compliance by April 22, 2026) applies to apps that knowingly collect data from children under 13:

- No indefinite retention of children's personal information
- Written data retention/deletion policy required
- Separate verifiable parental consent required to use children's data for AI training
- Expanded definition of "personal information" includes behavioral/inferential data

**Practical rules for Simón's memory layer:**

| Rule | Implementation |
|---|---|
| Minimize collection | Store only extracted facts, not raw transcripts |
| TTL on all memory records | Delete extracted facts older than 90 days (configurable) |
| No PII in fact records | Extraction prompt explicitly forbids names, ID numbers, locations |
| Age gate | If targeting minors, implement age verification flow; apply stricter retention to under-13 |
| No training on minors' data | Facts stored for personalization; separate opt-in needed to use for model training |
| User deletion | Provide `DELETE /api/user/:id/memory` endpoint from day 1 |

Sources: [COPPA 2025 amended rule](https://www.loeb.com/en/insights/publications/2025/05/childrens-online-privacy-in-2025-the-amended-coppa-rule), [AI chatbots and COPPA](https://www.law.georgetown.edu/tech-institute/research-insights/insights/how-existing-laws-apply-to-ai-chatbots-for-kids-and-teens-2/), [COPPA and AI training data](https://publicinterestprivacy.org/coppa-rule-training-algorithms/)

---

## 5. Moderation Layer

### 5.1 Options Comparison

| Option | Cost | Latency | Coverage | Self-harm detection |
|---|---|---|---|---|
| **OpenAI Moderation API** | Free (with OpenAI account) | 15–25ms | 13 categories incl. self-harm, self-harm/intent, self-harm/instructions | Yes, with subcategory breakdown |
| **Llama Guard 4** (12B, self-hosted, A10 GPU) | ~$0.50/hr infra | 80–150ms | Multimodal, multilingual, text+image | Yes, configurable categories |
| **Llama Guard 3 1B** (self-hosted, CPU-feasible) | Low infra | ~300ms on CPU | Text only | Yes, reduced accuracy |
| **Keyword + regex** | Free | <1ms | Explicit terms only | Basic (obvious cases) |
| **GPT-4.1 Nano as classifier** | $0.10/M input | 600–1200ms | Full reasoning, nuanced context | Yes, but slower/costlier |

### 5.2 Recommended Pipeline for Simón

**Two-stage approach (pre-LLM and post-LLM):**

```
User input
  → Stage 1: Keyword/regex filter (instant, catches obvious crisis words)
  → Stage 2: OpenAI Moderation API (free, 20ms, 13 categories)
  → If CLEAR: proceed to LLM
  → If FLAGGED (self-harm/intent, etc.): show crisis resource, block LLM call

LLM response
  → Stage 3: OpenAI Moderation API on output (async, catches model slips)
  → If FLAGGED: substitute with safe fallback message + crisis resource
```

**Crisis resource to show when flagged (Argentina):**
- Centro de Asistencia al Suicida: 135 (free, 24h)
- WhatsApp Centro PAV: +54 9 11 5275-1135

**Implementation sketch:**

```ts
// lib/moderation.ts
const CRISIS_KEYWORDS = ['suicid', 'matarm', 'cortarm', 'no quiero vivir', 'hacerme daño'];

export async function moderateInput(text: string): Promise<{ safe: boolean; category?: string }> {
  const textLower = text.toLowerCase();
  if (CRISIS_KEYWORDS.some(k => textLower.includes(k))) {
    return { safe: false, category: 'crisis-keyword' };
  }

  const res = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: text }),
  });
  const { results } = await res.json();
  if (results[0].flagged) {
    const topCategory = Object.entries(results[0].category_scores as Record<string, number>)
      .sort((a, b) => b[1] - a[1])[0][0];
    return { safe: false, category: topCategory };
  }
  return { safe: true };
}
```

**Why OpenAI Moderation API even when using DeepSeek:**  
It is free and adds no per-call cost. It provides explicit self-harm/intent subcategories. It avoids depending on DeepSeek's weaker safety alignment as the sole moderation layer.

**If architectural independence from OpenAI is required:** Run Llama Guard 3 1B on a small CPU instance ($20-40/mo VPS) — 300ms is acceptable pre-LLM since users expect some response latency anyway.

Sources: [OpenAI Moderation API review 2026](https://aimoderationtools.com/posts/openai-moderation-api-review/), [Llama Guard benchmark](https://aimoderationtools.com/posts/llama-guard-benchmark-review/), [Output filtering architecture](https://aidefense.dev/posts/output-filtering-architecture-production-llms/)

---

## 6. Recommended Stack Summary

```
Next.js 16 + React 19 + Tailwind v4     ← already in repo
ai (v7.x) + @ai-sdk/react              ← chat core
@ai-sdk/openai-compatible               ← DeepSeek, vLLM, LiteLLM, local
@ai-sdk/openai                          ← OpenAI (moderation + embeddings)
@ai-sdk/groq                            ← Groq for low-latency option

# RAG (when corpus outgrows prompt injection):
openai (embeddings via ai SDK)
sqlite-vec                              ← vector store (add when needed)
```

### 6.1 Env Var Architecture

```bash
# Provider keys (add as needed)
DEEPSEEK_API_KEY=
OPENAI_API_KEY=           # required even if not primary LLM (moderation + embeddings)
GROQ_API_KEY=
GOOGLE_API_KEY=

# Model selection — change without deploying new code
SIMON_DEFAULT_MODEL=deepseek:deepseek-v4-flash

# System prompt (can be long-form for psychoeducation instructions)
SIMON_SYSTEM_PROMPT=

# RAG (when activated)
SIMON_EMBEDDING_MODEL=openai:text-embedding-3-small
SIMON_RAG_ENABLED=false
SIMON_RAG_TOP_K=10

# Local model (Ollama / vLLM)
LOCAL_LLM_BASE_URL=http://localhost:11434/v1
LOCAL_LLM_API_KEY=none
```

### 6.2 Migration Path

1. **Now (launch):** System-prompt injection with full corpus. Single provider (DeepSeek V4 Flash). OpenAI Moderation API. Session-context memory (last 20 messages).
2. **v2 (~3 months):** Add conversation summary storage. Retrieve last session summary at chat start. User deletion endpoint.
3. **v3 (~6 months):** Add fact extraction if data shows users returning for multi-session continuity. Consider sqlite-vec for RAG if corpus grows past 500 cards.
4. **v4 (future):** Local fine-tuned model via vLLM. Swap `LOCAL_LLM_BASE_URL` — zero code changes in the provider layer.

---

## 7. Sources

- [DeepSeek API Pricing — official](https://api-docs.deepseek.com/quick_start/pricing)
- [DeepSeek V4 release notes](https://api-docs.deepseek.com/news/news260424)
- [DeepSeek safety guide (eSafety AU)](https://www.esafety.gov.au/key-topics/esafety-guide/deepseek)
- [Jailbreak resilience study DeepSeek vs GPT (arXiv 2506.18543)](https://arxiv.org/abs/2506.18543)
- [AI SDK 5 release blog](https://vercel.com/blog/ai-sdk-5)
- [AI SDK 6 release blog](https://vercel.com/blog/ai-sdk-6)
- [AI SDK Provider Management docs](https://ai-sdk.dev/docs/ai-sdk-core/provider-management)
- [AI SDK useChat reference](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat)
- [AI SDK v4→v5 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-5-0)
- [@ai-sdk/openai-compatible npm](https://www.npmjs.com/package/@ai-sdk/openai-compatible)
- [Provider Registry Next.js template](https://vercel.com/templates/next.js/ai-sdk-provider-registry)
- [AI SDK Ollama community provider docs](https://ai-sdk.dev/providers/community-providers/ollama)
- [pgvector vs sqlite-vec 2026](https://llbbl.blog/2026/04/26/pgvector-vs-sqlitevec-you-probably.html)
- [sqlite-vec embedded AI](https://dev.to/aairom/embedded-intelligence-how-sqlite-vec-delivers-fast-local-vector-search-for-ai-3dpb)
- [Best Embedding Models for RAG 2026 (Milvus)](https://milvus.io/blog/choose-embedding-model-rag-2026.md)
- [Embedding cost calculator](https://embeddingcost.com/)
- [Long-Context vs RAG production decision](https://tianpan.co/blog/2026-04-09-long-context-vs-rag-production-decision-framework)
- [RAG review 2025 (RAGFlow)](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)
- [LLM memory management (Mem0)](https://mem0.ai/blog/ai-memory-management-for-llms-and-agents)
- [Chat history summarization 2026](https://mem0.ai/blog/llm-chat-history-summarization-guide-2025)
- [COPPA 2025 amended rule (Loeb)](https://www.loeb.com/en/insights/publications/2025/05/childrens-online-privacy-in-2025-the-amended-coppa-rule)
- [AI chatbots kids/teens legal analysis (Georgetown)](https://www.law.georgetown.edu/tech-institute/research-insights/insights/how-existing-laws-apply-to-ai-chatbots-for-kids-and-teens-2/)
- [COPPA and AI training data (PIPC)](https://publicinterestprivacy.org/coppa-rule-training-algorithms/)
- [OpenAI Moderation API review 2026](https://aimoderationtools.com/posts/openai-moderation-api-review/)
- [Llama Guard benchmark review](https://aimoderationtools.com/posts/llama-guard-benchmark-review/)
- [Output filtering architecture for production LLMs](https://aidefense.dev/posts/output-filtering-architecture-production-llms/)
- [LLM API pricing comparison 2026 (CloudZero)](https://www.cloudzero.com/blog/llm-api-pricing-comparison/)
- [pricepertoken.com (live pricing aggregator)](https://pricepertoken.com/)
- [tldl.io LLM pricing table (July 2026)](https://www.tldl.io/resources/llm-api-pricing)
- [Groq pricing](https://groq.com/pricing)
- [Gemini API pricing (Google)](https://ai.google.dev/gemini-api/docs/pricing)
- [OpenAI API pricing](https://openai.com/business/pricing/)
