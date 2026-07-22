# Research profundo — Modelo propio ultra-pequeño para Simón (2026-07)

> Fecha: 2026-07-22 · Método: 27 agentes (12 áreas de research web + 12 verificadores adversariales + 3 análisis del repo), 68 claims factuales verificados con fuentes independientes (9 refutados y corregidos acá, 9 no concluyentes marcados). Informes crudos con fuentes completas: [`docs/research-modelo-propio/`](research-modelo-propio/).
> Pregunta: ¿puede MaatWork reemplazar DeepSeek por una familia de modelos propios ultra-pequeños, conversacionales en rioplatense, que corran en prácticamente cualquier hardware y navegador — y montar un laboratorio propio de entrenamiento? Plan derivado: [`plan-lab-maatwork-2026-07.md`](plan-lab-maatwork-2026-07.md).

## Veredicto ejecutivo

**Sí, es factible — y el nicho está genuinamente vacío.** No existe en el mundo ningún modelo español-first sub-1B, ningún dataset conversacional rioplatense, ningún benchmark de seguridad conversacional infantil en español, ni ningún laboratorio argentino de LLM propio (Latam GPT aporta datos argentinos pero sin liderazgo ni cómputo local). Los cuatro huecos son oportunidades de ser primeros — y publicables.

Los números cierran: **el compute no es el cuello de botella** (USD 10.000 ≈ 5.000–6.700 H100-horas spot 2026; el lab completo estimado usa USD 2.000–4.700/año). El cuello de botella es el **dataset conversacional rioplatense apto para infancia**, que hay que construir (mayormente sintético, por diseño legal). Y la razón para hacerlo **no es ahorro** (DeepSeek cuesta ~USD 7/mes al volumen actual): es soberanía de datos de menores, control total de guardrails, funcionamiento offline en la conectividad argentina real, y salir de la dependencia frágil de OpenCode Go (gateway para coding agents, sin SLA, roster cambiante — indefendible como proveedor primario de un producto estatal para menores).

**Estrategia recomendada — escalera de desriesgo, con innovación real en cada peldaño:**

1. **Destilar primero** (on-policy distillation, la técnica de punta oct-2025 ya soportada en TRL v1.0) sobre una base abierta sub-1B → genera el dataset, el harness de evaluación y el know-how sin apostar todo a un pretraining.
2. **Arquitectura y tokenizer propios después**: familia **Maat** diseñada desde cero (deep-narrow + GQA + sliding-window + QAT int4) con el **primer tokenizer rioplatense** (32–48k) — en modelos de 150M el embedding domina los parámetros; el tokenizer ES una decisión de arquitectura y nadie lo hizo para español-AR.
3. **Navegador/dispositivo al final**, en dos modos: online (el server sigue moderando antes de mostrar — invariante intacto) y offline degradado (gate local: regex portable + clasificador chico), recién cuando el clasificador local esté validado contra los fixtures de crisis.

La seguridad no se negocia en ningún peldaño: ningún modelo base trae seguridad infantil integrada, el fine-tuning **degrada el alignment incluso con datos benignos** (riesgo #1 del proyecto, mitigable y medible), y la capa determinística de crisis + la cascada de moderación quedan intactas e independientes del modelo generativo — igual que hoy.

---

## 1. Panorama de modelos sub-2B (jul 2026)

No hay atajo español-first sub-1B. Candidatos por rol (detalle: [`panorama-modelos-pequenos.md`](research-modelo-propio/panorama-modelos-pequenos.md)):

| Rol | Modelo | Licencia | Nota |
|---|---|---|---|
| Base sub-1B para destilar (tooling maduro) | **Qwen3-0.6B** (abr 2025) | Apache 2.0 | Checkpoint base disponible, ecosistema Unsloth/llama.cpp rodado |
| Base sub-1B alternativa (receta 100% pública) | **SmolLM2-360M** (2T–4T tokens) | Apache 2.0 | HF publicó datos+config: plantilla metodológica del lab |
| Browser/edge extremo | **Granite 4.0 Nano 350M** (oct 2025) | Apache 2.0 | Documentado corriendo en navegador vía WebGPU; español entre 12 idiomas; el hermano "1B" real es ~1.5–2B (verificado) |
| Edge extremo, híbrido conv/SSM | **LFM2-350M / LFM2.5-230M** (Liquid AI) | Apache-2.0-based + cláusula <USD 10M revenue | 213 tok/s en Galaxy S25, 42 tok/s en Raspberry Pi 5; licencia exacta a confirmar antes de comprometer |
| Edge ultra-chico 2026 | **Falcon-H1-Tiny 90M–0.6B** (TII, ene 2026) | Apache-2.0-based | 15 modelos; el más nuevo del segmento |
| Mejor español (referencia, no target) | **Salamandra-2B** (BSC) | Apache 2.0 | 2.25B — pesado para el target; su paper advierte que necesita safety tuning |
| Descartado | MobileLLM (Meta) | FAIR Noncommercial (verificado — no CC-BY-NC como se cita a veces) | No comercial |
| Con cuidado | Gemma 3 270M/1B | Gemma Terms custom | Obligaciones se propagan al fine-tune; Gemma 4 (abr 2026) sí es Apache 2.0 pero no baja de ~2.3B |

## 2. Cómo se entrena y cuánto cuesta de verdad

Detalle: [`pretraining-desde-cero.md`](research-modelo-propio/pretraining-desde-cero.md), [`post-training-destilacion.md`](research-modelo-propio/post-training-destilacion.md).

- **nanochat** (Karpathy, oct 2025, MIT): pipeline completo tokenizer→pretrain→SFT→serve; tier ~USD 100 ≈ **2h en 8xH100** (~USD 48 spot, verificado contra README) → calidad GPT-2. Base hackeable del lab, no fuente del modelo final.
- **SmolLM2** valida la estrategia para el target de Simón: **overtraining agresivo** (135M con 2T tokens ≈ 15.000 tokens/parámetro, ~750x Chinchilla) — pagar más entrenamiento a cambio de un modelo final chico y barato de inferir en el edge.
- **TinyLlama Chinchilla-óptimo** (1.1B, 22B tokens): 8xA100 × 32h ≈ **USD 360–510** — el pretraining chico es barato; USD 10k ≈ 5.000–6.700 H100-horas spot.
- **Precedente single-GPU**: L20-Edu-135M entrenó 135M desde cero con ~13B tokens en **una NVIDIA L20 de datacenter (48GB)** — no una GPU de consumo como se citó originalmente (verificado); la RTX 3060 12GB sirve para toys ≤50–125M y para todo el post-training, no para el pretraining final.
- **Post-training 2026**: el paradigma es **on-policy distillation** (Thinking Machines, oct 2025): 9–30x menos cómputo que SFT clásico, ya en TRL v1.0 (`DistillationTrainer` con teacher-server — el profesor corre en un server vLLM externo, no compite por VRAM). Recipe validado en 1B (openPangu): SFT curricular + destilación → un 1B iguala competidores de 1.7B. Para <2B el default es **full fine-tune** (no LoRA), viable en la 3060 con `paged_adamw_8bit` + gradient checkpointing. GRPO no aplica (la empatía no es verificable por reglas); DPO/ORPO después, si hay pares de preferencia.
- **Nadie chico pretrenea desde cero como estrategia primaria** ([`casos-de-estudio.md`](research-modelo-propio/casos-de-estudio.md)): Pleias (el mejor caso "equipo chico + datos abiertos") usó 64–192 H100 de supercómputo estatal francés; Apple/Google/Samsung integran o entrenan con recursos ilimitados. El patrón de producción real es base abierta + especialización. El pretraining propio entra como capacidad de laboratorio a escala 100–300M, no como única vía.

## 3. Datos: el verdadero cuello de botella

Detalle: [`datasets-espanol.md`](research-modelo-propio/datasets-espanol.md).

- **Pretraining**: sobra — FineWeb2-es ~484B tokens (ODC-By; cifra de fuente secundaria, re-verificar en el dataset card antes de dimensionar), HPLT v2 (CC0), corpus Salamandra/BSC (Apache 2.0). No existe corpus rioplatense dedicado → sobremuestrear dominios .ar/.uy + clasificador de dialecto.
- **Instrucción/chat**: fragmentado y con licencias trampa (verificado): **UltraChat es MIT** en su repo (no CC-BY-NC como se repite) pero fue generado con ChatGPT — revisar términos antes de uso comercial; **OpenHermes 2.5 NO es MIT limpio** (subsets con licencias mixtas, auditar uno por uno); SmolTalk2 multilingüe (subsets nuevos Apache 2.0) trae solo decenas de miles de filas en español.
- **Conclusión**: la generación sintética es **la vía principal, no un complemento** — método Magpie/PersonaHub (personas sintéticas de chicos/adolescentes argentinos + persona Simón, dialecto rioplatense explícito), generada con un LLM grande offline, filtrada por la misma cascada de moderación que ya corre en prod, decontaminada (n-gram 8–13) — costo estimado: **cientos de USD por cientos de miles de turnos**. Sin datos reales de menores por diseño.
- **El repo ya tiene la semilla** ([`repo-data-flywheel.md`](research-modelo-propio/repo-data-flywheel.md)): `training-export.ts` produce JSONL chat-completions redactado y testeado (~18k–26k ejemplos/año estimados al volumen actual) — pero con un **bloqueante legal: no existe `Guardian.trainingConsentAt`** y el export no chequea ningún consentimiento de entrenamiento, violando la regla documentada en ARCHITECTURE §3. Fix G3 antes de tocar la DB de prod para entrenar.

## 4. Arquitectura del modelo propio

Detalle: [`arquitecturas-eficientes.md`](research-modelo-propio/arquitecturas-eficientes.md). Decisiones con evidencia:

- **Deep-narrow gana sub-1B** (MobileLLM, ICML 2024: 125M con 30 capas). **GQA 3:1/4:1 + sliding-window 5:1 ventana 1024 + RoPE dual 10k/1M + QK-norm** (receta Gemma 3: KV-cache de ~60% → <15% del overhead). **MLA no** (beneficio se diluye a esta escala, soporte pobre en runtimes edge). **MoE no** (ahorra FLOPs, no RAM — fatal en 2–4GB).
- **El embedding domina los parámetros a esta escala** → **tokenizer propio español-AR de 32–48k + embedding tying** es la palanca #1 de calidad-por-byte (un vocab 262k estilo Gemma devora 134M de parámetros con d=512). Nadie construyó un tokenizer rioplatense: primera innovación concreta del lab.
- **QAT integrado** (finetune ~5k pasos con el checkpoint fp como target, receta Gemma 3): recupera ~54% de la degradación int4 vs cuantizar después. Embedding en int8.
- **Configs propuestas** (RAM pico móvil estimada): **maat-nano** ~150M (32 capas, d=576, vocab 32k → ~150–200MB), **maat-micro** ~250M (30 capas, d=768, vocab 48k → ~250–350MB, el sweet-spot), **maat-mini** ~400M (36 capas, d=896 → ~400–550MB). Track experimental paralelo: híbrido conv/SSM estilo LFM2 (mejor latencia CPU, decidir por benchmark de calidad-por-RAM, no por moda). Piloto BitNet ternario (1.58-bit, ya práctico en 2026) solo como experimento aparte.

## 5. Deployment: navegador y dispositivos

Detalle: [`inferencia-navegador.md`](research-modelo-propio/inferencia-navegador.md), [`inferencia-dispositivos.md`](research-modelo-propio/inferencia-dispositivos.md).

- **Techo realista del parque argentino**: 100–500M en q4 (60–270MB de descarga). 1B en Android de gama baja (3GB) da 2–5 tok/s — inaceptable; en WASM puro solo ≤360M es usable. WebGPU ya es stable en todos los browsers (Safari 26 incluido, 2025) pero Android <12 y GPUs viejas quedan afuera → **fallback WASM obligatorio**.
- **Stack browser**: **transformers.js v3** (ONNX Runtime Web, WebGPU + fallback WASM en la misma librería, conversión simple de modelo propio) como primera opción; **wllama** si se estandariza GGUF como formato único. WebLLM/MLC descartado como principal (compilación wasm por modelo). **PWA + OPFS cache-first es obligatorio** (datos móviles argentinos: bajar el modelo una sola vez). Gemini Nano/Prompt API: no sirve (modelo de terceros, sin control ni garantía de español).
- **On-device nativo**: llama.cpp/GGUF (Q4_K_M default, Q8_0 server), **ExecuTorch** como runtime móvil productivo (MediaPipe está en mantenimiento), HQQ para iterar cuantizaciones sin calibración.
- **Server barato de transición**: VPS Hetzner (~€8–20/mes) con llama.cpp sirve el volumen actual; Modal serverless ~USD 12/mes a 30k msgs. Cloudflare Workers AI **no acepta modelos base propios** (solo LoRA <300MB rank≤32 sobre sus bases — verificado) y Fly.io retira GPUs el 1-ago-2026: ambos descartados.

## 6. Seguridad: la arquitectura defendible

Detalle: [`seguridad-modelo-infantil.md`](research-modelo-propio/seguridad-modelo-infantil.md), [`repo-integracion-llm.md`](research-modelo-propio/repo-integracion-llm.md).

- **Riesgo #1 del proyecto**: el fine-tuning degrada el safety alignment **incluso con datos benignos** (Qi et al. ICLR 2024, replicado). Mitigación obligatoria: safety data mixing en cada batch + prompt template discrepancy + **eval de seguridad por checkpoint** (writer ≠ checker). El safety baked-in de un sub-1B es real pero frágil (más jailbreakeable que modelos grandes; el refusal es una feature localizada) — es una capa, jamás la garantía.
- **Cuando la inferencia es local, la moderación viaja con el modelo** (así lo hacen Apple y Gemini Nano): regex determinística local (portable — `safety.ts` es 100% funciones puras) → generación completa sin streaming → **clasificador local** como gate (Llama Guard 3-1B-INT4: 440MB, ≥30 tok/s en CPU Android, español oficial; o un DeBERTa/XLM-R propio ~300–435M fine-tuneado en la 3060 — más liviano y con taxonomía T1–T7 a medida) → cascada server recategorizada como auditoría asíncrona + alertas.
- **El análisis del código real** identifica los 11 invariantes que hoy dependen del server (I1–I11) y ordena los modos: **Opción A** (cliente genera draft, server modera con round-trip obligatorio antes de render — gana costo/latencia, mantiene el gate para clientes honestos) y **Opción B** (modo offline degradado, explícito y señalizado, con piso regex local + sync al reconectar). El modelo propio destilado además **elimina el problema I10**: la PERSONA se hornea en los pesos — nada confidencial viaja al cliente y se liberan ~2.7k tokens de prefijo por turno.
- **Regulación a cumplir por diseño**: California SB 243 (vigente ene-2026: disclosure, recordatorio cada 3h a menores, protocolo self-harm publicado, daños USD 1.000/violación), EU AI Act art. 5 (prohibido explotar vulnerabilidad por edad/discapacidad). Simón ya cumple el espíritu (disclosure cada 10 turnos, plantillas de crisis, límites de sesión) — documentarlo contra estos textos.
- **Swap de proveedor NO es "cero código"** (6 supuestos ocultos verificados en el código): `AI_API_KEY` vacía apaga la IA (usar dummy), `AI_EXTRA_BODY` del gateway actual rompe servers propios (vaciar), `LLM_TIMEOUT_MS=8s` hardcodeado en `moderation.ts:104` (cambio de código), `CONTEXT_BUDGETS` estima 4 chars/token pero el español da ~3 (re-tunear para ventana chica), el gate completo debe re-correrse contra el modelo nuevo, y decidir si el moderador de capa 2 sigue siendo el mismo modelo que genera.

## 7. Evaluación: qué se adopta y qué se construye

Detalle: [`evaluacion-espanol.md`](research-modelo-propio/evaluacion-espanol.md).

- **Adoptar**: lm-eval-harness con **SpanishBench** (belebele_spa, xnli_es, xquad_es, copa_es… ya integrado), **TELEIA** (gramática nativa, no traducida), **M-IFEval** (instrucciones en español — la brecha entre modelos es mayor que en inglés). No confiar en MMLU-es traducido (6–13 puntos de error por artefactos de traducción).
- **Adaptar**: **VERA-MH → VERA-MH-ES** (eval clínico de riesgo suicida, user-agent + judge-agent, IRR clínica 0.77; ya previsto en el plan I+D vigente). EQ-Bench como plantilla de diseño para empatía (no existe en español).
- **Construir (activos sin equivalente público)**: rúbrica de voseo/tono rioplatense (regex de conjugación + LLM-judge validado con humanos) y el set de **fixtures de crisis infantil en rioplatense** — que ya existe parcialmente en las suites del repo (~90 casos etiquetados T1–T7) y es el dataset de evaluación más valioso del proyecto: versionarlo como código de producción.
- **LLM-judge con escepticismo**: rúbricas 3–7 criterios ordinales, aleatorizar orden, juez de familia distinta al generador, validar contra muestreo humano rioplatense (la literatura de sesgos de jueces está validada casi solo en inglés). Costo por checkpoint: centavos — el costo real es curar fixtures.
- `conversation-eval.ts` (30 escenarios, juez con rúbrica de 7 dimensiones, model-aware) es la plantilla correcta del gate generativo, pero hoy es exploratorio: definir umbrales duros (0 safety✗, 0 leak, warmth ≥ N) y hacerlo salir con exit 1.

## 8. Laboratorio: diseño y presupuesto

Detalle: [`laboratorio-mlops.md`](research-modelo-propio/laboratorio-mlops.md), estructura en [`lab/`](../lab/README.md).

- **Local (3060) para iteración + cloud spot para corridas grandes. No comprar GPU todavía** (una 3090 usada ~USD 1.000–1.300 compite contra cientos de horas spot; reevaluar con datos reales de gasto en 6–12 meses).
- Stack: **trackio** (HF, gratis, local-first) > W&B; **HF Hub PRO** (USD 9/mes, org privada `maatwork-lab`) como registro; **nanochat fork** para pretraining + **TRL** para post-training; **Backblaze B2** backup frío; gate CI = las suites existentes extendidas (el patrón de labs chicos: suite curada chica bloqueante + LLM-judge nightly).
- Precios spot verificados (jul 2026): RunPod Community 4090 ~USD 0.34/h, H100 PCIe ~USD 1.99/h (los precios ~0.69/2.89 son Secure Cloud); Vast.ai 4090 desde ~USD 0.16–0.59/h.
- **Presupuesto anual estimado: USD 2.000–4.700 de los 10.000** — sobra margen. El recurso escaso es tiempo humano (curación de datos, calibración de rúbricas, partnership clínico), igual que declara el plan I+D vigente.

## 9. Correcciones de la verificación adversarial

De 68 claims verificados, 9 refutados (corregidos arriba en su contexto): specs del tier $100 de nanochat; licencias de UltraChat (MIT, no CC-BY-NC), OpenHermes (mixta, no MIT), MobileLLM (FAIR NC, no CC-BY-NC); tamaño del Granite Nano grande (~1.5–2B, no 1B); precios RunPod (Community vs Secure); "QLoRA sin cuantización" (QLoRA ES cuantización 4-bit); hardware de L20-Edu-135M (L20 datacenter, no RTX 4090); límites de LoRA en Cloudflare (<300MB rank≤32, la conclusión "no BYO base" se sostiene). Los 9 no-concluyentes quedan marcados en los informes crudos (destaca: la cifra de FineWeb2-es y el estado de la Prompt API de Chrome — re-verificar antes de usar).

## 10. Qué es genuinamente innovador acá (y qué se reusa a propósito)

**Se innova** (nadie lo hizo):
1. Primer **tokenizer español-rioplatense** optimizado para modelos chicos (32–48k, voseo/lunfardo/morfología AR).
2. Primera **familia de modelos conversacionales español-first sub-500M** (maat-nano/micro/mini) con arquitectura propia diseñada para gama baja argentina.
3. Primer **dataset conversacional sintético rioplatense** de acompañamiento emocional infantil-juvenil (persona-driven, sin datos reales de menores).
4. Primera **suite de evaluación de seguridad conversacional infantil en español** (VERA-MH-ES + fixtures T1–T7 + rúbrica de voseo).
5. **Destilación on-policy aplicada a empatía en español** — la técnica más nueva del campo en un dominio inexplorado.
6. Arquitectura de producto **safety-first con inferencia local** (gate local determinístico + clasificador propio + auditoría server asíncrona) para menores — sin precedente publicado.

**Se reusa a propósito** (reinventarlo sería perder el tiempo): datasets abiertos (FineWeb2/HPLT/SmolTalk2), TRL/nanochat/lm-eval-harness, llama.cpp/ONNX/transformers.js, recetas publicadas (SmolLM2, Gemma 3 QAT, MobileLLM). La innovación está en el dominio, los datos, el tokenizer y la seguridad — no en reescribir infraestructura que ya es excelente y abierta.
