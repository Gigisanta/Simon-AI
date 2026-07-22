# Arquitecturas eficientes para LLMs ultra-pequeños (100M–2B) — investigación para MaatWork/Simón

_Fecha de elaboración: 2026-07-22. Términos técnicos en inglés a propósito._

## Resumen ejecutivo

Para un modelo propio ~150M–400M que corra en navegador (WebGPU/WASM) y en Android de gama baja (2–4 GB RAM) conversando en español rioplatense, la evidencia 2024–2026 converge en un puñado de decisiones concretas:

1. **Deep-and-narrow gana** en el régimen sub-1B. MobileLLM (Meta, ICML 2024) demuestra empíricamente que a paridad de parámetros, más capas y menor `d_model` supera a wide-shallow — sus 125M usan **30 capas** y 350M usan **32 capas** ([arxiv 2402.14905](https://ar5iv.labs.arxiv.org/html/2402.14905)).
2. **El embedding domina el presupuesto de parámetros** en esta escala, así que el vocabulario es una decisión de _arquitectura_, no un detalle de tokenizer. Con `d_model≈512` un vocab de 262k (Gemma 3) costaría ~134M solo en embeddings — inviable. Para un modelo mayormente español, un tokenizer propio de **32k–48k** con **embedding tying** es la palanca #1 de calidad-por-byte.
3. **La atención es cara en RAM por el KV-cache, no tanto en parámetros.** Para nuestro caso el orden de preferencia es: **GQA + sliding-window híbrido (estilo Gemma 3, ratio 5:1)** como opción segura y bien soportada en runtimes; **híbrido SSM/conv + poca atención (estilo LFM2/Granite 4.0)** como apuesta de máxima eficiencia CPU/móvil. MLA (DeepSeek) rinde más en modelos grandes con contexto largo, pero es compleja y su beneficio se diluye a 150M–400M con contexto corto.
4. **QAT (quantization-aware training) desde el diseño**, apuntando a **int4 per-channel/per-block**, siguiendo la receta de Gemma 3 QAT (finetune corto ~5k pasos con el checkpoint fp como target).
5. **Weight/layer sharing** (MobileLLM-LS) y **attention sinks** son optimizaciones baratas que suman calidad sin costo de memoria.

Propongo abajo 3 configs concretas (nano ~150M, micro ~250M, mini ~400M) con estimación de RAM en int4.

---

## Hallazgos

### 1. Deep-and-narrow vs wide-shallow (MobileLLM)

El paper _MobileLLM: Optimizing Sub-billion Parameter Language Models_ (Meta, arxiv [2402.14905](https://ar5iv.labs.arxiv.org/html/2402.14905), feb-2024, publicado en ICML 2024) es la referencia canónica del régimen sub-1B. Hallazgos verificados de la fuente primaria:

- **Profundidad > ancho**: probando 19 modelos, "deeper and thinner models generally outperform their wider and shallower counterparts"; modelos de 30+ capas superan consistentemente al baseline de 12 capas.
- **Configs exactas**:
  - MobileLLM-125M: **30 capas**, `d_model=576`, 9 query heads, 3 KV heads (GQA 3:1), 124.6M params.
  - MobileLLM-350M: **32 capas**, `d_model=960`, 15 query heads, 5 KV heads (GQA 3:1), 345.3M params.
- **Embedding sharing (tying)**: reusar el input embedding como output head reduce ~11.8% de params con pérdida marginal (~0.2 pts), recuperable agregando capas.
- **GQA**: bajar KV-heads a 1/3 mantiene performance y libera params para subir `d_model`.
- **Block-wise layer sharing (MobileLLM-LS)**: comparte pesos entre bloques adyacentes computando cada bloque dos veces; en iPhone 13 solo **+2.6% de latencia** por duplicar capas efectivas, +0.7–0.8% accuracy. Clave: evita mover pesos entre SRAM y DRAM.
- **Cuantización**: W8A8 PTQ degrada <0.5%. (Un reporte más nuevo, _MobileLLM-Pro_, arxiv [2511.06719](https://arxiv.org/html/2511.06719), nov-2025, continúa esta línea.)

**Implicación**: nuestras configs deben ser deep-narrow (30–36 capas) con GQA 3:1 o 4:1 y embedding tying obligatorio.

### 2. Atención híbrida local/global y sliding window (Gemma 3)

Gemma 3 (Google, tech report arxiv [2503.19786](https://arxiv.org/pdf/2503.19786), mar-2025) es el mejor ejemplo de reducir KV-cache sin perder calidad:

- **Ratio 5:1**: bloques de 5 capas de _local sliding-window attention_ (ventana **1024**) por cada 1 capa de _global attention_ (vs 1:1 en Gemma 2).
- **Ahorro de KV-cache**: el impacto en perplexity es mínimo y baja el overhead de KV-cache **de ~60% (global-only) a <15%** ([developers.googleblog](https://developers.googleblog.com/gemma-explained-whats-new-in-gemma-3/)).
- **RoPE de dos frecuencias**: base **10k** en capas locales, **1M** en capas globales — trucazo barato para contexto largo.
- **QK-norm** reemplaza el soft-capping de Gemma 2 (mejor accuracy y velocidad).
- **Vocab 262k**, tokenizer SentencePiece compartido con Gemini, "more balanced for non-English languages". Ojo: ese vocab gigante es viable en Gemma 3 1B pero **no** en un modelo de 150M (ver §4).

**QAT**: los checkpoints cuantizados de Gemma 3 se obtienen con **finetune corto (~5.000 pasos) usando QAT**, tomando las probabilidades del checkpoint no-cuantizado como target. Formatos: **per-channel int4, per-block int4, y switched fp8** ([tech report](https://arxiv.org/html/2503.19786v1)).

**Implicación**: el patrón sliding-window 5:1 + RoPE dual + QK-norm es directamente adoptable y es la opción de menor riesgo de integración (soportada en llama.cpp, MLC, transformers.js).

### 3. GQA/MQA vs MLA (DeepSeek)

- **GQA/MQA** reducen el KV-cache _compartiendo_ heads K/V. Simple, universal, bien soportado en todos los runtimes móviles/browser.
- **MLA (Multi-head Latent Attention)** de DeepSeek-V2 (arxiv [2405.04434](https://arxiv.org/pdf/2405.04434), may-2024) _comprime_ K/V a un espacio latente de bajo rango antes de cachear. Números citados: DeepSeek-V3 logra ~70 KB/token vs 192–328 KB/token de modelos GQA (2.7–4.7× menos), y las ablations muestran que MLA iguala o supera a MHA en perplexity mientras GQA pierde ~0.5 pts ([Raschka, MLA gallery](https://sebastianraschka.com/llm-architecture-gallery/mla/)).
- **Trade-off**: MLA es "more complicated to implement, more complicated to serve, but more compelling once model size and context length get large enough that cache traffic dominates". A 150M–400M con contexto conversacional corto (unos pocos miles de tokens) el KV-cache no domina, y el soporte de MLA en runtimes de browser/móvil es pobre.

**Veredicto para Simón**: **GQA 3:1/4:1** por defecto. MLA queda como opción futura solo si se escala a ≥1B con contexto largo. No vale la complejidad hoy.

### 4. El problema del embedding y las decisiones de tokenizer/vocab

Este es **el** punto crítico para un modelo de 150M. La capa de embedding + el output head son "one of the most parameter-expensive components" a esta escala ([survey SLM, arxiv 2501.05465](https://arxiv.org/html/2501.05465v2)). Costo del embedding = `V × d_model`.

Ejemplos con `d_model=512`:
- vocab 32k → 16.4M params (tied, se cuenta una vez)
- vocab 49k → 25.1M
- vocab 128k → 65.5M
- vocab 262k (Gemma 3) → **134M** → devora un modelo de 150M entero.

_Scaling Laws with Vocabulary_ (NeurIPS 2024, [pdf](https://proceedings.neurips.cc/paper_files/paper/2024/file/cf5a019ae9c11b4be88213ce3f85d85c-Paper-Conference.pdf)) formaliza que **modelos más chicos merecen vocabularios más chicos**: el vocab óptimo escala sublinealmente con params. Un vocab grande en un modelo chico desperdicia capacidad y encima "significantly increases accelerator usage during decoding".

**Fertilidad de tokens en español**: los tokenizers entrenados mayormente en inglés (Llama, GPT) parten palabras españolas en más subwords (mayor fertilidad = más tokens por palabra = más lento y peor uso de contexto). Trabajos de tokenización multilingüe (_The Art of Breaking Words_, arxiv [2508.06533](https://arxiv.org/html/2508.06533v1), 2025; _Tokenization is Sensitive to Language Variation_, arxiv [2502.15343](https://arxiv.org/pdf/2502.15343)) muestran que un tokenizer ajustado al idioma objetivo mejora fertilidad y downstream. Para español rioplatense (voseo, "che", diminutivos -ito/-ita, lunfardo) un **BPE/Unigram propio entrenado en corpus AR** captura morfología y jerga que un vocab genérico fragmenta.

**Recomendación de tokenizer**:
- Entrenar un tokenizer **propio SentencePiece/BPE de 32k (nano) a 48k (mini)** sobre corpus predominantemente español rioplatense + algo de inglés/código para robustez.
- **Embedding tying obligatorio** (input = output weights). A esta escala es gratis en calidad y ahorra 10–15% de params.
- Mantener el embedding en **int8** aunque el resto vaya a int4 (los embeddings toleran mal int4 puro; Gemma 3 QAT usa per-channel/block justamente para esto).
- Referencias de español entrenado desde cero: **Salamandra** (BSC, MareNostrum 5) en 2B/7B/40B, 35 lenguas europeas incl. español/catalán/gallego/euskera ([HF BSC-LT](https://huggingface.co/BSC-LT/salamandra-2b-instruct)) — útil como baseline de datos/tokenizer, aunque su vocab multilingüe es más grande que lo óptimo para un modelo AR-first.

### 5. Híbridos SSM/atención y attention-free (Mamba2, LFM2, RWKV-7, Falcon-H1, Granite 4.0, Zamba2)

La familia de arquitecturas que reemplaza parte de la atención por _state-space models_ (SSM) o convoluciones cortas es la apuesta de máxima eficiencia en CPU/móvil, porque elimina o reduce el KV-cache (que crece con la longitud de secuencia).

- **LFM2 (Liquid AI, 10-jul-2025; tech report arxiv [2511.23404](https://arxiv.org/abs/2511.23404))**: qué usa _exactamente_ — **16 bloques: 10 double-gated short-range convolution blocks + 6 GQA blocks**. Los conv blocks son sistemas lineales de primer orden con multiplicative gating, O(n), depthwise Conv1d kernel=3; los attention blocks son GQA (16 query heads / 8 KV heads), RoPE theta=1M, SwiGLU FFN. Tamaños dense **0.35B / 0.7B / 1.2B**, contexto 32k, 10T tokens (75% EN / 20% multilingüe incl. **español** / 5% code). Claim: **~200% más rápido en decode/prefill que Qwen3 y Gemma 3 en CPU**. Licencia "based on Apache 2.0", gratis comercial para empresas <USD 10M de revenue ([blog Liquid AI](https://www.liquid.ai/blog/liquid-foundation-models-v2-our-second-series-of-generative-ai-models)). Cuantización probada: ExecuTorch 8da4w, llama.cpp Q4_0, en Galaxy S24 Ultra. **Este es el modelo de referencia más directo para nuestro objetivo** (on-device, incluye español, hay checkpoint de 0.35B).
- **IBM Granite 4.0 (2-oct-2025, Apache 2.0)**: hybrid **Mamba-2/Transformer ratio 9:1** (mayoría Mamba-2 SSM, minoría self-attention). Variantes: Micro 3B dense, H-Micro 3B hybrid, **H-Tiny 7B MoE (~1B activo)**, H-Small 32B MoE (~9B activo). Claim: **>70% menos memoria y 2× más rápido** vs modelos similares, sobre todo en contexto largo y multi-sesión ([IBM](https://www.ibm.com/new/announcements/ibm-granite-4-0-hyper-efficient-high-performance-hybrid-models)). Primer modelo abierto con certificación ISO/IEC 42001. Nota: sus tamaños "tiny" siguen siendo 3B+, más grandes que nuestro target.
- **Falcon-H1 (TII, tech report arxiv [2507.22448](https://arxiv.org/pdf/2507.22448), 31-jul-2025)**: hybrid **paralelo** — corre attention y Mamba-2 heads _en paralelo_ dentro del mismo mixer block, con cantidad de heads de cada tipo ajustable independientemente. Rango 0.5B–34B, incluye un **0.5B** relevante para nuestra escala.
- **RWKV-7 "Goose" (arxiv [2503.14456](https://arxiv.org/pdf/2503.14456), mar-2025)**: 100% RNN attention-free, **linear-time, constant-space, sin KV-cache**, ctx infinito. Generaliza la delta rule con state gating (update diagonal + rank-1). Expresividad > TC0, reconoce todos los lenguajes regulares con capas constantes. Ventaja enorme para móvil: memoria _constante_ por token, no crece con el contexto. Riesgo: ecosistema/tooling más chico y menos maduro para deploy en browser que GQA-transformer.
- **Zamba2 / Samba / Hymba / Jamba**: familia de híbridos Mamba+attention; Zamba2 usa además shared attention blocks. Menos relevantes por tamaño, pero confirman el patrón "mayoría SSM + pizca de atención".

**Mamba2** es el bloque SSM común subyacente (selective state-space, O(n)). El consenso 2025-2026 no es "SSM puro" sino **híbrido: mayoría SSM/conv barata + minoría de atención para long-range/recall preciso** (los SSM puros fallan en tareas de copia/recall exacto).

**Trade-off para Simón**: un híbrido conv/SSM (LFM2-like) da la mejor latencia CPU y RAM constante, ideal para Android gama baja. Contra: menos soporte en runtimes de browser (transformers.js/WebLLM están optimizados para transformers estándar), y los guardrails/moderación dependen de calidad de instruction-following que a esta escala hay que validar caso por caso. **Estrategia recomendada: prototipar en paralelo (a) un GQA-transformer sliding-window estándar — camino seguro de deploy — y (b) un híbrido LFM2-like — camino de eficiencia — y comparar calidad-por-RAM real.**

### 6. MoE a escala chica: ¿tiene sentido sub-2B?

- **OLMoE (Ai2, arxiv [2409.02060](https://arxiv.org/abs/2409.02060), sep-2024, ICLR 2025)**: 7B totales, **1B activo**, 16 capas, 64 experts con 8 activos. Entrena 2× más rápido que un dense equivalente y supera a Llama2-13B-Chat.
- **Granite 4.0 H-Tiny**: 7B totales / ~1B activo.

**Problema para on-device**: MoE ahorra _FLOPs_ (compute), no _memoria_ — hay que cargar **todos** los experts en RAM aunque solo se activen algunos. Un 7B-A1B necesita RAM para 7B de pesos. Para un celular de 2–4 GB eso es fatal. MoE tiene sentido cuando el cuello es compute/servidor, no cuando el cuello es RAM del dispositivo. **Veredicto: para Simón on-device, MoE NO conviene sub-2B.** Un dense de 250–400M usa menos RAM y es más simple de cuantizar/servir en browser. MoE solo tendría sentido si Simón corriera server-side y el objetivo fuera throughput.

### 7. Attention sinks, NoPE vs RoPE, extensión de contexto

- **Attention sinks** (ICLR 2025, [When Attention Sink Emerges](https://proceedings.iclr.cc/paper_files/paper/2025/file/f1b04face60081b689ba740d39ea8f37-Paper-Conference.pdf)): los transformers concentran atención desproporcionada en los primeros tokens. Agregar un **sink token dedicado** estabiliza streaming/sliding-window, mejora robustez de cuantización y eficiencia de KV-cache. Barato y recomendable para un modelo con sliding-window.
- **NoPE vs RoPE** (_Rope to Nope and Back Again_, arxiv [2501.18795](https://arxiv.org/pdf/2501.18795), ene-2025): integrar **capas NoPE (sin positional embedding) con full attention** mejora long-context y **elimina la necesidad de RoPE scaling**, simplificando el entrenamiento. En los experimentos NoPE concentra más "attention mass" en needle tokens que RoPE. La estrategia ganadora es **híbrida**: mayoría RoPE (local) + algunas capas NoPE/global.
- **Implicación**: para Simón el contexto conversacional es corto (historial de chat de un menor, pocos miles de tokens), así que la extensión de contexto no es prioridad. Basta RoPE dual-frequency estilo Gemma 3. Un sink token conviene por robustez de cuantización.

---

## Implicaciones para Simón-MaatWork

**Restricción dura**: los guardrails de seguridad infantil no se tocan. La arquitectura del modelo generativo es _independiente_ de la capa determinística de crisis (regex) y de la cascada de moderación server-side (regex → OpenAI Moderation → juez LLM). Un modelo propio más chico **reemplaza al generador**, pero la moderación sigue corriendo sin streaming (generar completo → moderar → mostrar). Ventaja: un modelo propio nos deja **auto-hostear también el juez/moderador** a futuro y no depender de OpenAI Moderation.

**Decisiones arquitecturales concretas** (calidad-por-byte y por-FLOP en 2026):
1. **Deep-narrow**: 30–36 capas, `d_model` 512–896.
2. **GQA 3:1 o 4:1** + **sliding-window 5:1** (ventana 512–1024) + 1 capa global cada 5. RoPE dual (10k local / 1M global). QK-norm.
3. **Tokenizer propio español-AR de 32k–48k**, **embedding tying**, embedding en int8.
4. **Sink token** dedicado. Sin MLA, sin MoE.
5. **QAT integrado**: entrenar en fp/bf16, luego finetune QAT ~5k pasos a **int4 per-channel** (receta Gemma 3). Mantener int8 en embedding y quizás en la última capa.
6. **Layer sharing (MobileLLM-LS)** opcional en el nano para exprimir calidad sin RAM extra.
7. **Track paralelo LFM2-like** (conv/SSM híbrido) como experimento de eficiencia CPU/móvil, decidido por benchmark real de calidad-por-RAM, no por moda.

**Con 1× RTX 3060 12GB y ~USD 10k**: entrenar desde cero un 150M–400M es factible (MobileLLM-125M/350M se entrenaron a esta escala; con distillation desde el generador comercial actual como teacher se acelera muchísimo — LFM2 usó su propio 7B como teacher). El presupuesto alcanza para compute cloud puntual (unos cientos de GPU-hours A100/H100 para el pretraining del mini) + la 3060 para experimentos, ablations de tokenizer y QAT. **Distillation del modelo comercial actual (DeepSeek V4 Flash) hacia el modelo propio es el camino más barato hacia calidad conversacional en español.**

### Configs propuestas (con RAM estimada en int4)

Estimación de params: `embed = V×d` (tied, contado una vez) + `capas × ~12·d²` (bloque estándar GQA+SwiGLU). RAM de pesos en int4 ≈ `params × 0.5 bytes` (embedding en int8 suma ~`V×d` bytes). Sumar 30–60% de overhead de runtime + KV-cache para el pico real en móvil.

| Config | Capas | d_model | Q/KV heads | Vocab | Params aprox | Pesos int4 | RAM pico móvil (est.) |
|---|---|---|---|---|---|---|---|
| **nano** ~150M | 32 | 576 | 9 / 3 (GQA) | 32k | ~146M | ~73 MB (+18 MB embed int8) | ~150–200 MB |
| **micro** ~250M | 30 | 768 | 12 / 3 (GQA) | 48k | ~249M | ~124 MB (+37 MB embed int8) | ~250–350 MB |
| **mini** ~400M | 36 | 896 | 14 / 2 (GQA) | 48k | ~390M | ~195 MB (+43 MB embed int8) | ~400–550 MB |

Atención en las tres: **sliding-window 5:1 (ventana 1024) + 1 global/5, RoPE dual, QK-norm, sink token, embedding tying**. Todas caben con holgura en Android de 2–4 GB y en WebGPU de browser (que suele tener 1–4 GB de VRAM). El **nano** incluso corre en WASM como fallback para dispositivos sin WebGPU (~70–75% de móviles tienen WebGPU en 2025). Recomendación de arranque: **entrenar el micro (~250M) como sweet-spot** de calidad conversacional vs RAM, con el nano como fallback ultra-liviano y el mini como techo de calidad on-device.

**Variante experimental LFM2-like** (mismo presupuesto de RAM): ~16 bloques, 10 conv gated + 6 GQA, `d_model` 640–768, vocab 48k. Mismo orden de RAM pero mejor latencia CPU esperada y KV-cache menor (solo 6 capas con cache). Validar calidad-por-RAM contra el micro transformer antes de comprometer.

---

## Fuentes

- [MobileLLM (arxiv 2402.14905), feb-2024 / ICML 2024](https://ar5iv.labs.arxiv.org/html/2402.14905) — evidencia deep-narrow, configs 125M/350M, embedding sharing, GQA 3:1, block-wise layer sharing, cuantización W8A8. **Fuente primaria clave del régimen sub-1B.**
- [MobileLLM-Pro Technical Report (arxiv 2511.06719), nov-2025](https://arxiv.org/html/2511.06719) — continuación de la línea MobileLLM.
- [Gemma 3 Technical Report (arxiv 2503.19786), mar-2025](https://arxiv.org/pdf/2503.19786) — sliding-window 5:1, ventana 1024, RoPE dual (10k/1M), QK-norm, vocab 262k, QAT (~5k pasos, per-channel/per-block int4, switched fp8).
- [Gemma explained — Google Developers Blog](https://developers.googleblog.com/gemma-explained-whats-new-in-gemma-3/) — KV-cache de 60%→<15%, resumen de arquitectura Gemma 3.
- [LFM2 blog, Liquid AI, 10-jul-2025](https://www.liquid.ai/blog/liquid-foundation-models-v2-our-second-series-of-generative-ai-models) — 16 bloques (10 conv + 6 GQA), tamaños 0.35/0.7/1.2B, 10T tokens incl. español, 200% más rápido en CPU, licencia Apache-2.0-based, cuantización móvil.
- [LFM2 Technical Report (arxiv 2511.23404), nov-2025](https://arxiv.org/abs/2511.23404) — detalle arquitectural del híbrido conv/attention.
- [IBM Granite 4.0 announcement, 2-oct-2025](https://www.ibm.com/new/announcements/ibm-granite-4-0-hyper-efficient-high-performance-hybrid-models) — hybrid Mamba-2/Transformer 9:1, variantes Micro/H-Tiny/H-Small, >70% menos memoria, Apache 2.0, ISO 42001.
- [Falcon-H1 Technical Report (arxiv 2507.22448), 31-jul-2025](https://arxiv.org/pdf/2507.22448) — hybrid paralelo attention+Mamba-2, rango 0.5B–34B.
- [RWKV-7 "Goose" (arxiv 2503.14456), mar-2025](https://arxiv.org/pdf/2503.14456) — RNN attention-free, constant-space sin KV-cache, delta rule generalizada, expresividad >TC0.
- [DeepSeek-V2 (arxiv 2405.04434), may-2024](https://arxiv.org/pdf/2405.04434) — MLA, compresión low-rank de KV.
- [Sebastian Raschka — MLA gallery](https://sebastianraschka.com/llm-architecture-gallery/mla/) — comparación MLA vs GQA, KB/token, trade-offs de implementación.
- [OLMoE (arxiv 2409.02060), sep-2024 / ICLR 2025](https://arxiv.org/abs/2409.02060) — MoE 7B-A1B, 64 experts/8 activos; base para evaluar MoE a escala chica.
- [Scaling Laws with Vocabulary (NeurIPS 2024)](https://proceedings.neurips.cc/paper_files/paper/2024/file/cf5a019ae9c11b4be88213ce3f85d85c-Paper-Conference.pdf) — modelos chicos merecen vocabularios chicos; vocab óptimo escala sublinealmente.
- [Scaling Embedding Layers (arxiv 2502.01637), 2025](https://arxiv.org/pdf/2502.01637) — costo/estrategias de la capa de embedding.
- [The Art of Breaking Words (arxiv 2508.06533), 2025](https://arxiv.org/html/2508.06533v1) — diseño de tokenizer multilingüe, fertilidad.
- [Tokenization is Sensitive to Language Variation (arxiv 2502.15343)](https://arxiv.org/pdf/2502.15343) — impacto de variación lingüística en tokenización (relevante para rioplatense).
- [Rope to Nope and Back Again (arxiv 2501.18795), ene-2025](https://arxiv.org/pdf/2501.18795) — NoPE+full attention mejora long-context, elimina RoPE scaling; estrategia híbrida.
- [When Attention Sink Emerges (ICLR 2025)](https://proceedings.iclr.cc/paper_files/paper/2025/file/f1b04face60081b689ba740d39ea8f37-Paper-Conference.pdf) — sink tokens, streaming, robustez de cuantización.
- [Survey of Small Language Models (arxiv 2501.05465), 2025](https://arxiv.org/html/2501.05465v2) — panorama SLM, costo del embedding.
- [WebGPU Inference 2025 Playbook / Transformers.js v3 (HF)](https://www.huggingface.co/blog/transformersjs-v3) — int4 en browser, WebGPU ~70–75% de móviles, RAM/VRAM disponible, WebLLM/MLC vs transformers.js.
- [Salamandra 2B (BSC-LT, HF)](https://huggingface.co/BSC-LT/salamandra-2b-instruct) — LLM español/multilingüe entrenado desde cero en MareNostrum 5; referencia de datos/tokenizer para español (vocab más grande que el óptimo AR-first).
