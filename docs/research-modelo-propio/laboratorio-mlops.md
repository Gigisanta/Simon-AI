# Laboratorio de entrenamiento de LLMs propios — equipo de 1, RTX 3060 12GB, USD 10.000/año

## Resumen ejecutivo

Con una RTX 3060 12GB local, USD 10.000 anuales y una sola persona, el diseño 2026 más sensato es **local para iteración + cloud spot para corridas grandes**, sin comprar una segunda GPU física. El stack recomendado es: **trackio** (HF, gratis, local-first, SQLite) para tracking en vez de W&B; **HF datasets con revisiones + DVC solo si hace falta pipeline de datos versionado**; **Hugging Face Hub PRO** (USD 9/mes, 1TB privado) como registro central de modelos/datasets; **nanochat** (Karpathy, MIT) como base hackeable de pretraining pequeño y **HF Trainer/TRL** para fine-tuning/SFT/DPO sobre modelos ya pre-entrenados; **RunPod/Vast.ai spot con 4090 u 8xH100** para las corridas que no entran en la 3060; y un **gate de eval automático** (suite chica y curada, no LLM-judge caro) antes de promover cualquier checkpoint a producción, corriendo en CI tipo GitHub Actions. Backup de checkpoints en **Backblaze B2** (10-20x más barato que S3, egress gratis vía Cloudflare) con espejo en HF Hub privado para los checkpoints "buenos". Con este diseño, 10-30 fine-tunings chicos + 1-3 pretrainings entran cómodos en el presupuesto anual, dejando margen para imprevistos y quizás una GPU usada más adelante si el volumen de cómputo lo justifica en vez de gastarlo todo en cloud por adelantado.

## Hallazgos

### 1. Experiment tracking: trackio gana para equipo de 1

Weights & Biases sigue siendo gratis para uso personal, pero limita a 3 runs concurrentes y storage privado acotado; el free académico da mucho más (200GB, Weave 25GB/mes) pero requiere email institucional sin fines de lucro — no aplica a MaatWork como empresa ([wandb.ai/site/pricing](https://wandb.ai/site/pricing/), consultado jul 2026). Planes pagos arrancan en USD 50/user/mes.

**Trackio** (Hugging Face, lanzado 29 julio 2025) es la alternativa que más sentido tiene: API drop-in compatible con `wandb.init/log/finish` (cambiás un import), corre local con SQLite por defecto, o sincroniza gratis a un HF Space con backup automático a un HF Dataset cada 5 minutos. Es gratis, código base <1000 líneas (auditable), pero está en beta y le faltan artifact management y visualizaciones complejas ([huggingface.co/blog/trackio](https://huggingface.co/blog/trackio), fetch directo jul 2026).

**MLflow** es un framework de ciclo de vida completo (tracking + registry + serving), más pesado para un lab de 1 persona; su UI se pone lenta con cientos de runs. **Aim** es local-first, más liviano, maneja miles de métricas fluido y es open-source, pero las features de colaboración están detrás de plan pago (irrelevante para 1 persona) ([github.com/aimhubio/aim](https://github.com/aimhubio/aim); comparación en aimstack.io, jul 2026).

**Recomendación**: trackio para el día a día (gratis, cero fricción, integra con HF ecosystem donde vas a vivir de todos modos); Aim como fallback si trackio (beta) da problemas.

### 2. Reproducibilidad: config-as-code + HF revisions, DVC opcional

Los repos de HF Hub versionan datasets con revisiones semánticas automáticas al publicar, y el hub en sí es git-backed (commits, branches, tags) — para un dataset propio que cambia poco (correcciones de shape, no un pipeline ETL complejo), esto alcanza sin herramienta adicional. **DVC** sigue siendo el estándar cuando el pipeline de datos es multi-etapa (raw → limpieza → augmentación → split) y necesitás versionar cada etapa junto con el código que la generó, con soporte a S3/B2 como remote ([doc.dvc.org/user-guide](https://doc.dvc.org/user-guide); comparación en medium.com/@haziqa5122, jul 2026). Ambos son complementarios, no excluyentes: DVC para el pipeline, HF revisions para la distribución final. Config-as-code (Hydra/OmegaConf o simplemente YAML + argparse) y seeds fijos son tabla stakes, no requieren herramienta nueva.

**Recomendación**: empezar con solo Git + HF dataset revisions + configs YAML versionados; agregar DVC recién si el pipeline de preprocesamiento de datos en español rioplatense crece a múltiples etapas reproducibles.

### 3. Hugging Face Hub: organización y precios 2026

PRO sigue en **USD 9/mes** (may 2026), incluye 1TB de storage privado (10x el free tier) y 10TB público; storage privado extra se factura en bloques de 1TB a USD 18/TB/mes. También trae cuota ampliada de ZeroGPU (hasta 25 min/día de H200) — útil para demos rápidas sin gastar cómputo propio ([eesel.ai/blog/hugging-face-pricing](https://www.eesel.ai/blog/hugging-face-pricing); huggingface.co/docs/hub/en/billing, jul 2026). Para un lab de 1 persona con modelos 100M-2B (checkpoints de pocos GB cada uno), 1TB privado alcanza largo. Organización sugerida: una org privada `maatwork-lab` en HF con repos separados `modelo-base-XXXm`, `modelo-sft-simon-v1`, `dataset-conversaciones-rioplatense-v1`, usando branches/tags de HF para marcar checkpoints promovidos vs experimentales.

### 4. Stack de entrenamiento 2026 para 100M-2B parámetros

- **nanochat** (Andrej Karpathy, licencia MIT): "harness más simple para entrenar LLMs", PyTorch puro, tokenizer BPE estilo GPT-4, pensado para un nodo único de 8xH100/A100 pero con un solo parámetro (`--depth`) que controla la escala del modelo — perfecto como base hackeable para una "miniserie" de modelos chicos. Un speedrun completo a calidad GPT-2 cuesta ~USD 48 on-demand o ~USD 15 en spot (2hs en 8xH100 a ~USD 24/h) ([github.com/karpathy/nanochat](https://github.com/karpathy/nanochat), fetch directo jul 2026). Record actual del leaderboard: 1.65hs, CORE score 0.2626.
- **TorchTitan**: la vía recomendada 2026 para escalar pretraining a multi-nodo/miles de GPUs (paralelismo 4D nativo de PyTorch) — sobredimensionado para un lab de 1 persona con presupuesto de 10k, salvo que se planee escalar mucho ([arxiv.org/abs/2410.06511](https://arxiv.org/abs/2410.06511)).
- **LitGPT**: posicionado para uso "productivo" más que experimental — capas de abstracción más gruesas que nanochat.
- **HF Trainer/TRL**: la vía canónica para fine-tuning/SFT/DPO/GRPO post-pretraining, bien integrado con el ecosistema HF Hub. No está optimizado para velocidad como Unsloth (2-5x más rápido, 50-70% menos VRAM), pero es el estándar y compatible con QLoRA en 12GB VRAM (RTX 3060) para modelos de hasta ~8B con LoRA — para modelos de 100M-2B target de Simón, la RTX 3060 sola alcanza para fine-tuning completo (no solo LoRA) sin problema ([futureagi.com/blog/llm-fine-tuning-guide-2025](https://futureagi.com/blog/llm-fine-tuning-guide-2025/); discuss.huggingface.co, jul 2026).

**Recomendación concreta**: usar **nanochat como base de pretraining** (fork y adaptar tokenizer/dataset a español rioplatense, correr con `--depth` bajo para 100M-500M), y **HF Trainer/TRL** para todo el fine-tuning conversacional posterior (SFT + preferencia) sobre esos checkpoints. torchtitan queda "para después" si el lab escala.

### 5. Hardware: no comprar segunda GPU todavía

RTX 3090 24GB usada cotiza en 2026 en un rango amplio: reportes van de USD 700-1000 (promedio bajo) a USD 1200-1900 según vendedor/condición, con un promedio de mercado ~USD 1254 en julio 2026 según un tracker (319 listings) ([gpudojo.com/rtx-3090](https://gpudojo.com/rtx-3090); accio.com, jul 2026 — rango amplio, tomar con pinza por variabilidad de fuentes). Comprar una 3090 usada (~USD 1000-1300) da 24GB adicionales pero es un gasto fijo hundido, sin garantía, y compite contra el mismo presupuesto que podría pagar cientos de horas de spot cloud. Para un lab de 1 persona que recién arranca (validando arquitectura, dataset, tokenizer), **no conviene comprometer 10-15% del presupuesto anual en una GPU usada de generación anterior** cuando el spot cloud da acceso a H100/A100 sin riesgo de hardware muerto. Reevaluar la compra solo si el volumen de horas-GPU mensual sostenido hace que cloud spot supere el costo de la 3090 en <6 meses.

### 6. Precios cloud 2026 (spot y on-demand)

| Proveedor | GPU | On-demand | Spot | Fuente |
|---|---|---|---|---|
| RunPod (Community) | RTX 4090 | $0.69/hr | 50-80% menos | gpucost.org, jul 2026 |
| RunPod | A100 80GB | $1.39-1.49/hr | — | thundercompute.com, jul 2026 |
| RunPod | H100 80GB | $2.89/hr | — | gpucost.org, jul 2026 |
| Vast.ai | RTX 4090 | $0.29-0.59/hr (mkt) | desde $0.16/hr | synpixcloud.com, abr 2026 |
| Vast.ai | H100 80GB SXM | $1.89-2.01/hr (verified) | — | spheron.network, jul 2026 |
| Lambda Labs | A100 80GB | $1.29-2.49/hr (fuentes discrepan) | sin spot | gpucost.org / synpixcloud.com, may 2026 |
| Lambda Labs | H100 | $2.99-4.29/hr (fuentes discrepan) | sin spot | gpucost.org, may 2026 |

Nota de escepticismo: los agregadores de pricing GPU cloud dan cifras algo distintas entre sí para el mismo proveedor (ej. Lambda A100 entre $1.29 y $2.49/hr) — son sitios de comparación de terceros, no la fuente oficial de cada proveedor, así que conviene chequear el pricing page real antes de comprometer presupuesto. Vast.ai (marketplace P2P) es consistentemente el más barato pero con mayor variabilidad de confiabilidad; RunPod es el punto medio razonable entre precio y estabilidad; Lambda no ofrece spot.

### 7. CI/gate para checkpoints: patrón de labs chicos

El patrón que reportan labs chicos en 2025-2026 no es "un LLM-judge caro en cada PR", sino: **chequeos determinísticos + una suite curada chica (decenas de ejemplos reales y difíciles, no miles sintéticos) corriendo en cada checkpoint candidato**, con el LLM-judge/sweep completo reservado para corridas nightly contra un dataset versionado, y gating estadístico pareado con rollback automático en canary ([futureagi.com/blog/ci-cd-llm-eval-github-actions-2026](https://futureagi.com/blog/ci-cd-llm-eval-github-actions-2026/), jul 2026). Herramientas open-source viables sin costo de licencia: DeepEval o Ragas para el harness de eval + Promptfoo para testing de prompts, corriendo en GitHub Actions. Para Simón esto se traduce directo: la suite de gate ya existente (225 casos, según memoria del proyecto) es exactamente el patrón correcto — expandirla con casos específicos de regresión de guardrails de seguridad infantil (crisis, contenido inapropiado) como bloqueantes duros antes de promover cualquier checkpoint propio a producción, nunca reemplazando la capa regex determinística existente.

### 8. Almacenamiento y backup de checkpoints

Backblaze B2 es ~4x más barato que S3 Standard en storage puro (~$6/TB/mes vs ~$23/TB/mes) y regala egress hasta 3x el storage promedio mensual, con egress ilimitado gratis vía Cloudflare como CDN — relevante si los checkpoints se sirven o se descargan seguido ([backblaze.com/cloud-storage/pricing](https://www.backblaze.com/cloud-storage/pricing), jul 2026). Para un lab de 1 persona: B2 como backup frío de todos los checkpoints (raw), y HF Hub privado (dentro del 1TB de PRO) como registro "curado" de los checkpoints que pasaron el gate — evita pagar dos veces por el mismo TB y aprovecha que HF Hub ya es donde vive el resto del workflow.

### 9. Deploy en dispositivos de gama baja (contexto para el objetivo final)

Aunque no era el foco directo del research, es relevante para validar que el target de 100M-2B es realista: en 2026, modelos ~1B cuantizados a Q4_K_M corren cómodos en 4GB RAM (Gemma 3 1B, ~720MB en disco) vía llama.cpp/GGUF, con integración manual JNI/NDK en Android pero máxima flexibilidad de modelo ([localaimaster.com/blog/small-language-models-guide-2026](https://localaimaster.com/blog/small-language-models-guide-2026); f22labs.com, jul 2026). Esto confirma que el rango 100M-2B elegido para MaatWork es coherente con hardware Android gama baja argentino (2-4GB RAM) si se apunta al extremo bajo (100-500M) para los dispositivos más limitados y se reserva ~1-2B para dispositivos con más RAM o para el navegador vía WebLLM/WASM.

## Implicaciones para Simón-MaatWork

1. **No comprar GPU nueva todavía**: la RTX 3060 12GB + cloud spot cubre el rango 100M-2B sin necesidad de una 3090 usada de dudosa procedencia. Reevaluar en 6-12 meses según volumen real de corridas.
2. **nanochat como fork base de pretraining**: adaptar tokenizer a español rioplatense y correr con `--depth` bajo (apuntando a 100M-500M) da un punto de partida MIT, auditable, y ya probado en 8xH100 spot por ~$15-50 la corrida.
3. **HF Trainer/TRL para todo el post-training** (SFT sobre el corpus conversacional de Simón, luego DPO si hace falta alinear tono/seguridad) — corre en la 3060 local para iteración rápida sin gastar cloud.
4. **trackio, no W&B**: gratis, sin límite de runs concurrentes, se integra con el resto del stack HF. Cambiar a Aim solo si trackio (beta) da problemas de estabilidad.
5. **El gate de 225 casos existente es el patrón correcto**, no hace falta reinventarlo con herramientas de LLM-eval pesadas — solo expandirlo con casos de regresión específicos para cada checkpoint propio candidato, y mantenerlo como bloqueante duro antes de cualquier promoción a producción. La capa regex de crisis y la cascada de moderación server-side quedan intactas e independientes del modelo — ningún cambio de modelo debe tocarlas.
6. **Backup en dos capas**: B2 frío para todo, HF Hub privado (dentro de PRO $9/mes) para lo curado/promovido.

## Presupuesto anual estimado (desglose)

Asumiendo 10-30 fine-tunings chicos + 1-3 pretrainings pequeños al año:

| Ítem | Costo estimado anual (USD) |
|---|---|
| HF Hub PRO (organización, $9/mes) | ~110 |
| Cloud spot para pretrainings (1-3 corridas nanochat-style, 8xH100 spot, ~$15-50 c/u) | 50-150 |
| Cloud spot/on-demand para fine-tunings grandes que no entran en 3060 (10-30 corridas, RunPod 4090/A100 spot, 2-6hs c/u a ~$0.5-1.5/hr) | 300-1200 |
| Backblaze B2 (checkpoints + datasets, storage acumulado ~1-2TB creciente) | 100-150 |
| Buffer para eval/CI (GitHub Actions minutos, si se excede el free tier) | 0-100 |
| Imprevistos / experimentación exploratoria / posible compra de GPU usada a fin de año si el volumen lo justifica | 1500-3000 |
| **Total usado** | **~2000-4700 de 10000** |

El presupuesto de 10k rinde con margen amplio incluso siendo generoso en la estimación — el cuello de botella real del lab de 1 persona no va a ser presupuesto sino tiempo humano para curar datos en español rioplatense, iterar en el gate de seguridad, y operar el pipeline. Sobra margen para escalar a más pretrainings o eventualmente sí comprar hardware propio si el patrón de uso lo justifica con datos reales de gasto cloud.

## Fuentes

- [wandb.ai/site/pricing](https://wandb.ai/site/pricing/) (jul 2026) — free tier W&B, límites, plan académico
- [huggingface.co/blog/trackio](https://huggingface.co/blog/trackio) (fetch directo, jul 2026) — trackio: instalación, persistencia, costo, fecha lanzamiento (29 jul 2025), limitaciones
- [github.com/karpathy/nanochat](https://github.com/karpathy/nanochat) (fetch directo, jul 2026) — arquitectura, costo speedrun, licencia MIT, escala vía `--depth`
- [arxiv.org/abs/2410.06511](https://arxiv.org/abs/2410.06511) — TorchTitan, paralelismo 4D, multi-nodo
- [github.com/aimhubio/aim](https://github.com/aimhubio/aim) / aimstack.io blog (jul 2026) — Aim vs MLflow, escalabilidad UI
- [doc.dvc.org/user-guide](https://doc.dvc.org/user-guide) (jul 2026) — DVC, versionado de pipelines de datos
- [huggingface.co/docs/hub/en/billing](https://huggingface.co/docs/hub/en/billing) / eesel.ai/blog/hugging-face-pricing (may 2026) — HF Hub PRO $9/mes, 1TB privado, $18/TB extra
- [futureagi.com/blog/llm-fine-tuning-guide-2025](https://futureagi.com/blog/llm-fine-tuning-guide-2025/) (jul 2026) — TRL vs Unsloth, QLoRA en 12GB VRAM
- [gpucost.org/provider/runpod](https://gpucost.org/provider/runpod), [thundercompute.com/blog/runpod-pricing-vs-thunder-compute](https://www.thundercompute.com/blog/runpod-pricing-vs-thunder-compute) (jul 2026) — pricing RunPod 4090/A100/H100
- [synpixcloud.com/blog/vast-ai-vs-runpod-rtx-4090-pricing](https://www.synpixcloud.com/blog/vast-ai-vs-runpod-rtx-4090-pricing) (abr 2026), [spheron.network/blog/gpu-cloud-pricing-comparison-2026](https://www.spheron.network/blog/gpu-cloud-pricing-comparison-2026/) (jul 2026) — pricing Vast.ai
- [gpucost.org/provider/lambda](https://gpucost.org/provider/lambda), [synpixcloud.com/blog/lambda-labs-gpu-pricing-2026](https://www.synpixcloud.com/blog/lambda-labs-gpu-pricing-2026) (may 2026) — pricing Lambda Labs (cifras discrepantes entre fuentes, marcado como tal)
- [gpudojo.com/rtx-3090](https://gpudojo.com/rtx-3090), [accio.com/business/rtx-3090-price-trend](https://www.accio.com/business/rtx-3090-price-trend) (jul 2026) — precio usada RTX 3090 24GB, rango amplio entre fuentes
- [futureagi.com/blog/ci-cd-llm-eval-github-actions-2026](https://futureagi.com/blog/ci-cd-llm-eval-github-actions-2026/) (jul 2026) — patrón de gate CI para eval de checkpoints
- [backblaze.com/cloud-storage/pricing](https://www.backblaze.com/cloud-storage/pricing) (jul 2026) — B2 vs S3, egress gratis
- [localaimaster.com/blog/small-language-models-guide-2026](https://localaimaster.com/blog/small-language-models-guide-2026), [f22labs.com/blogs/how-to-run-local-llm-on-an-android-phone](https://www.f22labs.com/blogs/how-to-run-local-llm-on-an-android-phone/) (jul 2026) — modelos on-device GGUF/llama.cpp en Android gama baja
