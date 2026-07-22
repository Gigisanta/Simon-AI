# Plan I+D — Modelo propio en español (laboratorio, borrador 2026-07)

> **v2 disponible (2026-07-22)**: [`plan-lab-maatwork-2026-07.md`](plan-lab-maatwork-2026-07.md) extiende este plan con la familia de modelos propios "Maat" (sub-500M, on-device/browser), fundamentado en el research de [`research-modelo-propio-2026-07.md`](research-modelo-propio-2026-07.md). Este v1 sigue siendo el compromiso externo del lab (clasificador + evaluación + dataset clínico); sus etapas 0–1 y su regla de gate binario quedan intactas y son la base del v2. La etapa 2 de este plan (destilación QLoRA sobre 7–9B) queda reemplazada en v2 por la estrategia de modelos ultra-pequeños.
> Especifica el laboratorio de USD 10.000 de `docs/propuesta-financiamiento-2026-07.md` §4.2 y el diferido de ADR-10: *"Clasificador de riesgo español propio como capa de ruteo: entregable del lab, no de esta rearquitectura"* (`docs/adr-rearquitectura-2026-07.md`).
> Fuente de contexto: `docs/research-briefing-gov-2026-07.md` §6 (staged roadmap, cloud vs local).
> Estado: BORRADOR — plan de trabajo, no compromiso de resultado. Sin humo: cifras y plazos son estimaciones con supuestos explícitos.

## 1. Qué es (y qué no es) este plan

**Es**: un plan para construir dos activos concretos, chicos y evaluables — un **clasificador de riesgo en español** y un **modelo generativo destilado** de bajo costo — que se conectan a la arquitectura ya existente sin reescribirla.

**No es**: un plan para reemplazar el proveedor comercial (DeepSeek V4 Flash u otro vía `resolveProvider`, ADR-3). Con USD 10.000 y una GPU de consumo no se supera un LLM de frontera en generación abierta. El objetivo es complementar: bajar costo y mejorar seguridad en español en el tráfico de bajo riesgo, no competir en calidad general.

## 2. Arquitectura híbrida objetivo

Dos piezas, con gobernanza y datos separados:

1. **Clasificador de riesgo en español** (capa de ruteo, ADR-2): modelo chico (encoder tipo BETO/RoBERTuito, ~100–350M parámetros), full fine-tune — no necesita QLoRA por su tamaño. Se enchufa como un `GuardrailCheck` más (`source: "classifier-es"`) en `runGuardrailCascade` (`src/lib/guardrails/cascade.ts`), en el lugar exacto que el código ya deja preparado: *"para enchufar un clasificador propio (research §4) se agrega UN `GuardrailCheck` más en el lugar que corresponda del array; la primitiva no cambia"*. Corre local (sin llamada de red), va antes o en paralelo del check LLM genérico actual — cheapest-first se mantiene.
2. **Modelo generativo destilado**: base abierta 7–9B (Qwen 2.5 7B-Instruct o Llama 3.1 8B-Instruct — buen soporte de español, licencia permisiva, cabe en 12GB en 4-bit), afinado con QLoRA sobre el dataset de `training-export.ts`. Se sirve local (Ollama/vLLM) y entra al sistema vía `resolveProvider("main")` (ADR-3) como un proveedor más en `AI_PROVIDERS`/`AI_FALLBACK_*`, con el proveedor comercial como fallback automático — el router ya soporta esto (`AI_BASE_URL` acepta cualquier endpoint compatible OpenAI, incluido `http://localhost:11434/v1`, ver `simon/.env.example`). Cero cambio de código en el pipeline de chat.

Contrato fail-closed sin cambios: si el clasificador propio no está disponible o timeoutea, el check devuelve no-concluyente y la cascada sigue con la siguiente capa — mismo contrato que hoy documenta `cascade.ts`.

## 3. Datos: dos datasets, dos gobernanzas

**3.1 Dataset de destilación conversacional** (para el modelo generativo): sale de `training-export.ts` (ADR-5), ya implementado y en gate. Excluye por diseño toda conversación que tocó `crisis`/`abuso`/`self-harm*`/`sexual/minors` (`BLOCKING_SAFETY_CATEGORIES`), corta en la primera señal de seguridad (`truncateAtFirstFlag`), y redacta PII estructural (`redactPII`: email, teléfono AR, DNI, dirección, credenciales en URL) antes de tocar el JSONL. El system prompt del dataset es la persona genérica (`TRAINING_SYSTEM_PROMPT = PERSONA`), sin `userName` ni memorias. Esta exclusión es una ventaja para este dataset (nunca hay ejemplos de crisis en los datos de "cómo conversar") pero implica que **no sirve para entrenar el clasificador de riesgo** — ese es el punto 3.2.

**3.2 Dataset de riesgo** (para el clasificador): tiene que incluir justamente lo que 3.1 excluye. No se arma reciclando transcripciones reales de crisis de usuarios — eso excede el consentimiento ya obtenido para "mejorar el servicio" y es dato sensible de menores bajo Ley 25.326. En cambio, sigue el método VERA-MH (`docs/research-briefing-gov-2026-07.md` §6): mayormente **datos sintéticos** (LLM en rol de persona con distintos niveles de riesgo declarado, generados y etiquetados por diseño) más un set chico revisado por psicólogos/UNCo (partnership ya prevista en la propuesta §4.2, punto 3) para calibrar contra casos reales sin exponer transcripciones de usuarios de Simón.

## 4. Etapas

| Etapa | Cuándo | Entregable | Costo |
|---|---|---|---|
| 0 — Harness de evaluación | Mes 0–1 | Adaptación VERA-MH al español rioplatense (agente-usuario + agente-juez sobre el LLM actual vía prompts). Prerequisito de todo lo demás: sin baseline no hay forma de medir si un checkpoint mejora o empeora. | USD 0 (usa el proveedor ya contratado) |
| 1 — Clasificador de riesgo v1 | Mes 1–3 | Encoder chico fine-tuneado en RTX 3060 sobre el dataset de 3.2, integrado como `GuardrailCheck` en `cascade.ts`, evaluado contra los fixtures de las suites `crisis`/`moderation`/`guardrail-cascade` ya existentes + un set ampliado en español rioplatense (modismos, jerga adolescente AR). | Horas de cómputo local + horas de revisión clínica (dentro del lab) |
| 2 — Destilación generativa | Mes 3–6 | QLoRA sobre base 7–9B con el dataset de 3.1, servido local, probado detrás del router (ADR-3) sin tocar producción. | Horas de cómputo local; escape hatch a GPU cloud (4090, ~USD 0,34–0,69/h) si la iteración en 3060 resulta muy lenta |
| 3 — Regresión de seguridad obligatoria | Mes 6–8 | El harness de la etapa 0 corre contra **cada checkpoint** del modelo destilado antes de considerar deploy. Ningún checkpoint pasa sin pasar el harness completo — el fine-tuning degrada seguridad incluso con datos benignos (`research-briefing-gov` §6), así que esto es gate, no formalidad. | Incluido en etapa 2 |
| 4 — Piloto acotado (condicional) | Mes 8+ | A/B del modelo destilado vs. el proveedor comercial, **solo** en turnos que el clasificador de la etapa 1 ya calificó de bajo riesgo. Fallback automático al proveedor comercial ante cualquier degradación (ADR-3). El modelo propio nunca atiende un turno de riesgo medio/alto en esta fase. | — |

## 5. Métricas de evaluación (seguridad primero)

- **Clasificador de riesgo**: recall en categorías crisis/self-harm por encima de un umbral alto declarado antes de integrar — se prioriza falso positivo sobre falso negativo (un FN es un chico en riesgo sin escalar). Objetivo mínimo: no peor que la capa regex actual en el fixture set (0 falsos negativos conocidos) antes de siquiera considerarse como reemplazo/complemento de una capa existente.
- **Modelo generativo destilado**: harness VERA-MH-ES de la etapa 0, corrido en paralelo contra el baseline comercial. No se promueve un checkpoint con peor tasa de "confirma ideación" o mayor tasa de "corta la conversación sin escalar" que el baseline. Calidad conversacional (tono rioplatense, coherencia, no-sicofancia) evaluada aparte, por rúbrica.
- **Regla dura para ambos**: ninguna métrica de costo o de calidad conversacional puede compensar una regresión de seguridad. Gate binario — pasa el harness o no se promueve. Mismo espíritu que el gate determinístico de 35+ suites que ya corre antes de cada deploy del producto.

## 6. Hardware y costos

- GPU base del plan: RTX 3060 12GB (ya disponible — no es gasto incremental de hardware). QLoRA en 4-bit sobre 7–9B cabe cómodo en 12GB con contexto 2048–4096, batch chico + gradient accumulation + gradient checkpointing; del orden de 1–3 días por época sobre el dataset de destilación (miles de ejemplos) — viable para iteración de bajo volumen, no para reentrenar a diario. El clasificador chico (etapa 1) entrena en horas, no días, por corrida — decenas de corridas son viables dentro del lab.
- Escape hatch declarado: GPU cloud (4090, USD 0,34–0,69/h) si el 3060 local resulta insuficiente para iterar a buen ritmo — no es el plan base, es contingencia.
- La línea de gasto real del lab (más allá del hardware ya poseído) es el partnership clínico: horas de psicólogos/UNCo para curar y revisar el dataset de riesgo (3.2) y calibrar el harness de la etapa 0 — presupuestado dentro de los USD 10.000 de `docs/propuesta-financiamiento-2026-07.md` §4.2.

## 7. Conexión explícita con la arquitectura ADR-2026-07

- **Clasificador → `runGuardrailCascade`** (`src/lib/guardrails/cascade.ts`): se agrega como un `GuardrailCheck` (`{source, run}`) en el array ordenado, cheapest-first. Local y sin red → más barato y más rápido que las capas actuales (OpenAI Moderation, check LLM). Mismo contrato de veredicto (`GuardrailVerdict`) y mismo fail-closed documentado: error o timeout nunca produce `available:true, flagged:false`.
- **Modelo destilado → `resolveProvider("main")`** (`src/lib/ai/provider.ts`, ADR-3): entra como una entrada más en `AI_PROVIDERS` (o el par `AI_*`/`AI_FALLBACK_*`), con el proveedor comercial vigente como fallback automático y el mismo health-tracking/circuit-breaker que ya existe. Cero cambio de código en el pipeline de chat (`chat-pipeline/`) ni en `chat-precedence.ts`.
- **Dataset → `training-export.ts`** (ADR-5): reutiliza tal cual la redacción PII y la exclusión de contenido de riesgo ya implementadas y en gate; el lab no reabre ese código, lo consume.

Este documento es la instancia concreta del diferido de ADR-10: el trigger para el clasificador es este mismo laboratorio; el trigger para promover el modelo generativo a tráfico real es evidencia del harness igualando o superando al baseline comercial en el tráfico de bajo riesgo de la etapa 4.

## 8. Riesgos y límites declarados

1. USD 10.000 + una GPU de consumo no alcanza para igualar la calidad de generación abierta de un LLM comercial de frontera — el modelo destilado es un complemento de bajo riesgo/bajo costo, no un reemplazo.
2. El clasificador de riesgo es el entregable de mayor valor y menor riesgo del lab: chico, rápido, auditable, en español real, y el más fácil de evaluar objetivamente contra fixtures ya existentes.
3. El recurso escaso es dato en español revisado por clínicos, no cómputo — el cronograma depende más del partnership con psicólogos/UNCo que de la GPU.
4. Ningún checkpoint entra a producción sin pasar el harness de seguridad completo — decisión de gobernanza, no solo técnica.
