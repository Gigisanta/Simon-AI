# Simón AI — Activos de datos de entrenamiento y diseño del data flywheel

> Análisis read-only del repo `/Users/prueba/HerMaatOS/repos/Simon-AI/simon` (+ `docs/` en el nivel padre).
> Rol: ML engineer senior. Fecha: 2026-07-22.
> Fuentes leídas de verdad: `src/lib/training-export.ts`, `scripts/export-training.ts`, `scripts/conversation-eval.ts`, `scripts/crisis-suite.ts` + `moderation-suite.ts`, `src/lib/safety.ts`, `prisma/schema.prisma`, `src/lib/ai/system-prompt.ts` (persona), `prisma/knowledge-data.ts`, `src/lib/consent.ts`, `docs/ARCHITECTURE.md §3`, `docs/plan-id-modelo-propio.md`.

---

## 0. TL;DR

El repo YA tiene el esqueleto de un data flywheel bien pensado: un exportador puro y testeado (`training-export.ts`) que produce JSONL chat-completions redactado, telemetría por request (`InteractionLog`), y dos activos de eval de calidad distinta (fixtures determinísticos T1–T7 + harness conversacional con juez LLM). Es un punto de partida honesto y por encima de la media para un producto de este tamaño.

Pero como **fábrica de datos de entrenamiento tiene tres agujeros estructurales**:

1. **No hay ninguna señal de calidad/feedback real.** El único proxy de calidad es la longitud de la charla (`qualityTier` por nº de pares). No existe modelo `Feedback`/`Rating` en el schema (confirmado por grep). `InteractionLog` tiene telemetría rica pero el export **ni la mira**.
2. **El "opt-in separado del tutor para entrenar" está documentado pero NO existe en el código.** `Guardian` sólo tiene `consentAt` (consentimiento de *acceso al chat*). No hay `trainingConsentAt`. `export-training.ts` exporta TODA conversación no-crisis sin chequear ningún flag de consentimiento de entrenamiento → **hoy el exportador viola su propia regla de `ARCHITECTURE.md §3`.**
3. **No hay versionado, linaje ni curación del dataset.** El export escribe un JSONL plano a un path; sin hash de contenido, sin dataset card, sin dedup, sin cola de revisión humana, sin forma de propagar una revocación de consentimiento a un dataset ya emitido.

El resto del documento detalla cada punto.

---

## 1. ¿Qué produce hoy `training-export.ts` exactamente?

### 1.1 Formato de salida

Dos archivos (I/O en `scripts/export-training.ts`, lógica pura en `src/lib/training-export.ts`):

- **`<out>.jsonl`** — una línea por conversación que califica, formato chat-completions:
  ```json
  {"messages":[{"role":"system","content":"<PERSONA genérica>"},{"role":"user","content":"..."},{"role":"assistant","content":"..."}, ...]}
  ```
- **`<out>.meta.jsonl`** — sidecar, una línea por ejemplo:
  ```json
  {"conversationId":"...","turnCount":N,"createdAtMonth":"YYYY-MM","qualityTier":"high|medium"}
  ```

El `system` es SIEMPRE la persona canónica (`TRAINING_SYSTEM_PROMPT = PERSONA`), sin `userName`, sin memorias, sin fichas, sin addendum etario/guardian. Es decir: **el dataset entrena "cómo conversa Simón base", no el comportamiento contextualizado real** (registro por edad, RAG de fichas, memoria) que sí ocurre en producción. Decisión de minimización correcta, pero implica que el modelo destilado no aprende de los contextos que en prod cambian la respuesta.

### 1.2 Filtros y transformaciones (pipeline puro, testeado en `training-export-suite.ts`)

Orden exacto en `buildTrainingExample`:

1. **Exclusión de conversación completa** si algún `SafetyEvent.category` ∈ `BLOCKING_SAFETY_CATEGORIES` = `{crisis, abuso, self-harm, self-harm/intent, self-harm/instructions, sexual/minors}`.
2. Filtra a sólo roles `user`/`assistant`.
3. `truncateAtFirstFlag`: corta en el PRIMER `Message.safetyFlag != null` (exclusivo) → nunca entra la plantilla de crisis ni la sustitución de moderación.
4. `dropLeadingNonUser` → el ejemplo abre en `user`.
5. `trimToLastAssistant` → cierra en `assistant`.
6. Rechaza si `countPairs < max(MIN_PAIRS_FLOOR=3, --min-turns)`.
7. `redactPII` sobre CADA `content` (ADR-5): email, teléfono AR, DNI (con/sin keyword), dirección con altura, credenciales en URL → `[REDACTADO:<tipo>]`. Regex, no NER — sesgo a sobre-redactar (documentado). **No detecta nombres propios en texto libre.**
8. `qualityTier`: `pairs >= 6 → "high"`, si no `"medium"`. Puramente por longitud.

Flags CLI: `--out`, `--min-turns`, `--role child|guardian|all`.

### 1.3 Volumen esperable con 30k mensajes/mes (estimación con supuestos explícitos)

Sin humo — es una estimación, no una medición (la DB de prod no se consultó):

- 30k mensajes/mes ≈ 15k `user` + 15k `assistant` (pares 1:1 aproximado).
- Supuesto de forma de charla: media ~8 mensajes/conversación (4 pares) → **~3.750 conversaciones/mes**. Muchos productos de chat tienen una cola larga de conversaciones de 1–2 turnos; asumo ~40% con <3 pares.
- Descuentos en cascada:
  - `< MIN_PAIRS_FLOOR (3 pares)` → −~40% de conversaciones.
  - Exclusión crisis/abuso (`BLOCKING_SAFETY_CATEGORIES`) → −~3–8% (baja frecuencia pero real en este dominio).
  - `truncateAtFirstFlag` recorta la cola de otro ~10–15% de charlas (no las elimina, las acorta; algunas caen bajo el piso tras el corte).
- **Yield estimado: ~1.500–2.200 ejemplos/mes → ~18k–26k ejemplos/año.**

Interpretación: es **suficiente para QLoRA de destilación sobre una base 7–9B** (el `plan-id-modelo-propio.md §6` habla de "miles de ejemplos", 1–3 días/época en RTX 3060) pero **muy chico para pre-entrenar nada** y chico incluso para un fine-tune conversacional robusto si además se quiere diversidad. El volumen crece linealmente con adopción; el cuello no es cantidad sino **diversidad y calibración de calidad** (sección 2).

---

## 2. ¿Qué datos FALTAN para entrenar un modelo conversacional propio?

### 2.1 Señal de calidad — el agujero #1
- **No hay feedback de usuario de ningún tipo.** Grep sobre `src/` + `prisma/` no encuentra ningún modelo `Feedback/Rating/Reaction/Vote`. No hay 👍/👎, ni "esta respuesta ayudó", ni edición/regeneración registrada como señal.
- El **único** proxy de calidad que llega al dataset es `qualityTier` = longitud de la charla. Una charla larga puede ser larga porque el modelo respondió MAL y el chico insistió (señal invertida). La heurística puede estar entrenando sesgo hacia la verbosidad.
- **`InteractionLog` tiene telemetría rica y el export la ignora.** Tiene `responsePath`, `moderation*Flagged`, latencias, tokens, `roleAtRequest` — pero `export-training.ts` sólo lee `Conversation`/`Message`/`SafetyEvent`. Hay señal de calidad implícita sin explotar (p.ej. excluir/degradar ejemplos cuyo `responsePath != "normal"`, o pesar por `moderationOutputFlagged`).
- **`MoodEntry` (diario de ánimo, valencia 1–3) está totalmente sin usar como señal de outcome.** Un delta de ánimo positivo entre `session_start` y `session_close` es el proxy de resultado más honesto que tiene el producto y no toca el dataset.

### 2.2 Diversidad y cobertura de temas
- **No hay ninguna metadata de tema/tópico** en el ejemplo ni en el sidecar. Sólo `role`, `turnCount`, `mes`, `tier`. Imposible balancear el dataset por tema, detectar sobre-representación (p.ej. 80% saludos/aburrimiento) o garantizar cobertura de los dominios que el producto promete (discapacidad, trámites/CUD, escuela, emociones cotidianas).
- El corpus de conocimiento (`knowledge-data.ts`) cubre 15 condiciones + 3 trámites, pero eso es **RAG, no datos conversacionales**: no hay garantía de que las charlas reales cubran esos temas ni de que las respuestas del modelo maestro sobre ellos sean correctas (fichas `reviewed:false`).

### 2.3 Multi-turn largo
- El piso es 3 pares y `high` arranca en 6. No hay categoría ni sobre-muestreo de **conversaciones largas coherentes** (12+ turnos) — que son exactamente las que enseñan mantenimiento de contexto, continuidad y no-repetición.
- El **contexto real** que en prod hace coherente un turno largo (rolling summary, memorias, resúmenes previos) **se elimina del ejemplo**. El modelo ve un multi-turn "pelado" sin el andamiaje que en producción lo sostiene → puede aprender a fabricar continuidad que no tiene soporte.

### 2.4 Voseo / rioplatense
- **Cero verificación de dialecto en el export.** El voseo depende (a) de que la PERSONA lo pida y (b) de que el proveedor maestro (DeepSeek V4 Flash u otro vía `resolveProvider`) efectivamente lo produzca. Si el maestro a veces tutea o mete neutro, ese ruido entra al dataset sin filtro.
- No hay un check de "assistant en voseo" (heurística `tenés/querés/vos` vs `tienes/quieres/tú`) que descarte o marque ejemplos fuera de registro. Para un modelo cuyo diferencial ES el español rioplatense, esto debería ser un filtro de curación de primera clase.

### 2.5 Datos de preferencia / negativos
- El dataset es 100% SFT (imitación del maestro). **No hay datos de preferencia** (par elegido/rechazado) para DPO/RLHF, porque no hay feedback. Sin esto no se puede corregir sicofancia, verbosidad ni deriva de tono más allá de lo que ya hace el maestro.
- **Es destilación de un maestro comercial:** hereda sus errores y su estilo. No hay corrección humana en el loop (human-in-the-loop) que meta ejemplos "gold".

### 2.6 Crisis (exclusión deliberada — correcta, pero anotar)
- El dataset generativo NUNCA ve manejo de crisis (excluido por diseño). Es lo correcto para el modelo generativo (las crisis van por plantilla fija + clasificador, `plan §3.2`), pero significa que el modelo propio **no debe jamás ser la última red en un turno de riesgo** — lo cual el plan ya respeta (etapa 4: sólo tráfico de bajo riesgo, fallback comercial). Debe quedar escrito en el dataset card.

### 2.7 Ruido estructural a limpiar
- El `DISCLOSURE_TEXT` (recordatorio "soy una IA" cada 10 turnos) se agrega determinísticamente en `route.ts` a la respuesta. Si eso quedó persistido en `Message.content`, el modelo aprende a emitir disclosures pegados al final de respuestas cada ~10 turnos — señal parásita. Hay que verificar si el texto append-eado se guarda y, si sí, limpiarlo en curación (no lo hace `truncateAtFirstFlag` porque el disclosure no es un `safetyFlag`).

---

## 3. ¿Los fixtures de las suites sirven como set de evaluación de regresión de checkpoints?

**Sí, y son el activo de eval más maduro del repo — pero cada suite sirve para una cosa distinta.**

### 3.1 Para el CLASIFICADOR de riesgo (`plan §ETAPA 1`): excelente, casi listo
- `crisis-suite.ts`: ~90 casos ETIQUETADOS contra taxonomía T1–T7 + negativos-trampa (peluquería, modismos, "me toca=turno", pegar=adherir) + evasión leetspeak/letras sueltas. Determinístico, **sale con exit 1** → ya es gate de CI.
- `moderation-suite.ts`: mapeo categoría Moderation API → `SafetyFlag` con precedencia (crisis>abuso>riesgo), incl. variantes no listadas y case-sensitivity.
- `guardrail-cascade-suite.ts`: contrato fail-closed de la cascada.
- Estos son un **test set balanceado con labels de oro** para el encoder chico. El propio plan lo dice (etapa 1: "evaluado contra los fixtures de las suites crisis/moderation/guardrail-cascade"). Único gap: son ~90 casos y hay que ampliarlos a español rioplatense real (jerga adolescente AR, modismos regionales) para que el recall sea medible — el plan lo prevé.

### 3.2 Para el modelo GENERATIVO: `conversation-eval.ts` es exactamente la forma correcta, pero es preliminar
- 30 escenarios (warmth, boundary, jailbreak, leak, content, dependency, distress, injection vía memoria/ficha, registro por edad, sesgo capacitista, crisis velada, sobre-derivación, robustez) × juez LLM con rúbrica de 7 dimensiones (warmth 1–5, boundary_ok, safety_ok, leaked_prompt, romantic_or_dependency, over_referral, followed_expectation).
- **Model-aware**: registra `AI_MODEL`/`baseURL` en el reporte → comparás checkpoints directamente. Tiene `--repeat=N` para cazar fallos intermitentes (varianza de calidez, fallo en 1/N). Corre el system prompt REAL vía `buildSystemPrompt` + addendum de riesgo, igual que prod.
- Es **la plantilla natural del eval de cada checkpoint** del modelo destilado (plan etapa 3: "corre contra cada checkpoint antes de deploy").
- **Limitaciones a cerrar antes de usarlo como gate:**
  - Es exploratorio: **NO sale con exit 1** (a propósito; el gate son las suites tsx). Para ser gate de checkpoint hay que definir umbrales duros (0 safety✗, 0 leak, avgWarmth ≥ X) y hacerlo fallar.
  - 30 escenarios es poco para cubrir la matriz de riesgo → el plan etapa 0 lo reemplaza/expande con VERA-MH-ES.
  - **Juez de la misma familia que el generador** (riesgo de sesgo/colusión); conviene juez de familia distinta o panel.
  - Escenarios y expectativas mezclan metalenguaje (comentarios en español pero algún término en inglés); consistencia de rúbrica revisable.
- Complementariedad clave: las suites de crisis testean el CLASIFICADOR (esos turnos bypassean el LLM en prod); `conversation-eval` tiene escenarios `indirect-crisis` y `over-referral` que testean la CONTENCIÓN GENERATIVA (la red cuando ni regex ni moderación agarran). Entre ambos cubren la costura.

**Veredicto:** fixtures deterministas = gate del clasificador ✅ ya. `conversation-eval` = gate del generativo 🟡 con trabajo (umbrales + expansión + juez independiente).

---

## 4. Diseño del data flywheel + gaps concretos en el código actual

```
[Producción]  chat real (Message, Conversation, SafetyEvent, InteractionLog, MoodEntry)
     │
     │  (1) CAPTURA DE SEÑAL  ← GAP: no hay feedback ni rating; MoodEntry/InteractionLog sin explotar
     ▼
[Export redactado]  training-export.ts → JSONL + meta.jsonl
     │  (2) CONSENTIMIENTO  ← GAP CRÍTICO: no filtra por opt-in de entrenamiento (no existe el campo)
     │  redactPII (regex, no NER) · exclusión crisis · corte en flag
     ▼
[Curación]  ← GAP: NO EXISTE. no dedup, no near-dup, no filtro de voseo, no NER de nombres,
     │            no cola de revisión humana, no limpieza de DISCLOSURE_TEXT, no balanceo por tema
     ▼
[Dataset versionado]  ← GAP: no hay hash/versión/dataset-card/linaje; JSONL plano a un path
     ▼
[Entrenamiento]  QLoRA 7–9B (plan) / encoder de riesgo
     ▼
[Eval]  crisis/moderation suites (clasificador ✅) · conversation-eval (generativo 🟡, no es gate aún)
     │  (3) GATE DE SEGURIDAD  ← GAP: conversation-eval no sale con exit 1; sin umbrales duros
     ▼
[Deploy]  resolveProvider("main") (ADR-3) · GuardrailCheck classifier-es (cascade.ts) — enganches YA listos
     │
     ▼
[Más producción]  → vuelve al inicio (con el nuevo modelo generando datos)
```

### 4.1 Gaps concretos por etapa (con ubicación en el código)

| # | Etapa | Gap | Dónde | Fix mínimo |
|---|---|---|---|---|
| G1 | Captura | Sin feedback/rating de respuestas | `prisma/schema.prisma` (no existe modelo) | Agregar `MessageFeedback {messageId, value:+1/-1, reason?}` + UI de 👍/👎 en el turno del asistente |
| G2 | Captura | Señales implícitas de calidad sin usar | `InteractionLog` existe; `export-training.ts` no lo lee. `MoodEntry` sin uso | Join en el export: excluir/pesar por `responsePath`, `moderationOutputFlagged`; usar delta de `MoodEntry` como score de conversación |
| G3 | Consentimiento | **No hay opt-in de entrenamiento separado**; el export ignora consentimiento | `Guardian` sólo tiene `consentAt` (acceso al chat); `export-training.ts` no filtra | Agregar `Guardian.trainingConsentAt DateTime?` + `WHERE user.guardedBy.trainingConsentAt != null` en el query del export. **Es el fix de compliance más urgente** (ver §5) |
| G4 | Curación | Etapa inexistente | — | Pipeline de curación: dedup exacto+near-dup (minhash), filtro de voseo (heurística tenés/vos), pasada NER opcional para nombres (redactPII es regex), limpieza de `DISCLOSURE_TEXT`, cola de revisión humana muestreada |
| G5 | Versionado | Sin linaje ni dataset card | `scripts/export-training.ts` escribe JSONL plano | Emitir `dataset-card.json`: hash de contenido, versión, nº ejemplos por tier/rol/mes, rango de fechas, git SHA del código de export, config de filtros, y **lista de conversationIds incluidos** (para poder purgar por revocación, ver G7) |
| G6 | Eval gate | `conversation-eval` no es gate | `scripts/conversation-eval.ts` (comentario "No exit(1) automático: es exploratorio") | Envolver en un runner con umbrales duros (0 safety✗/leak, avgWarmth ≥ N) que salga con exit 1 para checkpoints — plan etapa 3 |
| G7 | Ciclo/derechos | Revocación de consentimiento no se propaga a datasets ya emitidos | `Guardian.consentRevokedAt` existe para el chat, pero el dataset es inmutable una vez escrito | El dataset card (G5) con conversationIds permite re-emitir excluyendo revocados; documentar política de re-entrenamiento tras revocación (derecho de oposición, Ley 25.326) |
| G8 | Cobertura | Sin metadata de tema | sidecar `meta` sólo tiene turnCount/mes/tier | Agregar tópico (clasificación barata) al sidecar para balancear y medir cobertura |

### 4.2 Lo que YA está bien resuelto (no tocar)
- Enganches de deploy listos sin cambiar el pipeline: `resolveProvider("main")` acepta cualquier endpoint OpenAI-compatible (incl. Ollama local) con health-tracking/fallback (ADR-3); la cascada de guardrails deja un slot exacto para un `GuardrailCheck` `classifier-es` (ADR-2). El flywheel no requiere reescribir el chat.
- La lógica pura de export está separada del I/O y **testeada al 100% de ramas** (`training-export-suite.ts`), camino crítico bien tratado.
- Exclusión de crisis + corte en flag + redacción PII antes de tocar disco: el orden es correcto y auditable.

---

## 5. Restricciones legales ya documentadas (y dónde el código NO las cumple todavía)

De `docs/ARCHITECTURE.md §3` ("Reglas de datos — no negociables, camino crítico"):

1. **Conversaciones = datos sensibles de salud de menores** (Ley 25.326 art. 2): cifrado at-rest (Neon), TLS, **retención ≤ 12 meses**, borrado a pedido (`DELETE` cascade). → Parcialmente en código: `retention.ts` purga `InteractionLog` a 180d y `UserMemory` a 90d; conversaciones/mensajes se purgan por cascade de `User` (no por TTL propio de 12 meses — verificar que exista un barrido de conversaciones a 12 meses o documentarlo).
2. **Minimización**: sin domicilio, sin documento, sin fecha exacta de nacimiento (`User.birthYear` sólo año), sin PII en `UserMemory` (el prompt de extracción lo prohíbe). → En código: ✅ (`birthYear Int?`, comentarios en schema).
3. **"Nada de datos de menores para entrenar modelos sin opt-in separado del tutor."** → **DOCUMENTADO PERO NO IMPLEMENTADO.** Es el hallazgo legal más importante:
   - `Guardian` tiene UN solo `consentAt`, que es consentimiento de **acceso al chat** (`consent.ts`: `canChat`). No existe `trainingConsentAt` ni ningún flag de propósito "entrenamiento".
   - `export-training.ts` exporta TODA conversación no-crisis con ≥3 pares, **sin chequear ningún consentimiento**. El único filtro por rol es `--role child|guardian|all`, que no es consentimiento.
   - El propio `plan-id-modelo-propio.md §3.2` reconoce que reutilizar transcripciones "excede el consentimiento ya obtenido para 'mejorar el servicio'" — para el dataset de RIESGO. Pero la misma lógica aplica al dataset de destilación (§3.1): usa transcripciones reales de menores sin el opt-in separado que el §3 exige.
   - **Conclusión:** hoy correr `pnpm export-training` sobre la DB de prod produciría un dataset que incumple la regla documentada. El fix G3 (§4.1) es prerequisito legal, no una mejora.

Salvaguardas que SÍ existen y refuerzan el cumplimiento cuando G3 se implemente:
- `redactPII` (ADR-5): redacción estructural de PII antes del JSONL (limitación conocida: regex ≠ NER, no captura nombres propios → G4 debería sumar NER).
- `BLOCKING_SAFETY_CATEGORIES` + `truncateAtFirstFlag`: el material de crisis/abuso de menores nunca entra al dataset generativo.
- `consentRevokedAt` (derecho de oposición): existe para el chat; falta propagarlo a datasets emitidos (G7).
- System prompt genérico en el dataset (sin `userName`/memorias): anonimización a nivel de contexto.

---

## 6. Prioridad de acción (para el laboratorio)

1. **[Compliance, bloqueante] G3** — `Guardian.trainingConsentAt` + filtro en el export. Sin esto no se puede tocar la DB de prod para entrenar. Barato (1 columna + 1 `WHERE` + UI de opt-in en el panel del tutor).
2. **[Calidad, alto impacto] G1+G2** — capturar feedback explícito (👍/👎) y explotar `InteractionLog`/`MoodEntry`. Sin señal de calidad, la destilación sólo puede imitar al maestro; con señal, habilita DPO/curación por outcome.
3. **[Trazabilidad] G5+G7** — dataset card con hash/versión/conversationIds. Prerequisito de reproducibilidad de checkpoints y de honrar revocaciones.
4. **[Gate] G6** — volver `conversation-eval` un gate de checkpoint con umbrales duros (plan etapa 3). Los fixtures de crisis/moderation ya son gate del clasificador.
5. **[Curación] G4+G8** — dedup, filtro de voseo, NER de nombres, limpieza de disclosure, metadata de tema. Escala con el volumen; empezar por voseo y dedup.

El clasificador de riesgo (plan etapa 1) es el entregable de mayor valor/menor riesgo y su eval ya está casi resuelto por los fixtures existentes: es el lugar correcto para empezar el flywheel.
