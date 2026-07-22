# Pretraining de LLMs desde cero en 2026: estado del arte y costos reales

## Resumen ejecutivo

Entrenar un LLM chico "de cero" en 2026 es más barato que nunca en términos de *compute puro*, pero eso no es lo mismo que producir un modelo *usable* en español rioplatense con calidad conversacional aceptable para chicos. Karpathy demostró con **nanochat** (oct. 2026) que se puede llegar a un ChatGPT-mini funcional por ~USD 100-1000 en un nodo 8xH100, pero el resultado es un modelo tipo GPT-2 (1.9B params) entrenado casi enteramente en inglés (FineWeb), con calidad muy por debajo de un asistente comercial. Los recipes abiertos más relevantes para "chico + conversacional" son **SmolLM2** (HuggingFace), que demuestran que "overtrainear" masivamente (2T tokens para un modelo de 135M, ~15,000 tokens/parámetro, muy por encima del ratio Chinchilla-óptimo de ~20:1) es la estrategia correcta cuando el objetivo es inferencia barata en dispositivos chicos — exactamente el caso de Simón en Android de gama baja. El costo de alquiler de GPU bajó fuerte: H100 spot/neocloud ronda USD 1.5-3/hora (RunPod, Lambda, SFCompute), A100 ~USD 1.4-2/hora, RTX 4090 ~USD 0.35-0.70/hora. Con el presupuesto de USD 10.000 de MaatWork, pretrenar un modelo tipo SmolLM2-135M/360M desde cero con un dataset propio en español-rioplatense curado es factible en términos de compute (decenas de miles de GPU-hora equivalentes a pocos miles de dólares en A100/H100 alquilado), pero el cuello de botella real no es el compute: es el dataset de calidad en español rioplatense conversacional apto para chicos, que no existe curado en ningún corpus abierto. La RTX 3060 12GB local sirve para prototipar arquitectura/tokenizer/pipeline a escala toy (decenas de millones de parámetros, cientos de millones de tokens) pero no para el entrenamiento final de producción — para eso conviene alquilar GPU cloud puntualmente. La recomendación de la industria (y la más defendible con 1 persona y USD 10k) es NO pretrenar 100% desde cero como primera apuesta: empezar de una base abierta chica (SmolLM2-135M/360M o similar) y hacer continued pretraining + fine-tuning intensivo en corpus rioplatense propio, reservando el pretraining puro desde cero como experimento de laboratorio secundario una vez que el pipeline y el dataset estén maduros.

## Hallazgos

### 1. nanoGPT y modded-nanoGPT: los speedruns de referencia

El **nanoGPT** original de Karpathy es el esqueleto minimalista (~300 líneas) que sirvió de base para todo lo que vino después. **modded-nanoGPT** (Keller Jordan, GitHub `KellerJordan/modded-nanogpt`) es un fork mantenido como *speedrun* competitivo: el objetivo es llegar a una validation loss de referencia (3.28 en el récord histórico, equivalente al nivel del GPT-2 de 124M de Karpathy) en el menor tiempo/wall-clock posible sobre 8xH100. Según DeepWiki y el worklog de Tyler Romero, los récords actuales (2026) están en el orden de **sub-90-100 segundos** de entrenamiento puro en 8xH100, procesando del orden de 400-500M tokens (muy por debajo de los 10B tokens del baseline original), con throughput de ~543K tokens/segundo por GPU (DeepWiki, consultado jul. 2026). Esto es relevante como benchmark de *ingeniería de entrenamiento* (kernels, optimizadores tipo Muon, arquitectura), no como receta de producto: el modelo resultante es un GPT-2-124M en inglés, sin instruction-tuning ni safety.

### 2. nanochat de Karpathy: el "ChatGPT por $100" — specs exactas

Publicado en GitHub (`karpathy/nanochat`) el 13 de octubre de 2026, con >42.900 stars a la fecha de esta investigación. Es el proyecto más directamente relevante como *plantilla de pipeline completo* (tokenizer en Rust, pretraining transformer sobre FineWeb, SFT, RL opcional con GRPO, servidor web), ~8.000 líneas de código, licencia MIT.

- **Tier "$100"**: nodo 8xH100 alquilado (~USD 24/hora), corrida de **~4 horas** vía `speedrun.sh` → un modelo tipo GPT-2 (~1.9B parámetros según el fetch del README) con calidad de "kindergartener hablando": sabe historias simples, algo de razonamiento básico, muy limitado en general.
- **Tier "$300"** y **tier "$1000"** (42 horas): mejoran a nivel "puede resolver problemas de matemática y código básicos" pero siguen lejísimos de un asistente comercial.
- **Récord de leaderboard** al 14 de marzo de 2026: 1.65 horas para alcanzar val BPB 0.718, CORE score 0.2626 (target GPT-2: 0.2565).
- **Hardware mínimo real**: single-GPU funciona pero ~8x más lento; se recomienda GPU con ≥80GB VRAM para batch sizes razonables (es decir, una RTX 3060 12GB *no* corre esto en tiempos razonables sin reducir drásticamente el modelo).
- Dataset: FineWeb + ClimbMix (NVIDIA), **en inglés**. No hay variante en español publicada por Karpathy.
- Comparación histórica: el GPT-2 original de OpenAI (2019) costó ~USD 43.000 en compute — la caída de costo en 6-7 años es de ~2 órdenes de magnitud.

Conclusión clave: nanochat es un *tour de force* de ingeniería y un pipeline reusable, pero como producto conversacional está muy por debajo de lo que Simón necesita hoy (que ya corre DeepSeek vía gateway). Es útil para MaatWork como plantilla de infraestructura de entrenamiento (tokenizer, loop de pretraining, SFT), no como fuente del modelo final.

### 3. SmolLM / SmolLM2: el recipe abierto más relevante para "chico + overtrained"

HuggingFace publicó el corpus, la config y el paper completos.

- **SmolLM (v1)**: 135M y 360M entrenados con **600B tokens** del SmolLM-Corpus (Cosmopedia v2 sintético 28B tokens + FineWeb-Edu 220B tokens dedupe + Stack-Edu-Python 4B tokens); el de 1.7B con **1T tokens**. Contexto 2048, tokenizer 49.152 vocab, GQA + diseño "depth-over-width" en los modelos chicos (blog HuggingFace, `huggingface.co/blog/smollm`).
- **SmolLM2** (paper arXiv 2502.02737, "SmolLM2: When Smol Goes Big"): el 135M se entrenó con **2 billones (2T) de tokens** — esto implica un ratio tokens/parámetro de **~15.000:1**, muy por encima del óptimo Chinchilla (~20:1). Es el ejemplo canónico citado en la literatura reciente de "overtraining deliberado" para modelos que van a correr con compute de inferencia limitado (edge, móvil): se paga mucho más compute de entrenamiento a cambio de un modelo final más chico y capaz por parámetro.
- Ninguna fuente consultada especifica GPU-horas ni costo en USD del entrenamiento de SmolLM2 — HuggingFace no lo publicó explícitamente en el blog ni en el paper (dato no verificado, a estimar por proxy vía FLOPs).
- Licencia: Apache 2.0 (modelos y pesos en HF Hub).

Implicación de diseño: la estrategia SmolLM2 —dataset curado de alta densidad educativa + overtraining agresivo relativo a Chinchilla— es exactamente el patrón que MaatWork debería copiar, adaptado a corpus conversacional en español rioplatense, si el objetivo es un modelo que corra en celulares de 2-4GB RAM.

### 4. TinyLlama: referencia de costo en A100 para escala ~1.1B

`jzhang38/TinyLlama` (GitHub) pretrainea un Llama de 1.1B sobre 3T tokens.

- **3.456 A100-GPU-horas** para 300B tokens (cifra citada en el propio repo/paper) → escalado lineal, ~34.560 A100-horas para los 3T tokens completos.
- Cronograma real: 90 días con 16x A100-40GB, o ~4 semanas con 64x A100 (8 nodos).
- Throughput: ~24.000 tokens/s por A100-40GB.
- Dato adicional relevante para Simón: una versión **Chinchilla-óptima** de TinyLlama (1.1B params, 22B tokens, ratio ~20:1) se puede entrenar en **32 horas con 8x A100** — esto es una cota inferior mucho más barata y es el punto de comparación correcto si MaatWork decide *no* overtrainear.

Con precios 2026 (~USD 1.4-2/hora A100 on-demand, ver sección 6), ese experimento Chinchilla-óptimo de TinyLlama-escala (8x A100 x 32h ≈ 256 GPU-horas) costaría **~USD 360-510** — totalmente dentro del presupuesto de laboratorio.

### 5. torchtitan y litgpt: los frameworks de producción vs. los educativos

- **torchtitan** (Meta/PyTorch, paper arXiv 2410.06511): framework nativo de PyTorch para pretraining de LLM a escala de producción, con paralelismo 3D/4D (data + tensor + pipeline + context parallelism), FSDP, Float8 training, checkpointing eficiente, e integración con TorchAO/TorchTune/Axolotl y stacks de serving (HF, vLLM, SGLang, ExecuTorch). Mejoras de throughput reportadas: +65% en Llama 3.1 8B (128 GPUs), +30% en 405B (512 GPUs). Es la herramienta correcta para escalar *más allá* de un solo nodo, pero es overkill/complejidad innecesaria para un equipo de 1 persona con 1 RTX 3060 + alquiler puntual de GPU — su target es multi-nodo.
- **litgpt** (Lightning AI, GitHub `Lightning-AI/litgpt`): 20+ arquitecturas con recipes YAML validados para pretrain/finetune/deploy, implementación "from-scratch sin abstracciones", soporte Flash Attention, FSDP, LoRA/QLoRA. Tiene un recipe explícito `debug.yaml` para pretrainear un Pythia de **14M parámetros sobre TinyStories** — el punto de entrada más chico documentado, ideal para validar pipeline en la RTX 3060 local antes de escalar. También trae `pretrain_tinyllama.md`, receta reproducible del TinyLlama completo.

Para MaatWork: litgpt es el framework de "primer día" (recipes simples, corre en 1 GPU, YAML config, sin necesidad de multi-nodo); torchtitan solo se vuelve relevante si el laboratorio escala a multi-GPU/multi-nodo en fases posteriores.

### 6. Precios de GPU cloud en 2026: números concretos

Basado en múltiples comparadores de precios de julio 2026 (IntuitionLabs, Spheron, SynpixCloud, gpuperhour.com, ThunderCompute):

| GPU | Proveedor | Precio/hora (on-demand) |
|---|---|---|
| H100 SXM | RunPod | ~USD 2.69 |
| H100 PCIe | RunPod | ~USD 1.99 |
| H100 SXM | Lambda Labs | ~USD 2.99 |
| H100 | Vast.ai (marketplace, spot-like) | ~USD 1.87, bajando a <1.60 en picos de oferta |
| H100 SXM5 | SFCompute (cluster market) | USD 1.64-1.75 (zona Richmond), hasta USD 5.00 en zonas de alta demanda (Yerba) |
| H100 (rango de mercado general) | varios | USD 1.49 - 6.98/hora (spread 2026 según IntuitionLabs) |
| A100 80GB | RunPod | ~USD 1.39-1.99 |
| A100 (rango general) | varios | ~USD 1.99-2.50 |
| RTX 4090 | RunPod Community Cloud | ~USD 0.34 (Secure Cloud ~USD 0.69) |

Nota de fuente: SFCompute no confirmó un número único fijo — su modelo es un mercado de clusters con precio spot que varía por zona/demanda; el rango 1.64-1.75 USD/GPU-hora es representativo del período feb-mar 2026 en la zona más barata.

### 7. ¿Qué es factible con USD 10.000?

Con los precios de arriba, USD 10.000 equivalen aproximadamente a:
- **~5.000-6.700 H100-horas** (a USD 1.5-2/hora spot/neocloud) — suficiente para decenas de corridas nanochat-tier-$1000, o un pretraining serio de un modelo 360M-1B con cientos de miles de millones de tokens propios.
- **~5.000-7.000 A100-horas** (a USD 1.4-2/hora) — más que suficiente para replicar un TinyLlama Chinchilla-óptimo (256 GPU-horas, ~USD 400) **y además** dejar margen grande para iterar dataset/hiperparámetros varias veces, o escalar a un régimen overtrained tipo SmolLM2 en un modelo de 135-360M con un corpus rioplatense propio (si ese corpus llega a cientos de miles de millones de tokens, lo cual es el verdadero desafío, no el compute).
- **~15.000-28.000 horas de RTX 4090** — irrelevante como cifra bruta porque el cuello de botella pasa a ser VRAM (24GB) y ancho de banda inter-GPU si se necesita multi-GPU, pero deja mucho margen para prototipar y para fine-tuning/SFT posteriores baratos.

En criollo: **el dinero alcanza de sobra para el compute de pretraining de un modelo 135M-1B**, incluso con margen para overtraining agresivo. El verdadero techo de presupuesto no es GPU-horas, es tiempo de 1 persona para curar/limpiar/etiquetar un corpus conversacional en español rioplatense apto para chicos de calidad suficiente (no existe ese dataset armado en ningún lado — hay que construirlo).

### 8. ¿Pretrenar desde cero o partir de una base abierta?

Ningún paper ni recipe consultado recomienda pretraining 100% desde cero como primera opción cuando el objetivo es un producto (no un experimento de investigación). El patrón que emerge de nanochat, SmolLM2 y TinyLlama es: **arquitectura simple + dataset curado + mucho volumen de tokens del dominio target > arquitectura sofisticada con poco dato de dominio**. Para MaatWork esto sugiere dos caminos no excluyentes:

1. **Camino rápido (recomendado primero)**: tomar SmolLM2-135M o 360M (Apache 2.0, pesos abiertos en HF) y hacer *continued pretraining* (más tokens, esta vez en español rioplatense) + SFT intensivo con datos conversacionales propios curados para chicos + los guardrails existentes de Simón. Esto reutiliza toda la ingeniería de arquitectura/tokenizer ya validada y concentra el presupuesto/tiempo en el dataset y en el fine-tuning, que es donde está el verdadero valor diferencial de MaatWork.
2. **Camino de laboratorio (en paralelo, más lento)**: usar la RTX 3060 12GB local + litgpt (recipe `debug.yaml`/Pythia-14M o similar) para prototipar un pretraining 100% desde cero en escala toy (10-50M params, cientos de millones de tokens en español), validar tokenizer propio en rioplatense y pipeline de datos, y recién después escalar esa receta validada a GPU cloud alquilada (A100/H100) para un modelo de producción 135M-1B. Este camino tiene valor estratégico (independencia total, IP propia, know-how de "laboratorio de modelos propios") pero es más lento y no debería bloquear el reemplazo de proveedor comercial en el corto plazo.

### 9. ¿Qué corre en la RTX 3060 12GB local?

Con 12GB de VRAM, sin optimizaciones agresivas, el estimado razonable (proxy vía reglas de memoria de activaciones + optimizador Adam en fp16/bf16, ya que ninguna fuente consultada dio una cifra oficial para pretraining desde cero en 3060 específicamente) es:

- Pretraining desde cero: modelos de **hasta ~50-125M parámetros** con batch size chico y gradient accumulation, usando frameworks como litgpt o nanoGPT/modded-nanoGPT adaptados a 1 GPU. Referencia análoga verificada: un BERT-style ("DitBERT") entrenado desde cero en una sola RTX 3060 tomó **21 días** (Medium, Martin Dittgen) — cifra real que sirve de ancla de expectativas: en un solo GPU de gama consumer, entrenar desde cero es lento incluso para modelos chicos, y no es la ruta para producción, solo para prototipo/aprendizaje del pipeline.
- Fine-tuning/SFT de modelos ya pre-entrenados de hasta ~7-9B en cuantización (Q4) corre razonablemente en 3060 12GB (esto es inferencia/fine-tuning, no pretraining) — dato de referencia de guías de hardware 2026 (Hardware Corner, ModelFit.io), relevante si el camino elegido es partir de una base abierta.

## Implicaciones para Simón-MaatWork

1. **No reemplazar el proveedor comercial directamente por un pretraining-desde-cero puro** como primer movimiento: el riesgo de degradar calidad conversacional (y por extensión los guardrails que dependen de que el modelo entienda contexto e intención) es alto si se apuesta todo a un modelo nuevo sin corpus rioplatense maduro. La ruta de menor riesgo es continued-pretraining/SFT sobre una base abierta chica (SmolLM2 135M/360M, Apache 2.0) con foco total en dataset conversacional en español rioplatense para chicos.
2. **El presupuesto de USD 10.000 alcanza de sobra para el compute** (miles de GPU-horas A100/H100 a precios spot/neocloud 2026: ~USD 1.4-2/hora A100, ~USD 1.5-3/hora H100). El cuello de botella real es el dataset propio, no el dinero de GPU — conviene invertir tiempo/presupuesto en curaduría y etiquetado de datos conversacionales argentinos aptos para infancia antes que en más GPU-horas.
3. **La capa de seguridad de Simón (regex determinística + cascada de moderación) es independiente del modelo generador** y debe seguir corriendo igual sin importar qué LLM propio se use — cualquier modelo MaatWork nuevo entra "detrás" de esa cascada existente, nunca la reemplaza ni la bypassea. Esto es coherente con la arquitectura actual (sin streaming, modera antes de mostrar).
4. **La RTX 3060 12GB local es la herramienta correcta para el camino de laboratorio**: prototipar tokenizer en rioplatense, validar pipeline de datos, y entrenar toy models (≤50-125M params) para aprender el proceso — no para el entrenamiento final de producción, que conviene alquilar puntualmente en RunPod/Vast.ai/SFCompute (A100 a ~USD 1.4-2/hora es el mejor punto precio/simplicidad para un equipo de 1 persona; H100 solo si se necesita velocidad para iterar rápido).
5. **Estrategia de overtraining tipo SmolLM2 (muy por encima de Chinchilla-óptimo) es la correcta para el target de Simón**: el objetivo final es correr en Android 2-4GB RAM y navegador, así que conviene aceptar un entrenamiento más caro (más tokens por parámetro) a cambio de un modelo final chico (100M-1B) y barato de servir/inferir en el edge — exactamente el patrón que HuggingFace validó con SmolLM2-135M a 2T tokens (~15.000 tokens/parámetro).
6. **litgpt es el framework recomendado para empezar** (recipes YAML simples, corre en 1 GPU, sin abstracciones raras); torchtitan queda para una fase posterior si el laboratorio escala a multi-GPU real, lo cual con 1 RTX 3060 + alquiler puntual no es el escenario inmediato.
7. Ningún dato de costo/GPU-horas específico de SmolLM2 fue confirmado en las fuentes oficiales consultadas (HuggingFace no lo publicó) — si se necesita ese número exacto para presupuestar, habría que estimarlo por FLOPs (6ND, N=135M, D=2T) y contrastarlo contra throughput real de A100/H100, no asumirlo de memoria.

## Fuentes

- [karpathy/nanochat — GitHub](https://github.com/karpathy/nanochat) — jul. 2026 (vía WebFetch). Specs exactas: costo $100/$300/$1000, hardware 8xH100, récord leaderboard 14-mar-2026, dataset FineWeb+ClimbMix, licencia MIT.
- [Nanochat: Build Your Own ChatGPT for $100 — emelia.io](https://emelia.io/hub/nanochat-karpathy) — 2026, contexto de lanzamiento y costo por hora del nodo.
- [Andrej Karpathy Launches 'nanochat' — CXO Digitalpulse](https://www.cxodigitalpulse.com/andrej-karpathy-launches-nanochat-an-open-source-chatgpt-style-model-training-pipeline/) — 2026, cobertura de lanzamiento (13 oct. 2026).
- [KellerJordan/modded-nanogpt — DeepWiki, Experimental Results](https://deepwiki.com/KellerJordan/modded-nanogpt/10-experimental-results) — 2026, récords de speedrun, throughput por GPU, tokens hasta val loss 3.28.
- [NanoGPT Speedrun Living Worklog — Tyler Romero](https://www.tylerromero.com/posts/nanogpt-speedrun-worklog/) — progreso histórico del speedrun.
- [HuggingFaceTB/SmolLM2-135M-Instruct — Hugging Face](https://huggingface.co/HuggingFaceTB/SmolLM2-135M-Instruct) — ficha del modelo, tokens de entrenamiento (2T), dataset.
- [SmolLM2: When Smol Goes Big — arXiv 2502.02737](https://arxiv.org/html/2502.02737v1) — paper con detalle de dataset y recipe de entrenamiento data-centric.
- [SmolLM — blazingly fast and remarkably powerful — HuggingFace blog](https://huggingface.co/blog/smollm) — (vía WebFetch) composición exacta del corpus SmolLM v1 (Cosmopedia v2 28B, FineWeb-Edu 220B, Stack-Edu-Python 4B), arquitectura, tokenizer 49152 vocab, contexto 2048.
- [TinyLlama — GitHub jzhang38/TinyLlama](https://github.com/jzhang38/TinyLlama) — 3456 A100-GPU-horas / 300B tokens, cronograma 90 días con 16x A100, throughput 24K tok/s por A100.
- [TinyLlama en Lightning AI templates](https://lightning.ai/lightning-ai/templates/pretrain-llms-tinyllama-1-1b) — receta reproducible, referencia de recipe Chinchilla-óptimo (22B tokens / 32h / 8x A100).
- [torchtitan — arXiv 2410.06511](https://arxiv.org/pdf/2410.06511) — paralelismo 3D/4D, Float8, mejoras de throughput por escala.
- [Lightning-AI/litgpt — GitHub](https://github.com/Lightning-AI/litgpt/) — recipes YAML, debug.yaml (Pythia-14M/TinyStories), tutorial pretrain_tinyllama.md.
- [H100 Rental Prices Compared — IntuitionLabs](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison) — 2026, rango USD 1.49-6.98/hora across 15+ providers.
- [Cloud GPU Pricing 2026 — SynpixCloud](https://www.synpixcloud.com/blog/cloud-gpu-pricing-comparison-2026) — A100 desde USD 1.99/hr, H100 desde USD 3.29/hr.
- [RunPod GPU Cloud Pricing 2026 — gpuvec.com](https://gpuvec.com/providers/runpod) — H100 PCIe USD 1.99/hr, A100 80GB ~USD 1.39/hr, RTX 4090 Community USD 0.34/hr.
- [SF Compute — Prices](https://sfcompute.com/prices) — pricing de mercado por zona, H100 SXM5 USD 1.64-1.75/hr (Richmond) hasta USD 5.00 (Yerba), feb-mar 2026.
- [Training a BERT Model from Scratch on a Single Nvidia RTX 3060 — Medium, Martin Dittgen](https://medium.com/@martin.p.dittgen/training-a-bert-model-from-scratch-on-a-single-nvidia-rtx-3060-1a7a2b1039a5) — referencia real de tiempo de entrenamiento desde cero en 3060 (21 días, BERT-style).
- [Training Compute-Optimal Large Language Models — arXiv 2203.15556 (Chinchilla)](https://arxiv.org/abs/2203.15556) — ratio óptimo ~20 tokens/parámetro, base teórica para contrastar overtraining.
