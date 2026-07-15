# Simón AI — Arquitectura

> Fecha: 2026-07-15 · Estado: **EN PRODUCCIÓN** en `https://simon.maat.work` (alias Vercel: `simon-ai-sigma.vercel.app`) — ver "Estado de implementación" al final
> LLM en producción: DeepSeek V4 Flash REAL vía gateway OpenCode Go (`https://opencode.ai/zen/go/v1`, suscripción $0/token) con `AI_EXTRA_BODY={"thinking":{"type":"disabled"}}` (sin ese param el modelo quema el presupuesto en reasoning y devuelve content vacío)
> Docs complementarios: [research-architecture.md](research-architecture.md) (LLM/RAG/moderación), [research-safety.md](research-safety.md) (protocolo de crisis, regulación, UX para menores — **lectura obligatoria antes de tocar el chat**), [adr-rearquitectura-2026-07.md](adr-rearquitectura-2026-07.md) (decisiones ADR-1..10 de la rearquitectura, quirúrgica sobre este mismo diseño)

Simón: acompañante emocional con IA para niños y adolescentes (6–18, con y sin discapacidad), español rioplatense, Argentina-first. **No es un terapeuta ni lo simula.** Toda decisión de diseño está subordinada al protocolo de seguridad de `research-safety.md`.

---

## 1. Stack decision

Criterios: costo total < USD 60/mes worst case, mantenible por 1 persona, datos de menores = datos sensibles (Ley 25.326), modelo LLM intercambiable por env var.

| Capa | Opciones evaluadas | Elección | Por qué |
|---|---|---|---|
| **Frontend + Backend** | Next.js 16 · SvelteKit · Remix | **Next.js 16 + React 19 + Tailwind v4** | Ya está en el repo y funcionando; AI SDK v7 y better-auth son first-class; un solo deploy para UI + API. Cambiar ahora sería tirar trabajo hecho sin ganancia. |
| **ORM** | Prisma 7 · Drizzle | **Prisma 7** | Ya en repo; driver adapters permiten SQLite (dev) y Postgres (prod) con el mismo schema. |
| **DB** | SQLite/Turso · Neon Postgres · Supabase | **SQLite en dev → Neon Postgres en prod** | Neon: usage-based con scale-to-zero (≈$0 en beta, ~$19/mes con carga), pgvector nativo para el RAG futuro, sin el pause-tras-7-días del free tier de Supabase. Supabase Pro ($25 fijo) trae Auth/Storage que no necesitamos porque auth vive en la app. |
| **Auth** | better-auth · Auth.js v5 · Clerk | **better-auth** (ya instalado) | Auth.js está en maintenance mode (su equipo se sumó a Better Auth en 2025 y lo recomienda para proyectos nuevos). Clerk = servicio externo custodiando credenciales de menores — descartado. better-auth: datos en NUESTRA DB, sesiones revocables server-side, 2FA/passkeys built-in. |
| **LLM** | DeepSeek V4 Flash · GPT-4.1 Nano · Groq Llama 3.3 | **`deepseek-v4-flash` default, intercambiable por env** | Más barato ($0.14/$0.28 por MTok, cache hit $0.0028) con 1M de contexto. Su alignment débil se compensa con la capa de moderación obligatoria (§2). Swap a `gpt-4.1-nano` o modelo local = cambiar 2 env vars, cero código. |
| **Moderación** | OpenAI Moderation API · Llama Guard self-hosted | **Keywords + OpenAI Moderation API** | Gratis, ~20ms, categorías explícitas de self-harm/intent. Llama Guard queda como plan B si se exige independencia de OpenAI (VPS ~$20/mes). |
| **Hosting** | Vercel · Hetzner+Coolify · Fly.io | **Vercel** (Hobby en beta → Pro $20/mes al abrir a usuarios reales) | Deploy y preview automáticos, cero ops para un equipo de 1. Hetzner CX22 (€3.79) + Coolify es la salida documentada si el costo de Vercel duele: la app es un container Next.js estándar, sin lock-in. |

**Research (1 párrafo + fuente por decisión):**

- **Auth:** en 2026 Auth.js v5 sigue en beta y en modo mantenimiento (solo parches de seguridad); su equipo se unió a Better Auth en septiembre 2025 y recomienda better-auth para proyectos nuevos. Para compliance tipo GDPR/HIPAA la ventaja decisiva es ownership total: credenciales y sesiones en nuestra DB, nada en terceros. Fuentes: [LogRocket — best auth library 2026](https://blog.logrocket.com/best-auth-library-nextjs-2026/), [Better Auth vs Clerk vs Auth.js 2026](https://www.buildmvpfast.com/blog/better-auth-vs-clerk-vs-authjs-nextjs-decision-tree-2026).
- **DB:** Neon free tier (0.5 GB, 100 CU-h/mes, scale-to-zero con resume ~500ms) cubre la beta entera; el paid es puro usage (~$0.106/CU-hora, sin mínimo). Supabase free pausa el proyecto tras 7 días sin tráfico — inaceptable en producción. Turso (libSQL) es el más barato pero nos ata a un fork de SQLite para datos sensibles; Postgres + pgvector es el camino aburrido y correcto. Fuentes: [Neon vs Supabase vs Turso 2026](https://www.buildmvpfast.com/blog/neon-vs-supabase-vs-turso-serverless-postgres-mvp-2026), [comparativa free tiers 2026](https://agentdeals.dev/database-free-tier-comparison-2026).
- **Hosting:** Vercel Pro ($20/dev/mes, 1 TB bandwidth) es el camino más rápido a producción para Next.js con equipo de 1; Hetzner+Coolify cuesta 10–20% de eso a igual escala pero suma ops (SSL, updates, monitoreo) que hoy no queremos pagar en tiempo. Fuentes: [Vercel vs Hetzner 2026](https://devtoolpicks.com/blog/vercel-vs-hetzner-2026-solo-developers), [best Next.js hosting 2026](https://makerkit.dev/blog/tutorials/best-hosting-nextjs).
- **LLM y RAG:** decididos en ronda previa con fuentes — ver [research-architecture.md](research-architecture.md) §1 (pricing DeepSeek/OpenAI/Groq) y §3 (RAG vs prompt injection).

---

## 2. Arquitectura del sistema

```
                         ┌──────────────────────────────────────────────┐
                         │                VERCEL (Next.js 16)           │
                         │                                              │
 Navegador (chico/a)     │  UI (React 19 + Tailwind v4)                 │
 ┌──────────────┐        │  ├─ /            chat (useChat, sin stream)  │
 │ Chat Simón   │◄──JSON──┤  ├─ /login       auth-form                  │
 │ Quick replies│        │  └─ /tutor       panel tutor                 │
 │ Botón crisis │        │                                              │
 └──────────────┘        │  API Routes                                  │
                         │  ├─ /api/auth/[...all] ── better-auth ────┐  │
                         │  ├─ /api/chat (POST) — adaptador fino     │  │
                         │  │    CSRF · requireSession · defer=after │  │
                         │  │    delega TODO en runChatPipeline()    │  │
                         │  └─ /api/cron/purge — retención (ADR-4)   │  │
                         │       │                                   │  │
                         │       ▼ src/lib/chat-pipeline/run.ts      │  │
                         │  consentimiento → rate limit → validate   │  │
                         │  → flag regex (safety.ts, sin LLM) ───┐   │  │
                         │  → [paralelo: moderación entrada       │   │  │
                         │     + generación] → decideResponsePath │   │  │
                         │     (chat-precedence.ts, pura)         │   │  │
                         │  → moderación salida → decidePostGenPath│  │  │
                         │  → persist.ts (transacción, nunca lanza)│  │  │
                         │  → notify.ts (diferido: alerta/log/purga)│ │  │
                         └───────┬────────────┬──────────┬─────────┼──┘
                                 │            │          │         │
                    ┌────────────▼──┐  ┌──────▼─────┐ ┌──▼─────────▼───┐
                    │ LLM provider  │  │ Guardrail  │ │ Neon Postgres  │
                    │ chatModel()/  │  │ cascade    │ │ (Prisma 7)     │
                    │ smallModel()  │  │ (ADR-2):   │ │ users/sessions │
                    │ (provider.ts; │  │ regex →    │ │ conversations  │
                    │ resolveProvider│ │ OpenAI Mod │ │ messages/cards │
                    │ ADR-3 listo,  │  │ → LLM judge│ │ memoria/safety │
                    │ sin activar)  │  └────────────┘ └────────────────┘
                    └───────────────┘
```

Módulos en `simon/src/`:

| Módulo | Archivo | Responsabilidad |
|---|---|---|
| Adaptador HTTP | `app/api/chat/route.ts` | CSRF (`sameOriginOk`), sesión (`requireSession`, ADR-8), `maxDuration`, inyecta `defer=after()`, catch de infra — <150 líneas |
| Orquestador chat | `lib/chat-pipeline/run.ts` | `runChatPipeline()` (ADR-1): consentimiento → rate limit → validate → flag regex → moderación+generación en paralelo → precedencia → persist → notify |
| Validación | `lib/chat-pipeline/validate.ts` | Rate limit, body, tope de mensajes/caracteres, `clientMessageId` |
| Contexto | `lib/chat-pipeline/build-context.ts` | Fichas + memoria + resúmenes + historial → `assembleContext()` (ADR-7) → system prompt |
| Generación | `lib/chat-pipeline/generate.ts` | `generateText()` con retry/timeout vía `chatModel()`; nunca lanza (`GenerationResult`) |
| Persistencia | `lib/chat-pipeline/persist.ts` | `saveAssistant`/`recordSafetyEvent` en una transacción; nunca lanza (invariante M1) |
| Diferidos | `lib/chat-pipeline/notify.ts` | Alerta a tutor, `InteractionLog`, purga lazy — todo vía `defer` (post-respuesta) |
| Precedencia de seguridad | `lib/chat-precedence.ts` | `decideResponsePath`/`decidePostGenPath` — funciones puras, sin cambios por la rearquitectura |
| Guardrail cascade | `lib/guardrails/cascade.ts` | `runGuardrailCascade(checks, input, inconclusive)` (ADR-2): cheapest-first, fail-closed ante throw/timeout, primer veredicto concluyente gana |
| Moderación | `lib/moderation.ts` | Registra los checks (regex → OpenAI Moderation → clasificador LLM) sobre la cascada genérica |
| Safety regex | `lib/safety.ts` | Capa 1 determinística (~35ms, sin LLM); plantillas de crisis EXACTAS |
| Provider IA | `lib/ai/provider.ts` | `chatModel()`/`smallModel()` en uso; `resolveProvider(tier, run, opts)` (ADR-3: lista ordenada por env, retry, circuit-breaker en memoria) implementado y testeado, **sin activar** en ningún call site — falta un segundo proveedor contratado |
| Presupuesto de contexto | `lib/ai/context-budget.ts` | `assembleContext()` (ADR-7) — única fuente de recorte por tokens estimados, por bucket (fichas/memoria/resúmenes/historial); el mensaje actual nunca se recorta |
| Sesión compartida | `lib/require-session.ts` | `requireSession()` (ADR-8) — 401 uniforme con `cache-control: no-store`, reemplaza el chequeo duplicado en 8+ rutas |
| Retención | `lib/retention.ts` | `purgeExpiredData()` (ADR-4): TTL de `Message`/`Conversation` (365d), `SafetyEvent` (730d, excluye alertas pendientes), `UserMemory`/`InteractionLog`/`Session`, bajo lock advisory Postgres |
| Export de entrenamiento | `lib/training-export.ts` | `redactPII()` (ADR-5) — regex de PII estructural (email/teléfono/DNI/dirección/credenciales en URL) → `[REDACTADO:<tipo>]`, antes de escribir el JSONL |
| Env/CSRF | `lib/env-check.ts` | `assertProdEnv()` — hard-fail si falta Upstash en `VERCEL_ENV=production` (ADR-6); `sameOriginOk()` (CSRF en profundidad) |
| Auth | `lib/auth.ts` / `lib/auth-client.ts` | better-auth server + client |
| DB | `lib/prisma.ts` | Cliente Prisma con driver adapter |

Regla invariante: **ningún output de LLM llega al usuario en un flujo de crisis**. La rama de seguridad responde con plantillas hardcodeadas (research-safety §3.3) y registra el evento. Tampoco se streamea nunca la respuesta: se genera completa, se modera la salida y recién ahí se muestra — así ningún texto sin moderar llega a un menor.

---

## 3. Modelo de datos

Implementado en `simon/prisma/schema.prisma` (✅) o pendiente (⬜):

| Entidad | Estado | Campos clave / notas |
|---|---|---|
| `User` | ✅ | Identidad. Agregar en Fase 1: `birthYear` (franja etaria para calibrar lenguaje, NO fecha exacta — minimización), `role` (`child` \| `guardian`) |
| `Session` / `Account` / `Verification` | ✅ | Tablas better-auth. Sesiones server-side revocables |
| `Conversation` | ✅ | Hilo por usuario, cascade delete |
| `Message` | ✅ | `role`, `content`, `safetyFlag` — flag seteado por la capa de seguridad |
| `KnowledgeCard` | ✅ | Corpus RAG: `slug`, `category`, `body`, `source` (ley/organismo), `reviewed` (false hasta firma de profesional). Fase 2: columna `embedding vector(1536)` |
| `UserMemory` | ✅ | Hechos extraídos (`fact`/`preference`/`context`). Sin PII, TTL 90 días (job Fase 2) |
| `Guardian` ⬜ | Fase 1 | Vínculo tutor↔menor, `consentAt` (consentimiento verificable, Ley 25.326 art. 5), `alertsEnabled`, email verificado |
| `SafetyEvent` ⬜ | Fase 1 | Trigger de crisis: `category` (T1–T7), `layer` (keyword/moderation), timestamp, `notifiedAt`. Anonimizado del contenido; auditable |

Reglas de datos (no negociables — camino crítico):
- Conversaciones = **datos sensibles de salud de menores** (Ley 25.326 art. 2): cifrado at-rest (Neon lo da), TLS, retención ≤ 12 meses, borrado a pedido (`DELETE` cascade ya modelado).
- Minimización: no domicilio, no documento, no fecha exacta de nacimiento, no PII en `UserMemory` (el prompt de extracción lo prohíbe explícito).
- Nada de datos de menores para entrenar modelos sin opt-in separado del tutor.

---

## 4. RAG pipeline

Corpus actual: ~30 fichas psicoeducativas/derechos (semilla en `prisma/seed.ts`, portadas de `legacy/data.js`, `reviewed: false` hasta validación profesional). Proyección: 100–500 fichas.

**Decisión: nada de vector DB hasta que haga falta.** Con fichas de ~150 tokens, 500 fichas ≈ 75K tokens — entran enteras en el contexto de 1M de DeepSeek, y el prefijo estable se cachea a $0.0028/MTok. Pipeline por etapas:

1. **Hoy (Fase 0–1) — filtro por categoría + inyección:** match de keywords del mensaje contra `category`/`title` en SQL (`KnowledgeCard` ya indexada por categoría) → top ~10 fichas al prompt. Cero infra, cero costo extra.
2. **Fase 2 — embeddings en Postgres:** cuando el keyword-match falle medible o el corpus pase ~300 fichas: `text-embedding-3-small` ($0.02/MTok; embeber 500 fichas ≈ $0.002, una vez) + columna pgvector en Neon + cosine top-10. Sin servicio nuevo: mismo Postgres.
3. **Nunca (a esta escala):** Pinecone/Qdrant/Weaviate — overkill bajo 100K chunks.

**Ingesta:** fichas se cargan vía seed/admin con `source` (ley u organismo) y quedan `reviewed: false`; solo fichas revisadas por profesional entran al prompt en producción. Alta/edición de ficha → re-embed de esa ficha sola (Fase 2).

**Costo por query:** etapa 1: $0 adicional (las fichas viajan en el prefijo cacheado del prompt). Etapa 2: 1 embedding de query (~30 tokens) ≈ $0.0000006 + misma inyección → **el RAG es gratis a efectos prácticos**; el costo real es el input del LLM (§6).

---

## 5. Plan de implementación

Cada fase termina con un entregable verificable. `pnpm build` + smoke test = gate mínimo de cada fase.

**Fase 0 — Chat seguro local (≈80% hecha)**
- ✅ Next.js 16 + Prisma + better-auth (email/password) + chat streaming + provider swap por env + seed de fichas + safety por keywords + rate limit.
- ⬜ Restante: plantillas de crisis exactas de research-safety §3.3 con teléfonos verificados (135, 102, 137, 911); presentación como IA en primer mensaje; `pnpm build` verde.
- **Verificable:** en local, registrarse → chatear con streaming → escribir "me quiero morir" devuelve plantilla CRITICAL textual (sin LLM) y persiste `safetyFlag`.

**Fase 1 — Producción con consentimiento (2–3 semanas)**
- Moderation API pre y post LLM (capa 2 de safety) + `SafetyEvent`.
- Modelo `Guardian`: registro de tutor, verificación de email, consentimiento explícito documentado ANTES de que el menor chatee; alertas de crisis por email al tutor.
- Migración a Neon Postgres (cambiar provider + `DATABASE_URL`), deploy en Vercel, headers de seguridad (CSP, HSTS), disclosure "soy una IA" cada ~10 turnos, límite de sesión 45 min.
- **Verificable:** URL de producción; suite de ~20 mensajes de crisis (T1–T7) responde 100% con plantillas fijas; menor sin consentimiento de tutor no puede chatear; screenshot en prod.

**Fase 2 — Memoria, tutor y accesibilidad (1–2 meses)**
- Resumen de conversación al cierre (LLM barato) + inyección al inicio de la siguiente; extracción de hechos sin PII con TTL 90 días; job de expiración.
- Panel tutor: temas emocionales semanales (nunca transcripciones por defecto), historial de alertas.
- pgvector + embeddings si el corpus lo justifica (§4.2).
- UI/UX según research-safety §7: WCAG 2.1 AA, quick replies, selector de emociones pictográfico, modo calma, voseo, mensajes cortos por franja etaria. Inspiration Brief antes de tocar diseño.
- **Verificable:** Lighthouse accesibilidad ≥ 95; test con lector de pantalla; sesión nueva recuerda resumen de la anterior; panel tutor muestra alerta tras evento simulado.

**Fase 3 — Evaluación y modelo propio (3+ meses, condicional a uso real)**
- Métricas de resultado (mood check-in inicio/cierre), revisión de fichas por profesional, co-diseño con ≥2 grupos de usuarios con discapacidad (requisito de research-safety §7.4).
- Fine-tune local (Qwen/Llama) servido por vLLM → swap con `AI_BASE_URL` — cero cambios de código.
- **Verificable:** informe de métricas de 1 mes; A/B de modelo local vs API con la misma suite de crisis al 100%.

---

## 6. Modelo de costos mensual (worst case: 100 usuarios/día × 10 msg = 30.000 msg/mes)

Prompt por mensaje ≈ 4.5K tokens input (system 1.2K + fichas 1.5K + memoria 0.3K + historial 1.5K), ~250 output. El prefijo (system + fichas ≈ 2.7K) es estable → cache hit de DeepSeek.

| Rubro | Worst case (sin cache) | Realista (con cache) |
|---|---|---|
| LLM input (30k × 4.5K tok × $0.14/M) | $18.90 | ~$7 (60% del prompt a $0.0028/M) |
| LLM output (30k × 250 tok × $0.28/M) | $2.10 | $2.10 |
| Tareas auxiliares (títulos, resúmenes, extracción) | $1 | $1 |
| Moderación (OpenAI Moderation API) | $0 | $0 |
| Embeddings (Fase 2, queries + corpus) | $0.20 | $0.20 |
| Neon Postgres (usage-based) | $19 | $0–5 (free tier alcanza al inicio) |
| Vercel Pro | $20 | $20 |
| Dominio + email transaccional (alertas tutor) | $3 | $3 |
| **Total** | **≈ $64/mes** | **≈ $33/mes** |

- Beta (sin usuarios reales): Vercel Hobby + Neon free + LLM de pruebas ≈ **< $5/mes**.
- Escala 10× (1.000 DAU): LLM ≈ $90–210, Neon ≈ $19–40, Vercel Pro igual → ≈ $150–270/mes; recién ahí evaluar Hetzner+Coolify (ahorra los $20 de Vercel, no el LLM, que domina).
- Palanca de costo #1: tamaño del prefijo cacheado y ventana de historial — medir antes de optimizar.

---

## Estado de implementación (2026-07-15 — EN PRODUCCIÓN)

**Producción:** `https://simon.maat.work` — dominio oficial (Vercel proyecto `simon-ai`, team giolivos-projects, alias `simon-ai-sigma.vercel.app`; deploy por CLI `vercel deploy --prod` desde `simon/` — el push a GitHub NO dispara deploy). DB: Neon managed vía Vercel Marketplace (runtime pooled, migraciones/seed con `DATABASE_URL_UNPOOLED`). Seed (fuente única en `prisma/*-data.ts`): 19 fichas de conocimiento, 20 recursos georreferenciados de Cerca tuyo y 5 guías de trámites, actualizadas (Secretaría Nacional de Discapacidad, Decreto 942/2025).

Gate objetivo (desde `simon/`): **`pnpm test`** (runner unificado `scripts/run-suites.ts`, cuyo array `SUITES` es la fuente de verdad del conjunto de suites: safety/crisis, moderación, guardián y menores, memoria/retención, retrieval/knowledge y auth/seguridad) `&& pnpm lint && pnpm build` — **verde tras dos auditorías** (security review + code review con fixes H1/H2/M1/M2/M3/L1/L2/L5 aplicados: anti-injection de roles en historial, sweep del rate limiter por ventana propia, plantilla de crisis inmune a fallos de DB, alta de menor transaccional, timeout de generación). `scripts/conversation-eval.ts` es el harness exploratorio con LLM real (no determinístico, fuera del gate) usado por el loop de QA/entrenamiento.

**Hecho y verificado E2E (curl + Playwright contra dev server real, LLM real):**
- Chat con DeepSeek V4 Flash real (gateway OpenCode Go, thinking desactivado). Respuestas reales usando fichas (fix de tokenizer para siglas CUD/TEA/TEL).
- Sin streaming por diseño: generar completo → moderar → mostrar (garantía de que ningún output sin moderar llega a un menor).
- Safety: capa 1 regex (T1-T7, crisis en ~35ms sin LLM, plantillas §3.3 exactas con 135/0800-345-1435/102/137/911) + capa 2 cascada OpenAI Moderation → **clasificador LLM real** (deepseek temp 0, conservador; la key OpenAI del sistema da 401) + fail-closed en salida + `SafetyEvent` auditable con `source`.
- Guardian tutor-first: registro con verificación de email (Resend real), alta de menores (email sintético `.invalid` bloqueado en signup público por hook one-shot), consentimiento con timestamp+IP+UA, gate de chat para menores sin consentimiento, alertas de crisis por email con dedupe 1h, derecho de supresión con cascade verificado (0 huérfanos), toggle de alertas.
- Cerca tuyo (Fase 1): directorio de recursos reales georreferenciado en `/ayuda/cerca` (20 recursos seedeados) + guías de trámites — ver `docs/PLAN-EXPANSION.md`.
- Seguridad post-auditoría: fixes C1/A1/A2/M1/M3/M4/B2 aplicados (Origin check, rate limit Upstash-ready, env bootstrap, delimitadores anti-injection, sin tokens en logs prod).
- Memoria: resumen lazy de conversación previa (modelo small) + extracción de hechos sin PII + TTL 90 días lazy + inyección delimitada.
- Sesión: disclosure IA determinístico cada 10 turnos, aviso a los 30 min, cierre suave a los 45 (server-side).
- UI design system "simon-mocha" (spec: [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md)): Nunito, paleta crema/salvia/terracota con gradiente de fondo, logo squircle + ilustración hero, header sticky con nav de píldoras, bottom-nav mobile flotante, chat a viewport fijo (h-dvh + `interactiveWidget: resizes-content` para el teclado), quick-start cards, mood chips, typing indicator, modo calma, AA en contrastes y touch ≥44px. Verificado con screenshots desktop/mobile en prod.
- `/aprender`: mapa de diagnósticos y trámites con las 19 fichas reales de la DB (filtros por categoría, búsqueda, detalle en dialog con fuente legal y badge de revisión). Solo tutores.
- Retomar conversación: `GET /api/chat/resume` (auth, sin safetyFlag) + tarjeta "¿Seguimos donde quedamos?" con elección explícita Continuar/Empezar de nuevo.
- Tier "riesgo" cálido (QA loop): `crisisSystemAddendum("riesgo")` con derivación liviana (adulto de confianza + Línea 102, sin volcar el bloque de emergencia) + invariantes de regresión en crisis-suite. Crisis/abuso/alimentario siguen con plantilla fija intocable.
- Latencia optimizada: moderación de entrada en paralelo con generación (regeneración solo en el caso raro riesgo-por-API) — p50 medido 5.3s → **3.6s**.
- Páginas de framework (`error/not-found/loading`), favicon propio, `alert()` eliminados, viewport fix iOS.
- Rearquitectura ADR-1..9 ([`adr-rearquitectura-2026-07.md`](adr-rearquitectura-2026-07.md), quirúrgica, sin cambio de comportamiento): pipeline por stages (`chat-pipeline/`), cascada de guardrails genérica y activa en `moderation.ts`, router de proveedores implementado y testeado (sin activar, falta segundo proveedor), retención completa Message/Conversation/SafetyEvent, redacción PII en export de entrenamiento, Upstash obligatorio en prod, fuente única de recorte de contexto por tokens, `requireSession()` compartido — gate 37/37 · 1197 casos.

**Pendiente (backlog ordenado):**
1. Dominio propio verificado en Resend + `EMAIL_FROM` (hoy `onboarding@resend.dev`: solo entrega al dueño de la cuenta). Upstash en prod para rate limit distribuido. Registrar base ante AAIP.
2. `OPENAI_API_KEY` real de OpenAI (gratis, más rápida que el clasificador LLM; la cascada la toma sola al reiniciar).
3. Resumen semanal de temas al tutor (M-P2 parte 2) y score de riesgo acumulado en el panel (anti "crisis fatigue").
4. Capa 3 de detección (trayectoria de sentimiento en la sesión, M-S1). Ejercicio de respiración al cierre de sesión de chat.
5. Voice input (Web Speech es-AR), mood-trend del usuario, modo alto contraste, vocabulario emocional por franja etaria.
6. Revisión clínica de fichas (`reviewed: false` hoy) y co-diseño con grupos de usuarios con discapacidad antes de launch real.
7. Cambio de contraseña en la UI (hoy solo por soporte).

## Riesgos aceptados

1. **DeepSeek alignment débil** → mitigado con moderación pre/post obligatoria y plantillas de crisis sin LLM; si falla en la suite de crisis, swap inmediato a `gpt-4.1-nano` (2 env vars).
2. **Datos fuera de Argentina** (Vercel/Neon/DeepSeek US) → Ley 25.326 art. 12 exige nivel adecuado de protección en el receptor: cifrado, DPA de cada proveedor, y consentimiento informado del tutor que lo declare. Registrar base ante AAIP (Fase 1).
3. **Deprecación DeepSeek:** IDs legacy `deepseek-chat`/`deepseek-reasoner` mueren el 2026-07-24 — la app ya usa `deepseek-v4-flash` en `.env.example`, local y producción.
4. **Enumeración de usernames en alta de menores (ADR-9):** el precheck de duplicados de username en el alta guiada por el tutor revela si un username ya existe. Se acepta porque la UX del flujo lo requiere (evitar altas fallidas silenciosas); mitigado con rate limit sobre el endpoint y con que el alta exige sesión de tutor autenticada (no es superficie anónima).
