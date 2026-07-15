# ADR — Rearquitectura Simón para producto oficial de gobierno (2026-07-15)

> Estado: ACEPTADO · Insumos: `docs/audit-arquitectura-2026-07.md` (arquitectura), auditoría de seguridad (task #3, hallazgos H1/M1/M2/M3/L1), auditoría de performance (task #4), QA en producción (task #5), `docs/research-briefing-gov-2026-07.md` (estado del arte + regulatorio).
> Contexto: Simón pasa de MVP financiado a **producto oficial del Gobierno del Neuquén con ambición nacional**. Eso cambia el estándar exigible: cumplimiento Ley 25.326 verificable, robustez de servicio público, escalabilidad 10k→100k MAU y costos de token controlados.

## Diagnóstico consolidado (qué NO se toca)

El dominio (`src/lib`) está sano: cero dependencias circulares, `chat-precedence.ts` como función pura testeada, rolling summary implementado con presupuesto por tokens, `SafetyEvent` sin contenido de mensaje, degradación Upstash→memoria con circuit-breaker, gate determinístico de 35 suites. **La rearquitectura es quirúrgica, no un rewrite.** Todo cambio mantiene el gate verde paso a paso.

## Decisiones

### ADR-1 — Pipeline de chat por stages explícitos [arch H1]
`src/app/api/chat/route.ts` (~1050 líneas, 187–1237) se descompone en stages puros y testeables bajo `src/lib/chat-pipeline/`:
`validate → crisisPrecheck (determinístico, bypass LLM) → guardrailIn → buildContext → generate → guardrailOut → persist → notify`.
La route queda como orquestador fino (<150 líneas). Cada stage recibe/devuelve un `PipelineCtx` inmutable tipado. La decisión de seguridad sigue delegada en `chat-precedence.ts` (sin cambios). Motivación extra: es el pre-requisito estructural del router multi-modelo y de la cascada de guardrails (research §4).

### ADR-2 — Cascada de guardrails generalizada [arch M4, research §4]
La cascada ad-hoc de `moderation.ts` se generaliza en `runGuardrailCascade(checks, input)`: lista ordenada cheapest-first (regex → clasificador → LLM), corta en el primer veredicto concluyente, **fail-closed** ante error/timeout, y emite `SafetyEvent` con `source` por capa. Los checks actuales se registran sin cambio de comportamiento (las suites `crisis`/`moderation` deben pasar idénticas).

### ADR-3 — Router de proveedores IA con fallback [arch H2]
`provider.ts` expone `resolveProvider(tier: "main" | "small")` con lista ordenada de proveedores por env (`AI_PROVIDERS` JSON o pares `AI_*`/`AI_FALLBACK_*`), retry con el mismo patrón de backoff de moderación, y health-tracking en memoria (circuit-breaker como el de Upstash). **Multi-modelo real (router por riesgo/costo) queda para cuando exista segundo proveedor contratado** — la interfaz lo deja listo; no se especula con configuración que hoy no existe.

### ADR-4 — Retención completa = cumplimiento Ley 25.326 [sec H1 + M2 — CRÍTICO]
`purgeExpiredData()` pasa a purgar **todo** dato vencido: `Message`/`Conversation` (TTL configurable, default 365 días) y `SafetyEvent` (TTL propio, default 2 años por su valor de auditoría, sin contenido). Se agrega suite `retention` extendida que fixturiza filas vencidas y verifica la purga de cada modelo. Es el hallazgo más grave de la auditoría de seguridad: retención indefinida de contenido sensible de menores es incumplimiento directo del principio de limitación de Ley 25.326 — inaceptable en un producto estatal.

### ADR-5 — Export de entrenamiento con redacción PII [sec M1]
`training-export.ts` incorpora paso de redacción previo al JSONL: regex determinísticas para PII estructural (emails, teléfonos AR, DNI, direcciones con altura, URLs con credenciales) + placeholder `[REDACTADO:<tipo>]`, y suite `training-export` extendida con fixtures. Redacción NER más fina queda para el lab (research §6) — se documenta el límite.

### ADR-6 — Upstash obligatorio en producción [arch H3]
`env-check` falla el build/boot en `VERCEL_ENV=production` si faltan `UPSTASH_REDIS_REST_URL/TOKEN`: rate-limit y secondary storage in-memory por instancia son inaceptables multi-instancia (bypass de rate limit real). En dev/preview la degradación sigue permitida.

### ADR-7 — Fuente única de recorte de historial [arch M1]
Se elimina el recorte por conteo; queda solo el presupuesto por tokens (`context-budget`). Un solo módulo decide qué entra al contexto.

### ADR-8 — `requireSession()` compartido [arch M5]
Helper único para las 8+ rutas con chequeo duplicado; devuelve 401 uniforme y tipa la sesión. Sin cambio de semántica.

### ADR-9 — Enumeración de usernames: riesgo aceptado y documentado [sec M3]
El precheck de duplicados en alta de menores queda (UX del tutor lo requiere); se documenta como riesgo aceptado con mitigación existente (rate limit + auth requerida) en ARCHITECTURE.md §seguridad.

### ADR-10 — Diferidos con trigger explícito (YAGNI declarado)
- **Queues durables para alertas** (Inngest/QStash/Vercel Queues GA): trigger = primer incidente de alerta perdida o >10k MAU. Hoy: alertas síncronas con retry existente.
- **Read replica Neon**: trigger = contención medible de reporting vs chat (~50k MAU).
- **Langfuse self-hosted + masking PII**: trigger = piloto provincial formal (requisito de auditabilidad gov). Se presupuesta en la propuesta.
- **Clasificador de riesgo español propio como capa de ruteo**: entregable del lab (propuesta §4.2), no de esta rearquitectura.
- **Migrar suites a framework estándar** [arch M2]: costo alto, beneficio marginal con 35 suites verdes; se re-evalúa si el equipo crece.

## Orden de implementación (task #7)

1. ✅ ADR-4 + ADR-5 (cumplimiento legal — primero y aislados; gate verde).
2. ✅ ADR-6 + ADR-8 (hardening barato; gate verde).
3. ✅ ADR-7 (unificación recorte; gate verde 35/35 · 1136 casos).
4. ✅ ADR-1 (descomposición pipeline — el refactor grande, sin cambio de comportamiento; las 35 suites son la red; gate verde 35/35 · 1136 casos).
5. ✅ ADR-2 (cascada generalizada `runGuardrailCascade` sobre el pipeline ya descompuesto; `moderate()` registra los checks OpenAI→LLM sin cambio de comportamiento — crisis/moderation idénticas; suite `guardrail-cascade` al gate; gate verde 36/36 · 1154 casos).
6. ✅ ADR-3 (router con fallback — `resolveProvider(tier, run, opts)` en `provider.ts`, parseo `AI_PROVIDERS`/`AI_*`+`AI_FALLBACK_*`, circuit-breaker en memoria, sin activar en ningún call site — comportamiento hoy idéntico; suite `provider-router` nueva al gate; gate verde 37/37 · 1197 casos).
7. Actualización de docs (README/ARCHITECTURE/AGENTS) + suites nuevas al gate → deploy (#9).

## Consecuencias

- (+) Cumplimiento Ley 25.326 demostrable ante AAIP/provincia; historia "seguro por construcción" verificable capa por capa.
- (+) Desbloquea router multi-modelo y guardrails por capas sin reescritura futura.
- (+) Cada paso deja el gate verde — deployable en todo momento.
- (−) ~2–3 días de trabajo de refactor sin feature visible para el usuario final.
- (−) ADR-6 endurece el deploy: producción exige Upstash provisionado (documentado en README).
