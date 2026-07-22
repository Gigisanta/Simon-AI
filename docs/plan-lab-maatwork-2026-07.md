# Plan — Laboratorio MaatWork de modelos propios (v2, 2026-07)

> Estado: PLAN APROBADO INTERNO (borrador para ejecución) · Extiende [`plan-id-modelo-propio.md`](plan-id-modelo-propio.md) (v1, compromiso externo del lab de USD 10.000) sin contradecirlo: v1 promete clasificador + evaluación + dataset clínico; este v2 agrega la ambición interna — una **familia de modelos conversacionales propios "Maat"** que reemplace al proveedor comercial por etapas condicionales a evidencia. Todo fundamentado en [`research-modelo-propio-2026-07.md`](research-modelo-propio-2026-07.md) (27 agentes, 68 claims verificados).
> Regla de oro heredada de v1, intacta: **ninguna métrica de costo o calidad puede compensar una regresión de seguridad. Gate binario por checkpoint.**

## 1. Por qué (el caso, honesto)

- **No es ahorro**: DeepSeek cuesta ~USD 7/mes hoy. Es: (a) **soberanía** — datos de menores argentinos procesados por modelo propio auditable, argumento central de la propuesta de financiamiento §4.2; (b) **riesgo de continuidad** — OpenCode Go es un gateway para coding agents sin SLA, indefendible como proveedor primario de un servicio estatal para menores; (c) **offline/edge** — conectividad argentina real: un modelo en el dispositivo funciona en la escuela rural sin señal; (d) **innovación con nicho vacío verificado** — no existe modelo español-first sub-1B, ni dataset conversacional rioplatense, ni eval de seguridad infantil en español, ni lab argentino de LLM. Ser primeros es diferenciación y es publicable.
- **Escalera de desriesgo**: cada etapa entrega valor por sí sola y ninguna apuesta el producto. El proveedor comercial queda siempre como fallback automático (`resolveProvider`, ADR-3, ya implementado y testeado).

## 2. La familia Maat (objetivo de producto)

| Modelo | Tamaño | Target | RAM (int4) | Rol |
|---|---|---|---|---|
| **maat-nano** | ~150M | Browser WASM puro, Android 2–3GB | ~150–200MB | Fallback universal ultra-liviano |
| **maat-micro** | ~250M | Browser WebGPU, Android 3–4GB | ~250–350MB | **El modelo principal on-device** (sweet-spot calidad/RAM) |
| **maat-mini** | ~400M | Desktop, Android ≥4GB, server CPU | ~400–550MB | Techo de calidad on-device |
| **maat-guard** | ~100–400M (encoder) | Junto a cualquier maat-* | ~100–400MB | Clasificador de riesgo T1–T7 + gate de salida local (es el "clasificador" de v1 etapa 1, extendido) |
| **maat-1b** (condicional) | ~1B | Server propio (VPS/GPU) | — | Solo si el micro/mini no alcanzan la calidad conversacional; sirve vía endpoint OpenAI-compatible |

Arquitectura (evidencia en research §4): deep-narrow (30–36 capas), GQA 3:1/4:1, sliding-window 5:1 (ventana 1024) + RoPE dual 10k/1M + QK-norm, sink token, embedding tying, **tokenizer propio español-AR 32–48k**, QAT int4 integrado (embedding int8). Configs declarativas en [`lab/configs/`](../lab/configs/). Track experimental paralelo: híbrido conv/SSM (LFM2-like) y piloto BitNet ternario — se deciden por benchmark de calidad-por-RAM, nunca por moda.

## 3. Etapas (cada una con gate objetivo y salida de emergencia)

### Etapa 0 — Fundaciones (mes 0–2) · el harness manda
- **E0.1 Harness de evaluación** (prerequisito de TODO): SpanishBench (lm-eval-harness) + TELEIA + M-IFEval como base adoptada; VERA-MH-ES (adaptación rioplatense, ya prevista en v1 etapa 0); rúbrica de voseo (regex de conjugación + LLM-judge de familia distinta, validado con muestreo humano); fixtures de crisis T1–T7 del repo versionados como dataset de oro. Convertir `conversation-eval.ts` en gate real (umbrales duros + exit 1 — gap G6).
- **E0.2 Compliance del flywheel** (bloqueante legal, gap G3): `Guardian.trainingConsentAt` + filtro en `export-training.ts` + UI de opt-in en el panel del tutor + dataset card con linaje (G5/G7). Sin esto no se toca la DB de prod para entrenar.
- **E0.3 Lab operativo**: org privada HF `maatwork-lab`, trackio, B2, estructura [`lab/`](../lab/README.md).
- **Gate**: harness corre contra DeepSeek (baseline documentado) y contra 3 bases candidatas crudas (Qwen3-0.6B, SmolLM2-360M, Granite 4.0 Nano 350M) en español. Números en la mesa.

### Etapa 1 — Dataset rioplatense v1 (mes 1–3, solapa con E0)
- Generación sintética persona-driven (Magpie/PersonaHub): personas sintéticas de chicos/adolescentes AR (edad, contexto emocional, discapacidad — sin datos reales) × persona Simón. Dialecto rioplatense explícito. Profesor: DeepSeek u otro LLM grande, offline.
- Curación: filtro de voseo (heurística tenés/vos vs tienes/tú), dedup + near-dup, la misma cascada de moderación de prod como filtro de dataset, decontaminación n-gram 8–13 contra el harness, limpieza de `DISCLOSURE_TEXT`.
- Mezcla de seguridad **obligatoria en cada batch** (rechazos cálidos, derivación a adulto/102, proporcionalidad) — mitigación #1 de la degradación de alignment.
- Volumen objetivo v1: 100k–300k turnos (~cientos de USD de generación).
- **Gate**: muestreo humano rioplatense aprueba tono/voseo; 0 ejemplos que insinúen rol terapéutico o manejen crisis (eso va por plantilla, no por modelo).

### Etapa 2 — Destilación sobre base abierta (mes 2–5) · primer modelo propio en shadow
- Bake-off de bases (Qwen3-0.6B vs SmolLM2-360M vs Granite 350M vs LFM2-350M si la licencia cierra) con SFT corto + harness. Elegir UNA.
- **On-policy distillation** (TRL `DistillationTrainer`, teacher server externo, `lmbda` progresivo 0.5→1.0) + SFT curricular. Full fine-tune en la 3060 (paged_adamw_8bit + gradient checkpointing); corridas grandes en spot (~USD 5–20 c/u).
- La PERSONA se hornea en los pesos (adiós system prompt confidencial de 2.7k tokens). El registro etario (A1/A2/B1) se entrena como instrucción corta, no como prompt gigante.
- Servir vía llama.cpp/vLLM en VPS o Modal, endpoint OpenAI-compatible, **detrás de `resolveProvider` con DeepSeek de fallback** — los 6 supuestos ocultos del swap (research §6) se resuelven acá: dummy key, AI_EXTRA_BODY vacío, `LLM_TIMEOUT_MS` a env, re-tuning de `CONTEXT_BUDGETS` al tokenizer real.
- **Shadow mode primero**: el modelo propio genera en paralelo sin servir a usuarios; se comparan salidas con el harness. Después A/B solo en turnos que maat-guard clasifica de bajo riesgo (= v1 etapa 4).
- **Gate**: VERA-MH-ES + crisis fixtures al 100% (igual o mejor que baseline DeepSeek), voseo ≥ umbral declarado, SpanishBench sin regresión vs base cruda, gate de 37 suites del producto verde con el modelo detrás del router.

### Etapa 3 — Tokenizer + pretraining propio (mes 4–9) · la innovación de fondo
- **Tokenizer rioplatense** 32–48k (SentencePiece/BPE sobre FineWeb2-es filtrado AR + corpus sintético propio): medir fertilidad vs tokenizers de Qwen/Gemma/Salamandra en texto AR — publicable por sí solo.
- Prototipo toy en la 3060 (litgpt/nanochat fork, 10–50M params) para validar pipeline de datos + tokenizer + config.
- **Pretraining maat-micro (~250M)** en cloud spot: régimen overtrained estilo SmolLM2 (100B–400B tokens según presupuesto; FineWeb2-es + HPLT + sintético + code/inglés minoritario para robustez), QAT int4 en los últimos ~5k pasos. Estimado: USD 1.500–4.000 en H100/A100 spot — dentro del presupuesto.
- Post-training del checkpoint propio con el dataset de Etapa 1 + destilación (Etapa 2 recipe, ya validado).
- **Gate**: maat-micro propio ≥ base abierta destilada de Etapa 2 en el harness completo. Si no llega: la Etapa 2 sigue siendo el producto y esto sigue siendo I+D — sin drama, quedó el tokenizer, el pipeline y el know-how.

### Etapa 4 — On-device y navegador (mes 6–12, solapa)
- **Modo online browser-first** (primero): transformers.js v3 (ONNX, WebGPU + fallback WASM), PWA + OPFS cache-first, modelo por hash versionado servido desde dominio propio (nunca CDN de terceros). El texto generado client-side viaja al server y **la cascada modera antes de renderizar** — invariante I1 intacto, se ahorra solo el cómputo de generación.
- **maat-guard local**: DeBERTa/XLM-R fine-tuneado en la 3060 con taxonomía T1–T7 en rioplatense (Llama Guard 3-1B-INT4 como referencia comparativa). Se integra primero server-side como `GuardrailCheck` en la cascada (el slot de ADR-2 ya existe) — es el entregable v1 etapa 1.
- **Modo offline degradado** (último, condicional): solo cuando maat-guard local iguale a la cascada server en los fixtures. Gate local = regex portable (`safety.ts` es puro) + plantillas fijas + maat-guard; banner de degradación explícito; sync + auditoría server al reconectar. App nativa futura: ExecuTorch.
- **Gate**: benchmark propio en 2–3 Android reales de gama baja argentinos (comprar los dispositivos: ~USD 200–400 del presupuesto) — tok/s, RAM pico, latencia de primera respuesta; crisis fixtures al 100% en modo offline simulado.

## 4. El laboratorio (sistema permanente)

- **Estructura**: [`lab/`](../lab/README.md) en este repo — configs, data engine, eval harness, recipes. Los checkpoints y datasets viven en HF Hub privado (`maatwork-lab`) + backup B2; el repo versiona el código y las decisiones, no los pesos.
- **Cadencia**: iteración local en la 3060 (toys, guard, cuantizaciones HQQ, evals); spot cloud para pretraining/destilaciones grandes. Tracking con trackio. Todo run reproducible: config YAML + seed + git SHA + dataset card con hash.
- **CI de modelos**: ningún checkpoint se promueve sin el gate completo (harness E0.1 + suites del producto). Writer ≠ checker: el eval corre en runner aparte del loop de entrenamiento. La suite de crisis es bloqueante dura — 0 falsos negativos conocidos, siempre.
- **Presupuesto anual estimado** (research §8): USD 2.000–4.700 de los 10.000 — el resto va a lo que v1 ya declaró: horas clínicas (dataset de riesgo, calibración VERA-MH-ES) y dispositivos de prueba. Sin compra de GPU hasta que el gasto spot real la justifique.
- **Publicaciones** (diferenciación + narrativa soberanía): tokenizer AR + medición de fertilidad; dataset sintético rioplatense (la parte no sensible); VERA-MH-ES; los modelos maat-* con model cards honestas. Todo Apache 2.0 salvo el dataset clínico.

## 5. Riesgos declarados (sin humo)

1. **Degradación de alignment por fine-tuning** — el riesgo #1, replicado en literatura. Mitigación: safety data mixing en cada batch + eval por checkpoint + gate binario. Está presupuestado como proceso, no como esperanza.
2. **Calidad conversacional de un 250M**: puede no alcanzar para conversación empática abierta. Por eso la escalera: la Etapa 2 (destilado sub-1B) y el fallback comercial existen; el modo on-device puede lanzarse con alcance acotado (check-ins, psicoeducación, compañía ligera) mientras el server maneja lo abierto.
3. **Un 100–300M jamás maneja crisis**: correcto y por diseño — las crisis van por plantilla determinística + maat-guard + derivación; el dataset generativo las excluye. El modelo propio nunca es la última red de un turno de riesgo (v1 etapa 4, intacto).
4. **G3 (consentimiento de entrenamiento)** es bloqueante legal previo a usar cualquier dato real. El plan arranca 100% con datos sintéticos justamente para no depender de eso.
5. **Fechas y precios 2026 caducan**: los claims no concluyentes de la verificación (FineWeb2-es exacto, Prompt API de Chrome) se re-verifican al momento de usar, no se asumen.
6. **Equipo de 1**: cada etapa produce un artefacto útil aunque el proyecto se pause (harness, dataset, tokenizer, guard). Nada requiere mantenimiento continuo para no romper el producto — el producto sigue corriendo con `resolveProvider` + fallback comercial.
