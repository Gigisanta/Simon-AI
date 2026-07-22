# Simón — Revisión crítica post-rearquitectura (ADR-1..10)

> Fecha: 2026-07-22 · Alcance: `simon/src`, `prisma/schema.prisma`, `scripts/`, `next.config.ts`, `vercel.json`.
> Regla: no repetir lo que los ADR ya resolvieron. Todo lo de abajo es estructural, NO bug puntual, y NO cubierto por ADR-1..10.

El dominio está sano y la rearquitectura fue quirúrgica y bien ejecutada (stages puros, cascada genérica, retención, router listo). Las mejoras de abajo atacan lo que quedó *fuera* del recorte de los ADR: observabilidad, durabilidad del trabajo diferido, paridad multi-instancia del rate-limit propio, cobertura de test del orquestador, y sprawl de duplicación/config.

---

## BLOQUE A — Observabilidad y operabilidad (el hueco más grande)

### A1. No hay tracing/correlación ni error-tracking: producción se debuggea con `grep` [alta impacto / media esfuerzo]
`src/**` tiene 68 `console.{log,error,warn}` con prefijos `[chat]`/`[moderation]`/`[alerts]` y cero infraestructura de observabilidad (no Sentry, no `@vercel/otel`, no logger estructurado — verificado en `package.json` y grep). Para un producto estatal a escala, un incidente ("¿por qué este menor recibió fallback?") obliga a leer logs planos de Vercel sin request-id, sin poder correlacionar los ~5 `console` de un mismo request, sin agregación de errores ni alerting. ADR-10 difiere Langfuse (auditoría LLM), pero eso NO cubre APM/errores del servicio.
- Propuesta: (1) un `requestId` (crypto.randomUUID) generado en `chat/route.ts` y propagado por `PipelineCtx`/`logInteraction`, incluido en cada log; (2) logger estructurado JSON mínimo (una función `log(level, event, fields)` — sin dependencia pesada); (3) Sentry (o equivalente) solo en el `catch` de infra de `route.ts` y en los `catch` no-throw de `notify.ts`/`alerts.ts`. Bajo costo, desbloquea todo el resto de la operación.

### A2. `InteractionLog` es telemetría rica que nadie lee: sin dashboard ni alerting sobre degradación [alta / media]
`schema.prisma` modela `InteractionLog` con latencia, tokens, `moderationInput/OutputSource`, `responsePath`, `safetyFlagFinal` — datos de oro — y `export-training.ts` los usa para el dataset, pero no hay ninguna query de agregación ni alerta operativa. Un pico de `responsePath="fallback-error"` o `"moderation-unavailable"` (ambas son degradaciones RELEVANTES A SEGURIDAD: el moderador de salida cayó) pasa invisible. Ya hay índice `@@index([responsePath])`, o sea la query es barata.
- Propuesta: un cron/endpoint admin que agregue las últimas 24h por `responsePath`/`moderation*Source` y alerte (email/log-error) si `fallback-error` o `moderation-unavailable` superan un umbral. Convierte datos ya capturados en señal operativa sin schema nuevo.

### A3. No hay endpoint de health/readiness para monitoreo externo [media / baja]
No existe `/api/health` (verificado). Un servicio público de gobierno necesita un probe barato para uptime monitoring (UptimeRobot/Betterstack) que verifique DB reachable + provider configurado, sin autenticación y sin tocar datos de menores.
- Propuesta: `GET /api/health` → `SELECT 1` con timeout corto + `aiConfigured()` + versión de build. `cache-control: no-store`, sin PII.

---

## BLOQUE B — Durabilidad del trabajo diferido (`after()`)

### B1. Una alerta de crisis cuya callback `after()` nunca corre es INVISIBLE al reconciliador [alta / media]
En `run.ts` el camino de crisis hace `recordSafetyEvent()` (síncrono) y luego `defer(() => alertGuardianSafely(...))`. Si la instancia serverless se recicla tras enviar la respuesta, la callback de `after()` no corre: `notifiedAt` queda `null` y `alertFailedAt` queda `null`. Pero `retryFailedCrisisAlerts` (alerts.ts) solo busca `alertFailedAt: { gte: cutoff }` — que EXCLUYE los `null`. Resultado: una crisis cuyo `after()` se perdió no es reintentada por nadie. El diseño cubre "el email falló" pero no "la notificación nunca se intentó". ADR-10 difiere queues durables al "primer incidente de alerta perdida", pero no hay mecanismo para DETECTAR ese incidente.
- Propuesta: cambiar el reconciliador del cron para que además barra `SafetyEvent{ category ∈ crisis/abuso, notifiedAt: null, alertFailedAt: null, createdAt ≥ cutoff }` = crisis sin notificar. Cierra el agujero sin queue durable y de paso te da la métrica "alertas perdidas" que ADR-10 usa como trigger.

### B2. La purga TTL *lazy* por-usuario quedó redundante con el cron de ADR-4 y suma un DELETE por mensaje [media / baja]
`scheduleTtlPurge` (notify.ts) dispara, diferido en CADA request de chat, `userMemory.deleteMany` + `interactionLog.deleteMany` para ese usuario. Ese lazy-purge PRECEDE al cron; ADR-4 agregó `/api/cron/purge` que ya barre global a diario. Además la lectura de `UserMemory` en `build-context.ts` ya filtra por `updatedAt >= cutoff`, así que la corrección no depende de la purga lazy. Hoy son dos deletes por mensaje que casi siempre borran 0 filas — puro I/O redundante que a 10x escala pesa.
- Propuesta: eliminar `scheduleTtlPurge` y su `defer` en `run.ts`; dejar la minimización al cron (ADR-4) + el filtro de lectura. Menos latencia diferida, menos carga DB, menos código.

---

## BLOQUE C — Consistencia multi-instancia (lo que ADR-3/ADR-6 dejaron a medias)

### C1. El rate-limiter PROPIO de la app sigue cayendo a memoria por-instancia sin Upstash — ADR-6 solo arregló better-auth [alta / media]
ADR-6 movió el rate-limit de *better-auth* a Postgres (tabla `RateLimit`) para que sea compartido sin Upstash. Pero el limitador propio de la app (`lib/rate-limit.ts`, usado por `validate.ts checkChatRateLimits` 15/min·400/día y por TODAS las rutas guardian) sigue degradando a `checkRateLimitMemory` (por instancia) cuando falta Upstash. En prod sin Upstash (estado actual del backlog), los topes de chat y de alta de menores son bypasseables abriendo requests contra varias instancias serverless. Es exactamente el agujero que ADR-6 cerró para auth, pero abierto para el endpoint más caro (LLM) y para la creación de cuentas de menores.
- Propuesta: dar al limitador propio un backend Postgres compartido (mismo patrón `incrementOne`/UPDATE atómico condicional que ADR-6, o un `upsert` sobre una tabla de contadores con ventana), con el in-memory solo como último fallback ante DB caída. Paridad real con ADR-6.

### C2. El circuit-breaker en memoria del router (ADR-3) será decorativo en serverless al activarse [media / media]
`provider.ts` implementa `processProviderHealth` como `Map` en memoria del proceso, igual que `openAiKeyInvalidAt` en `moderation.ts`. En serverless cada invocación puede caer en una instancia fría con el Map vacío: el "no-sano por 5 min" y el "re-probe OpenAI cada 6h" se resetean por instancia, así que en la práctica cada instancia reprueba un proveedor caído. Hoy es inofensivo (router sin activar, un solo proveedor), pero cuando entre el segundo proveedor / el modelo propio (Fase 3), el breaker no protegerá: seguirá martillando el proveedor caído desde instancias frías.
- Propuesta: documentar que activar el router exige estado de salud COMPARTIDO (Redis/Postgres) y dejar el `ProviderHealthStore` inyectable ya preparado para un backend distribuido (la interfaz ya existe — solo falta la impl compartida). Evita reescribir cuando se contrate el 2º proveedor.

---

## BLOQUE D — Testing (qué NO cubren las 37 suites)

### D1. El orquestador `run.ts` (630 líneas, todo el ruteo de seguridad) no tiene test de integración [alta / media]
Las suites cubren las piezas PURAS (`chat-precedence`, `context-budget`, `moderation` parsing, `guardrail-cascade`) pero NADIE testea el cableado de `runChatPipeline`: el orden real de las ~8 ramas, que `recordSafetyEvent`/`saveAssistant`/`defer(alert)`/`logInteraction` se llamen en la rama correcta, que una crisis por moderación-de-entrada gane sobre sesión-vencida con los efectos correctos. El "red" del refactor ADR-1 fueron esas suites de piezas — pero un swap de dos ramas en `run.ts` no rompería ninguna. Es el mayor gap de cobertura del gate.
- Propuesta: suite de integración de `runChatPipeline` con `prisma` fake + generador/moderación fake, que afirme, por cada `responsePath`, qué se persistió, qué `defer` se encoló y qué texto salió. Reusa el patrón inyectable que ya usa `retention.ts`/`alerts.ts`.

### D2. Cero cobertura HTTP de los route handlers (auth, CSRF, status codes) [media / media]
`chat/route.ts` y las rutas guardian tienen lógica de borde (sameOriginOk→403, requireSession→401, `retry-after`, `cache-control`) sin test a nivel Request→Response. La correctness de esos guards vive solo en revisión manual.
- Propuesta: tests de handler que inyecten un `Request` y afirmen status/headers de los caminos 400/401/403/429 (sin DB real).

---

## BLOQUE E — Mantenibilidad / DX (duplicación y límites difusos)

### E1. `run.ts` absorbió la complejidad: ~7 ramas repiten el mismo bloque de efectos [media / media]
ADR-1 dejó la route en <150 líneas (logro real) pero el orquestador quedó en 630 líneas donde cada camino de respuesta repite casi verbatim: `recordSafetyEvent(...)` → `saveAssistant({flag})` → `defer(() => alertGuardianSafely(...))` → `logInteraction(path, {...})` → `return fixedTextResponse(reply, headers)`. La DECISIÓN ya está centralizada (`decideResponsePath`/`decidePostGenPath`), pero los EFECTOS no.
- Propuesta: un helper `emitFixedResponse({ path, reply, flag, event?, alert?, logExtra })` que colapse el bloque duplicado; cada rama pasa a una línea declarativa. Baja la superficie donde un copy-paste introduce un desalineamiento entre lo que se persiste, se alerta y se loguea.

### E2. Boilerplate de ruta guardian repetido en 6 handlers [media / baja]
Cada ruta guardian repite `sameOriginOk→403` + `requireGuardian/requireSession` + `checkRateLimit` + parse-zod-body. Límite de módulo difuso: la política de acceso está copiada, no compartida.
- Propuesta: un wrapper `withGuardian(handler, { rateLimit, schema })` (o `withAuthedRoute`) que centralice CSRF+sesión+rate-limit+parse y pase al handler `{ user, body }`. Un solo lugar para cambiar la política.

### E3. No hay módulo de config/env validado: defaults y parseo defensivo dispersos [media / media]
El default `"deepseek-v4-flash"` aparece hardcodeado 8 veces; `parseJsonObjectEnv`, `ttlDaysFromEnv`, `generationTimeoutMs`, `assertProdEnv` (solo warn) están repartidos. `zod` ya se usa en 7 rutas pero NO para el env. No hay fail-fast en boot ante una env crítica malformada.
- Propuesta: un `lib/config.ts` con schema `zod` que valide/parsee TODO el env una vez al arranque, exponga defaults en un solo lugar y falle ruidoso ante lo crítico roto (DATABASE_URL, AI_*). Elimina la duplicación de defaults y el "parseo defensivo" ad-hoc de cada consumidor.

---

## BLOQUE F — Costo / performance / evolución

### F1. En prod sin key OpenAI, cada turno son 2 llamadas LLM de moderación extra — y el modelo de costos las cuenta como \$0 [alta / baja-media]
La cascada corre `openAiCheck` → `llmCheck`. Hoy la key OpenAI da 401 (documentado), así que TODO mensaje ejecuta el moderador LLM en ENTRADA (en paralelo con la generación) y en SALIDA (serial, sobre el texto ya generado). Son 2 llamadas `smallModel` (deepseek) por turno que la tabla de costos §6 lista como "Moderación OpenAI \$0". El costo real de moderación es ~2 generaciones small por turno, y la de salida además suma latencia serial (peor con respuestas guardian de 1400 tokens).
- Propuesta: priorizar el ítem de backlog "OPENAI_API_KEY real" NO como higiene sino como palanca #1 de costo+latencia (elimina 2 llamadas LLM/turno); y refrescar §6 del ARCHITECTURE con el costo real del moderador LLM mientras no haya key. Medir con `InteractionLog.moderation*Source` (A2) cuántos turnos caen al LLM.

### F2. El volumen de llamadas small-model (moderación×2 + rolling-summary + extracción + título) va a dominar a 10x [media / media]
Por turno, además de la generación principal, se disparan diferidos: `summarizeStaleConversation`, `updateRollingSummary`, extracción de memoria, y (nueva conv) título — todas `smallModel`. Sumadas a la moderación LLM, el conteo de llamadas al gateway por turno es 4–6×, no 1×. A escala eso, no la generación, es el cuello de costo/rate-limit del gateway.
- Propuesta: instrumentar (A2) el ratio llamadas-aux/turno; subir umbrales de `updateRollingSummary` (solo hilos realmente largos) y batch de extracción; evaluar un solo call combinado título+resumen. Medir antes de optimizar (la palanca #1 del propio doc).

### F3. La compuerta `reviewed` está modelada pero NO se aplica en el path de retrieval [media / baja]
`build-context.ts` hace `prisma.knowledgeCard.findMany()` SIN `where: { reviewed: true }`, y `selectRelevantCards` tampoco filtra (verificado). El ARCHITECTURE afirma "solo fichas revisadas entran al prompt en producción", pero como hoy todas están `reviewed:false`, filtrar apagaría el RAG — por eso no se filtra. El riesgo: cuando llegue la revisión clínica (backlog #6), alguien tiene que ACORDARSE de agregar el filtro, o quedarán fichas sin revisar en prompts de menores.
- Propuesta: aplicar `where: { reviewed: true }` detrás de un flag `RAG_REQUIRE_REVIEWED` (default false hoy, se flipea a true al completar la revisión) — así la compuerta ya está cableada y el switch es una env var, no un cambio de código a recordar.

### F4. El cliente `useChat` manda la conversación entera en cada request; el server descarta todo menos el último "user" [baja / baja]
`validate.ts` documenta que `useChat` retiene y envía todo el historial (capado a 100 server-side) aunque F1 solo usa el último mensaje. En conversaciones largas es ancho de banda y payload desperdiciado desde dispositivos móviles de menores.
- Propuesta: en `chat.tsx`, enviar solo `{ lastUserMessage, conversationId, clientMessageId }` (prepareSendMessagesRequest de useChat) en vez del array completo. El server ya está listo (ignora el resto).

---

## Resumen de prioridad

| # | Área | Impacto | Esfuerzo |
|---|---|---|---|
| A1 | Tracing/correlación + error-tracking | alta | media |
| A2 | Dashboard/alerting sobre InteractionLog | alta | media |
| B1 | Reconciliar crisis con `after()` perdido | alta | media |
| C1 | Rate-limiter propio compartido (paridad ADR-6) | alta | media |
| D1 | Test de integración de `runChatPipeline` | alta | media |
| F1 | Key OpenAI = -2 LLM/turno (costo+latencia) | alta | baja-media |
| B2 | Borrar purga lazy redundante | media | baja |
| A3 | Endpoint /api/health | media | baja |
| C2 | Health del router compartido (antes de activar) | media | media |
| D2 | Tests HTTP de handlers | media | media |
| E1 | Colapsar ramas duplicadas de `run.ts` | media | media |
| E2 | Wrapper `withGuardian` | media | baja |
| E3 | `lib/config.ts` con zod | media | media |
| F2 | Instrumentar/tunear llamadas small-model | media | media |
| F3 | Flag `reviewed:true` en retrieval | media | baja |
| F4 | Trim del payload de useChat | baja | baja |
