# Mejoras de arquitectura post-ADR (2026-07)

> Revisión crítica del repo tras la rearquitectura ADR-1..10, hecha por agentes de análisis sobre el código real (informes completos: [`research-modelo-propio/repo-mejoras-arquitectura.md`](research-modelo-propio/repo-mejoras-arquitectura.md), [`repo-data-flywheel.md`](research-modelo-propio/repo-data-flywheel.md), [`repo-integracion-llm.md`](research-modelo-propio/repo-integracion-llm.md)). Nada de esto repite lo que los ADR ya resolvieron. Backlog priorizado; cada ítem cita archivo/módulo.

## P0 — Bloqueantes o de seguridad operativa

| # | Mejora | Dónde | Por qué |
|---|---|---|---|
| G3 | **Opt-in de entrenamiento del tutor** (`Guardian.trainingConsentAt` + `WHERE` en el export + UI en panel) | `prisma/schema.prisma`, `scripts/export-training.ts` | El export hoy incumple la regla documentada de ARCHITECTURE §3 ("nada de datos de menores para entrenar sin opt-in separado"). Prerequisito legal del flywheel (Ley 25.326). |
| B1 | **Reconciliar alertas de crisis con `after()` perdido**: el cron debe barrer también `SafetyEvent{crisis/abuso, notifiedAt:null, alertFailedAt:null}` | `alerts.ts` (`retryFailedCrisisAlerts`) | Una crisis cuya callback `after()` nunca corrió es hoy invisible al reconciliador (solo busca `alertFailedAt != null`). Cierra el agujero sin queue durable y da la métrica "alertas perdidas" que ADR-10 usa como trigger. |
| C1 | **Rate-limiter propio compartido** (backend Postgres, patrón ADR-6) | `lib/rate-limit.ts`, `validate.ts` | ADR-6 solo arregló better-auth; el limitador de la app (chat 15/min·400/día, rutas guardian) sigue cayendo a memoria por-instancia sin Upstash → bypasseable entre instancias serverless, justo en el endpoint más caro y en el alta de menores. |
| F1 | **`OPENAI_API_KEY` real** — no es higiene, es la palanca #1 de costo+latencia | env prod | Sin key, cada turno ejecuta 2 llamadas LLM de moderación extra (entrada y salida, la de salida serial) que el modelo de costos §6 cuenta como $0. |

## P1 — Observabilidad y confiabilidad (el hueco más grande post-ADR)

| # | Mejora | Dónde |
|---|---|---|
| A1 | `requestId` propagado por `PipelineCtx` + logger estructurado JSON mínimo + error-tracking (Sentry o equivalente) solo en catches de infra | `chat/route.ts`, `notify.ts`, `alerts.ts` — hoy hay 68 `console.*` sin correlación |
| A2 | Agregación/alerting sobre `InteractionLog` (picos de `fallback-error` / `moderation-unavailable` = degradación relevante a seguridad que hoy pasa invisible; el índice ya existe) | cron/endpoint admin nuevo |
| A3 | `GET /api/health` (SELECT 1 + `aiConfigured()` + versión, `no-store`, sin PII) para uptime monitoring externo | route nueva |
| D1 | **Suite de integración de `runChatPipeline`** (630 líneas de ruteo de seguridad sin test de cableado): por cada `responsePath`, afirmar qué se persistió, qué `defer` se encoló, qué texto salió | `scripts/` nueva suite, patrón inyectable ya usado por `retention.ts` |
| D2 | Tests HTTP de handlers (400/401/403/429, headers) | rutas chat/guardian |
| C2 | Documentar (y dejar preparado) que activar el router ADR-3 exige health-store compartido (Redis/Postgres) — el circuit-breaker en memoria es decorativo en serverless | `provider.ts` (interfaz `ProviderHealthStore` ya inyectable) |

## P2 — Data flywheel (habilita el laboratorio)

| # | Mejora | Dónde |
|---|---|---|
| G1 | Feedback explícito 👍/👎 (`MessageFeedback`) — sin señal de calidad no hay curación por outcome ni DPO | schema + UI chat |
| G2 | Export que explote señal implícita: excluir/pesar por `responsePath != "normal"`, `moderationOutputFlagged`; delta de `MoodEntry` como proxy de outcome | `export-training.ts` |
| G5+G7 | Dataset card con hash/versión/git SHA/config/**conversationIds** (permite re-emitir excluyendo revocaciones — derecho de oposición) | `scripts/export-training.ts` |
| G6 | `conversation-eval` como gate real: umbrales duros (0 safety✗, 0 leak, warmth ≥ N) + exit 1 | `scripts/conversation-eval.ts` |
| G4+G8 | Pipeline de curación: dedup/near-dup, **filtro de voseo**, NER de nombres (redactPII es regex), limpieza de `DISCLOSURE_TEXT` persistido, metadata de tema en el sidecar | `lab/` + export |

## P3 — Mantenibilidad, costo y evolución

| # | Mejora | Dónde |
|---|---|---|
| E1 | Helper `emitFixedResponse(...)` — ~7 ramas de `run.ts` repiten verbatim el bloque persist→alert→log→respond | `chat-pipeline/run.ts` |
| E2 | Wrapper `withGuardian(handler, {rateLimit, schema})` — CSRF+sesión+rate-limit+zod repetidos en 6 handlers | rutas guardian |
| E3 | `lib/config.ts` con schema zod del env completo, fail-fast en boot (el default `"deepseek-v4-flash"` está hardcodeado 8 veces) | lib nueva |
| F2 | Instrumentar ratio llamadas-aux/turno (moderación×2 + rolling summary + extracción + título = 4–6 llamadas small por turno) y tunear umbrales antes de 10x | `memory.ts`, `moderation.ts` vía A2 |
| F3 | `where: {reviewed: true}` detrás de flag `RAG_REQUIRE_REVIEWED` (hoy la compuerta está modelada pero no aplicada en retrieval — al completar la revisión clínica alguien tiene que "acordarse") | `build-context.ts` |
| B2 | Eliminar `scheduleTtlPurge` lazy (redundante con el cron ADR-4; 2 DELETEs por mensaje que casi siempre borran 0 filas) | `notify.ts`, `run.ts` |
| F4 | `prepareSendMessagesRequest` en `useChat` para mandar solo el último mensaje (el server ya descarta el resto) | `chat.tsx` |
| — | Timeout del moderador LLM a env (`LLM_TIMEOUT_MS=8s` hardcodeado — bloquea servir un modelo propio más lento en capa 2) | `moderation.ts:104` |
| — | `estimateTokens`/`CONTEXT_BUDGETS` calibrables por modelo (heurística 4 chars/token vs ~3 reales en español; ventana chica de un modelo propio) | `lib/ai/context-budget.ts` |

## Verificación

Los ítems P0/P1 se validan con el gate existente (`pnpm test && pnpm lint && pnpm build` desde `simon/`) más las suites nuevas que ellos mismos agregan (D1/D2). Ningún ítem toca la capa determinística de crisis ni la precedencia de seguridad (`chat-precedence.ts`).
