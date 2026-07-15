# Auditoría de arquitectura — Simón AI (2026-07)

Alcance: `simon/` (Next.js 16 App Router, Prisma 7 + Neon, `ai` SDK 7.0.18, better-auth,
Vercel). Solo lectura, sin ejecución de tests. Complementa (no reemplaza) `docs/ARCHITECTURE.md`
y `docs/research-architecture.md`, que documentan la decisión de stack; esta auditoría mira el
estado real del código y su deuda técnica.

Método: inventario por líneas (`git ls-files` + `wc -l`), grep dirigido de imports/exports,
lectura de fragmentos ≤80 líneas de los módulos centrales, `npx madge --circular` sobre `src`.

## 0. Resumen ejecutivo

El código de dominio (`src/lib`) está inusualmente bien documentado y ya contiene varios
patrones de robustez maduros: precedencia de seguridad como función pura y testeada
(`chat-precedence.ts`), presupuesto de contexto por tokens con invariantes cruzadas
(`ai/context-budget.ts`), degradación Upstash→memoria con circuit-breaker informal
(`rate-limit.ts`, `auth-secondary-storage.ts`), y una cascada de moderación de dos capas
(OpenAI Moderation API → clasificador LLM) que ya es, de hecho, un prototipo de "cascada de
guardrails". El problema principal no es la calidad del código sino su **agregación**: casi
toda la orquestación del pipeline de chat vive en una sola función de ~1050 líneas
(`src/app/api/chat/route.ts`), y el proveedor de IA es un único endpoint hardcodeado sin
concepto de router ni fallback. No se encontraron dependencias circulares en código propio (las
18 que reporta madge son todas internas al cliente Prisma generado).

## 1. Mapa de módulos y dependencias (ASCII)

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser (React 19)                                                │
│  chat.tsx(772L)  tutor-panel.tsx(725L)  bienestar.tsx(400L)         │
│  conversation-list  auth-form  resource/learn-explorer  ...         │
└───────────────────────────────┬─────────────────────────────────────┘
                                 │ fetch / SSE (AI SDK UIMessage stream)
                                 ▼
                    ┌─────────────────────────┐
                    │ src/proxy.ts (edge)       │  matcher-based, NO auth
                    └────────────┬──────────────┘
                                 ▼
┌───────────────────────────────────────────────────────────────────┐
│ src/app/api/*  (route handlers)                                    │
│  chat/route.ts (1237L, POST monolítico)   chat/resume/route.ts       │
│  conversations[, /[id]]   guardian/{account,bridge,children[/id]}    │
│  mood  resources  tramites/progress  user/diagnosis                  │
│  cron/purge (bearer token, Vercel Cron)   auth/[...all] (better-auth) │
└───┬───────────┬────────────┬─────────────┬──────────────┬───────────┘
    │           │            │             │              │
    ▼           ▼            ▼             ▼              ▼
┌────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────┐
│safety  │ │moderation│ │  ai/*    │ │guardian*  │ │rate-limit /   │
│.ts     │ │.ts (416L)│ │provider  │ │-auth.ts   │ │claim-once /   │
│regex + │ │OpenAI mod│ │retry     │ │-children  │ │single-flight /│
│templa- │ │API → LLM │ │memory    │ │-account   │ │session-limit /│
│tes     │ │clasific. │ │(447L)    │ │           │ │alerts.ts(468L)│
└───┬────┘ └────┬─────┘ │system-   │ └─────┬─────┘ └──────┬────────┘
    │           │       │ prompt   │       │              │
    │           │       │(303L)    │       │              │
    │           │       │context-  │       │              │
    │           │       │budget    │       │              │
    │           │       └────┬─────┘       │              │
    └───────────┴─────┬──────┴─────────────┴──────────────┘
                       ▼
          ┌─────────────────────────────┐
          │ chat-precedence.ts (pure)     │ decideResponsePath / decidePostGenPath
          └───────────────┬─────────────────┘
                           ▼
          ┌─────────────────────────────┐
          │ prisma.ts → schema.prisma     │ → Neon Postgres
          │ (16 modelos, ver §3)          │
          └───────────────┬─────────────────┘
                           ▼
          ┌─────────────────────────────┐
          │ retention.ts (cron/purge)     │
          └─────────────────────────────┘

Servicios externos (todos opcionales/pluggables salvo el LLM principal):
  AI_BASE_URL (default https://api.deepseek.com) — generación + smallModel, un solo proveedor
  https://api.openai.com/v1/moderations — capa 1 de moderación (URL hardcodeada)
  UPSTASH_REDIS_REST_* — rate-limit compartido + secondaryStorage de better-auth
                          (ambos degradan a in-memory si falta o falla)
  Resend (email.ts) — verificación de cuenta / alertas a tutores
```

## 2. Módulos centrales (líneas, rol)

| Módulo | Líneas | Rol |
|---|---|---|
| `src/app/api/chat/route.ts` | 1237 | Orquesta TODO el pipeline: rate-limit, idempotencia, regex-safety, moderación entrada, generación, precedencia, moderación salida, persistencia, alertas, memoria/resumen. |
| `src/lib/moderation.ts` | 416 | Cascada de 2 capas (OpenAI Moderation API → clasificador LLM vía `smallModel()`), con backoff de key inválida. |
| `src/lib/safety.ts` | 360 | Capa 0 (regex, gratis, pre-LLM) + plantillas fijas de crisis/abuso/alimentario + política fail-closed de salida no moderada. |
| `src/lib/alerts.ts` | 468 | Notificación a tutores (dedupe por ventana, alertas de patrón). |
| `src/lib/ai/memory.ts` | 447 | Resumen de conversación cerrada + resumen rodante (rolling summary) + detección de inyección en "memorias". |
| `src/lib/ai/system-prompt.ts` | 303 | Persona, selección de fichas relevantes, instrucciones por edad/rol. |
| `src/lib/auth-secondary-storage.ts` | 294 | SecondaryStorage de better-auth sobre Upstash con fallback in-memory. |
| `src/lib/ai/context-budget.ts` | 177 | Presupuesto de contexto por tokens estimados, por "bucket" (fichas/memorias/resúmenes/historial). |
| `src/lib/retention.ts` | 207 | TTLs de purga (logs, huérfanos), lock de cron. |
| `src/lib/rate-limit.ts` | 176 | Upstash REST (INCR+PEXPIRE+PTTL atómico) con fallback in-memory. |
| `src/lib/ai/provider.ts` | 101 | Wrapper único sobre `createOpenAICompatible`; sin router, sin multi-proveedor. |
| `src/lib/ai/retry.ts` | 154 | Reintento genérico para errores transitorios (5xx/ECONNRESET), reutilizable. |
| `src/lib/chat-precedence.ts` | 108 | `decideResponsePath` / `decidePostGenPath`: única fuente de la precedencia de seguridad, función pura. |
| `prisma/schema.prisma` | 452 | 16 modelos: User/Guardian/Session/Account/Verification (auth), Conversation/Message (chat), SafetyEvent (auditoría anonimizada), KnowledgeCard/HelpResource/TramiteGuide (RAG liviano), UserMemory, InteractionLog. |
| `scripts/*-suite.ts` | 7896 (23 archivos) | Suites de test artesanales corridas con `tsx` + `run-suites.ts` como gate — no hay vitest/jest. |

## 3. Hallazgos

| Sev | Hallazgo | Ubicación | Impacto |
|---|---|---|---|
| **H** | `POST` de chat es una sola función de ~1050 líneas (187–1237) sin descomposición interna (no hay funciones anidadas de ayuda; toda la lógica de ramas vive inline). | `simon/src/app/api/chat/route.ts:187-1237` | Alto acoplamiento temporal entre etapas; agregar un router multi-modelo o una etapa extra de guardrail exige tocar esta única función gigante en vez de insertar un stage. Testeable solo end-to-end vía las suites de scripts, no por unidad. |
| **H** | Proveedor de IA es un único `createOpenAICompatible` hardcodeado (default `api.deepseek.com`); `chatModel()`/`smallModel()` no tienen noción de múltiples proveedores. `withTransientRetry` reintenta el MISMO endpoint, nunca cae a otro. | `simon/src/lib/ai/provider.ts:54-84` | Single point of failure: si el gateway configurado cae, la generación entera cae (solo sobrevive la capa regex de crisis, que devuelve plantilla fija). No hay camino incremental hacia "router multi-modelo" sin reescribir esta capa. |
| **H** | Rate-limit y secondaryStorage de auth degradan a **in-memory por instancia** si Upstash no está configurado (o falla). Documentado como trade-off aceptado, pero no hay assert en `env-check.ts` que fuerce Upstash en prod. | `simon/src/lib/rate-limit.ts:167-176`, `simon/src/lib/auth-secondary-storage.ts:26,72-103` | En Vercel (multi-instancia serverless) el rate-limit y la revocación de sesión dejan de ser globales silenciosamente si falta una env var — sin fallo duro, solo degradación. |
| **M** | Dos mecanismos independientes de recorte de historial: `MAX_HISTORY_MESSAGES=24` (cap por cantidad, en la query a DB) y `CONTEXT_BUDGETS.history=3000` tokens (`trimHistory`, recorte por tamaño). Unidades distintas, archivos distintos. | `simon/src/app/api/chat/route.ts:99,329,788` vs `simon/src/lib/ai/context-budget.ts:37-43` | Cambiar uno sin el otro puede alterar el comportamiento de forma no obvia; no hay una única fuente de verdad para "cuánto contexto entra". |
| **M** | Sin framework de test estándar: 23 scripts `*-suite.ts` (7896 líneas) corridos vía `tsx` + `scripts/run-suites.ts` como gate, en vez de vitest/jest. | `simon/scripts/` (23 archivos), `simon/package.json:14` | Funciona, pero sin cobertura reportada, sin integración de test-explorer en el IDE, mayor costo de onboarding y de detectar tests rotos/ignorados. |
| **M** | Separación PII/contenido es por convención de prompt ("SIN datos identificables"), no validada post-hoc. `Conversation.summary`/`rollingSummary` se generan por LLM y se reinyectan como contexto futuro y en exports a tutores, sin sanitización programática. | `simon/prisma/schema.prisma:145-160`, `simon/src/lib/ai/memory.ts` (parseSummaryAndFacts) | Un fallo del modelo (o inyección) podría filtrar datos identificables a un campo que luego se reutiliza como contexto y se exporta — no hay defensa en profundidad, solo la instrucción de sistema. |
| **M** | La cascada de moderación (OpenAI Moderation API → clasificador LLM) es un buen patrón pero está hardcodeada dentro de `moderation.ts`, no extraída como abstracción reutilizable. | `simon/src/lib/moderation.ts:374-415` | Es exactamente la pieza que el brief pide generalizar para "cascada de guardrails"; hoy solo sirve a moderación, no a generación ni a otras políticas. |
| **M** | Chequeo de sesión repetido inline (`auth.api.getSession` + null/rol check) en ≥8 rutas sin helper compartido, a diferencia del caso guardian-only que sí tiene `requireGuardian`. | `simon/src/app/api/chat/route.ts:197`, `mood/route.ts:34,78`, `conversations/route.ts`, `chat/resume/route.ts`, `user/diagnosis/route.ts`, `resources/route.ts`, `tramites/progress/route.ts` vs `simon/src/lib/guardian-auth.ts:23-38` | Duplicación de bajo riesgo; superficie de revisión de seguridad más grande de lo necesario. |
| **L** | URL de moderación hardcodeada (`https://api.openai.com/v1/moderations`) en vez de vía env, rompiendo la filosofía "todo por env" que documenta `provider.ts`. | `simon/src/lib/moderation.ts:167` | Bajo impacto (es la API fija de OpenAI), pero inconsistente con el patrón del resto del código. |
| **L** | `chat.tsx` (772L) y `tutor-panel.tsx` (725L) son componentes cliente grandes; no revisados línea a línea por presupuesto de contexto de esta auditoría — pendiente de una pasada frontend dedicada. | `simon/src/components/chat.tsx`, `simon/src/components/tutor-panel.tsx` | Riesgo de mismo patrón de "god component" que `chat/route.ts`, sin confirmar. |

### Fortalezas verificadas (para no perder de vista en el refactor)

- `chat-precedence.ts`: precedencia de seguridad extraída a función pura, documentada con el
  invariante explícito "una crisis SIEMPRE gana", clave para no romper seguridad al tocar el
  pipeline.
- `ai/context-budget.ts`: presupuesto de contexto ya soporta resumen rodante (rolling summary)
  con invariante cruzada documentada entre `MAX_ROLLING_SUMMARY_CHARS` (memory.ts) y
  `CONTEXT_BUDGETS.rollingSummary`.
- `ai/retry.ts`: reintento genérico, no acoplado a un proveedor — reutilizable como base de un
  router multi-proveedor.
- Degradación Upstash→memoria con ventana de backoff informal (mismo patrón que el de
  `moderation.ts` para la key de OpenAI) — patrón consistente, aplicable a un futuro router de
  proveedores de IA.
- Cero dependencias circulares en código propio (las 18 de madge son internas al cliente Prisma
  generado, no accionables).
- `SafetyEvent` diseñado explícitamente para NO guardar contenido del mensaje (solo categoría +
  capa), con comentario explícito en el schema.

## 4. Evaluación dirigida (preguntas del brief)

**¿El pipeline de chat está aislado para agregar router multi-modelo y cascada de guardrails sin
reescribir?** No del todo. La lógica de DECISIÓN ya está aislada (`chat-precedence.ts`, pura y
testeada) y el patrón de cascada ya existe en miniatura (`moderation.ts`), pero la EJECUCIÓN vive
enterrada en una función de 1050 líneas y el proveedor de IA es un singleton sin interfaz de
router. Agregar un router multi-modelo hoy exige editar `ai/provider.ts` (romper su forma actual
de "una sola función que devuelve un LanguageModel") y tocar `chat/route.ts` en el punto exacto
del `Promise.all` de generación paralela (línea ~901). Es viable sin reescritura completa, pero sí
requiere el refactor #1 y #2 de la sección 5 primero.

**¿La capa de memoria/contexto soporta resumen rodante?** Sí, ya implementado y testeado
(`ai/memory.ts:rollingSummaryDue/updateRollingSummary`, `ai/context-budget.ts:trimRollingSummary`,
suite `scripts/memory-suite.ts`). No requiere trabajo adicional para esa capacidad puntual.

**¿Hay separación PII/contenido?** Parcial. Hay separación de **intención**
(`SafetyEvent` sin contenido, `summary`/`rollingSummary` con instrucción de "sin datos
identificables") pero no separación **estructural** (mismo campo de texto libre, sin validación
posterior de que la instrucción se cumplió). Ver hallazgo M (PII).

## 5. Top 5 refactors por ROI

Orden por ROI global; cada uno etiquetado con su dimensión principal (robustez / eficiencia de
tokens / escalabilidad).

1. **Descomponer `chat/route.ts` en un pipeline explícito de stages** (regex-guard →
   input-moderation+generation en paralelo → precedencia → output-moderation → persist → alertas),
   manteniendo `chat-precedence.ts` como el cerebro de ruteo ya existente. *Robustez +
   escalabilidad — máxima prioridad*: es el prerequisito real para insertar un router multi-modelo
   o una etapa extra de guardrail sin tocar 1000 líneas de una sola función. Bajo riesgo de
   regresión si se hace por extracción mecánica (mover código, no reescribir lógica) apoyándose en
   las suites existentes como red de seguridad.
2. **Generalizar la cascada de `moderation.ts` (OpenAI API → LLM) en un helper reusable**
   `runGuardrailCascade(stages)` en `lib/ai/`, y reusarlo tanto para moderación como para un futuro
   fallback de generación (proveedor primario → secundario). *Escalabilidad + robustez*: convierte
   un patrón ya probado en producción en la base del router pedido, en vez de inventar uno nuevo.
3. **Router de proveedores en `ai/provider.ts`**: reemplazar el `createOpenAICompatible` único por
   una lista ordenada de candidatos `{baseURL, apiKey, model}` con el mismo patrón de
   circuit-breaker/backoff que ya usa `moderation.ts` (`openAiKeyUsable`), y que
   `withTransientRetry` pruebe el siguiente candidato en vez de reintentar el mismo. *Robustez
   (elimina el SPOF de generación) + escalabilidad (permite mandar consultas baratas a modelos
   baratos)*.
4. **Unificar el recorte de historial en una sola fuente de verdad**: hoy `MAX_HISTORY_MESSAGES`
   (conteo) y `CONTEXT_BUDGETS.history` (tokens estimados) son dos knobs independientes en dos
   archivos. Consolidar en `context-budget.ts` (que ya hace el recorte fino) y que el cap de la
   query a DB sea derivado, no un número mágico aparte. *Eficiencia de tokens*: además abre la
   puerta a reemplazar la heurística `chars/4` por un conteo real de tokens del modelo activo sin
   tener que sincronizar dos lugares.
5. **Extraer `requireSession()`/`requireRole()` compartidos** (mismo patrón que ya existe
   `requireGuardian` en `guardian-auth.ts`) para las ≥8 rutas que repiten el chequeo de sesión
   inline, y agregar una validación programática ligera (regex/longitud/lista de patrones de PII)
   sobre `summary`/`rollingSummary` antes de persistir, como defensa en profundidad más allá de la
   instrucción de prompt. *Robustez*, esfuerzo bajo, buen quick-win para reducir superficie de
   revisión de seguridad.

---
*Auditoría de solo lectura — ningún archivo de `simon/` fue modificado. Generado el 2026-07-15.*
