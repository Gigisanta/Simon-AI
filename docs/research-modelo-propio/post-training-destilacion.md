# Post-training y destilación para modelos conversacionales pequeños (2025-2026)

## Resumen ejecutivo

El estado del arte 2025-2026 en post-training para chatbots pequeños convergió en un recipe de tres etapas: (1) **SFT curricular** (razonamiento → respuesta directa) sobre datos sintéticos generados por un modelo grande (*synthetic data distillation*), (2) **destilación on-policy** (el estudiante genera, el profesor puntúa cada token con KL inversa) en vez de SFT clásico off-policy, y (3), solo si hay señal de preferencia verificable, un paso liviano de **DPO/ORPO** o **GRPO** con recompensa por reglas. El hito que reordenó el campo es el post de Thinking Machines Lab (Kevin Lu et al., 27-oct-2025), "On-Policy Distillation", que muestra 9-30x menos cómputo que SFT clásico y ~10x menos que RL puro para igual performance, y que ya tiene soporte de primera clase en TRL v1.0 (`experimental.distillation.DistillationTrainer`, doc actualizada 2026). Para hardware: full fine-tune real (no LoRA) de un modelo 1B es viable en una RTX 3060 12GB solo con optimizador 8-bit + gradient checkpointing + batch chico; a partir de ahí, LoRA/QLoRA siguen siendo la opción de facto para iterar rápido y para cualquier cosa >2B. Herramientas: TRL sigue siendo el estándar "oficial" (integrado a HF, v1.0 desde abril 2026), Unsloth domina velocidad/VRAM en GPU única, Axolotl para multi-GPU productivo, LLaMA-Factory para UI/no-código. Ninguna fuente cuantificó horas/época exactas para 360M-1B con 50k-500k ejemplos en 3060 — es el hueco de conocimiento más importante para Simón: hay que medirlo empíricamente antes de comprometer el plan de laboratorio.

## Hallazgos

### 1. On-policy distillation: el cambio de paradigma 2025

El post seminal (Thinking Machines Lab / Connectionism blog, Kevin Lu, 27-oct-2025) define on-policy distillation como muestrear trayectorias del propio modelo estudiante y hacer que un profesor califique **cada token** de esa trayectoria vía KL inversa — combina "la relevancia on-policy de RL con la señal densa de recompensa de la destilación" ([thinkingmachines.ai/blog/on-policy-distillation](https://thinkingmachines.ai/blog/on-policy-distillation/)).

Comparación cuantitativa citada en el post (modelo Qwen3-8B, benchmark AIME'24):
- SFT off-policy clásico: 60% con ~400K prompts; escalar a 70% se extrapola en ~2M prompts (el estudiante sufre error acumulado porque aprende en estados que el profesor visitó, no los propios).
- RL puro (reporte oficial Qwen3): 67.6% con 17.920 horas-GPU — señal dispersa (bits fijos por episodio).
- On-policy distillation: 74.4% con solo 1.800 horas-GPU — **9-30x más barato** que el SFT extrapolado y ~10x más barato que RL, según el desglose del propio post (9x con dataset amortizado, 18x en horas-GPU paralelizadas, 30x en tarea nueva sin dataset previo).
- Experimento de "personalización" (recuperar capacidad tras mid-training de dominio): el modelo caía de 85% a 79% en IF-eval tras entrenar sobre docs internos; la destilación on-policy recuperó la capacidad general mientras el conocimiento de dominio subía de 18% a 41%.
- Auto-destilación (mismo modelo como profesor de sí mismo tras RL): alcanza el nivel del profesor en 7-10x menos pasos de gradiente, con reducción acumulada de cómputo de 50-100x vs RL.

Por qué gana a SFT en modelos chicos: SFT da señal densa pero fuera de distribución (el estudiante nunca ve sus propios errores durante el entrenamiento); RL da señal on-policy pero muy dispersa (O(1) bits por episodio). On-policy distillation da **O(N) bits por episodio** (N = tokens) y mantiene al estudiante dentro de su propio espacio de estados alcanzable, reduciendo el "exposure bias" — clave para modelos ultra-pequeños que no tienen capacidad de generalizar fuera de distribución como uno grande.

Papers de seguimiento en 2026 confirman y extienden esto pero con matices: "Unmasking On-Policy Distillation: Where It Helps, Where It Hurts, and Why" (arXiv 2605.10889) documenta casos donde no ayuda; "Rethinking on-policy distillation" propone un híbrido de dos etapas (el estudiante genera offline una vez, después se hace destilación de logits clásica sobre esos datos generados) para recuperar eficiencia sin pagar el costo de generación continua.

**Paper directamente aplicable a Simón**: "Revealing the Power of Post-Training for Small Language Models via Knowledge Distillation" (arXiv 2509.26497, openPangu Embedded-1B, profesor 7B, mismo tokenizer). Recipe validado en 1B:
- SFT curricular en dos etapas: primero datos con cadena de razonamiento explícita, después pares pregunta-respuesta directos sin pasos intermedios ("fast-response"), para no sacrificar velocidad de inferencia.
- Destilación "by Student" (offline on-policy: el estudiante genera, después destilación de logits clásica sobre esas secuencias) da +6% vs baseline.
- Ratio de dataset 3:1 razonamiento:no-razonamiento, alta exigencia de filtrado/deduplicación.
- Hiperparámetros reportados: peso de pérdida KD λ=0.9, top-k=10.
- Resultado: 1B iguala competidores de 1.7B (score promedio 63.43) manteniendo eficiencia de edge device.

### 2. TRL v1.0 ya soporta destilación on-policy nativamente (2026)

TRL llegó a v1.0 en abril de 2026, unificando el stack de post-training: `SFTTrainer`, `DPOTrainer`, `KTOTrainer`, `ORPOTrainer`, `GRPOTrainer`, `RewardTrainer` en una sola librería, con un namespace `experimental` para lo más nuevo ([marktechpost.com, 1-abr-2026](https://www.marktechpost.com/2026/04/01/hugging-face-releases-trl-v1-0-a-unified-post-training-stack-for-sft-reward-modeling-dpo-and-grpo-workflows/); [huggingface.co/blog/trl-v1](https://huggingface.co/blog/trl-v1)).

El `DistillationTrainer` (`trl.experimental.distillation`, doc leída directo del repo huggingface/trl, versión v1.9.0) implementa exactamente el paper de Agarwal et al. (GKD, "On-Policy Distillation of Language Models: Learning from Self-Generated Mistakes") con tres optimizaciones de ingeniería sobre GKD clásico:
- **Generation buffer**: desacopla el batch de generación del microbatch de entrenamiento; permite que vLLM batchee muchos prompts en una sola llamada — hasta 40x más rápido.
- **Teacher server**: el profesor puede correr en un servidor vLLM externo (no necesita caber en la misma GPU que el estudiante) — crítico si el profesor es DeepSeek/GPT-grande y el estudiante es el modelo MaatWork de <2B.
- **Payloads binarios**: logprobs empaquetados en arrays NumPy base64 en vez de JSON anidado, ~5x menos transferencia.

Parámetro clave `lmbda`: fracción de datos on-policy (`lmbda=1.0` = totalmente on-policy, el estudiante genera todo; `lmbda=0.0` = off-policy puro sobre dataset fijo). `beta` interpola entre KL directa (0.0) y KL inversa (1.0) vía Generalized JSD. El ejemplo oficial usa exactamente el patrón Simón-relevante: estudiante `Qwen2.5-1.5B-Instruct`, profesor `Qwen2.5-7B-Instruct`, dataset conversacional en formato `messages`. Cuando `lmbda=1.0` ni siquiera hace falta escribir la respuesta del asistente en el dataset — solo el prompt, porque el estudiante genera su propia completion. Soporta LoRA vía flags estándar de `ModelConfig`.

Esto es directamente aplicable a Simón: DeepSeek (o el profesor que se use) como `teacher_model` vía servidor externo, el modelo MaatWork chico como `model`, y destilar con `lmbda=1.0` sobre prompts empáticos/rioplatenses reales o sintéticos.

### 3. SFT: full fine-tune vs LoRA vs QLoRA en modelos <2B

Consenso 2025-2026 (múltiples guías técnicas, ninguna paper primario específico para <2B pero coincidentes): full fine-tuning da 1-3% más accuracy en tareas de dominio que dejarlo con adapters, pero cuesta 10-100x más memoria/tiempo. LoRA logra 95-98% del rendimiento de full FT usando 0.1-1% de los parámetros entrenables. La guía 2026 de Index.dev es explícita: **"para modelos más chicos [que 2B], se usa full fine-tuning con media precisión; para modelos >2B, se recomienda QLoRA"** ([index.dev/skill-vs-skill/ai-lora-vs-qlora-vs-full-finetuning](https://www.index.dev/skill-vs-skill/ai-lora-vs-qlora-vs-full-finetuning)) — es decir, en el rango de Simón (100M-2B) full FT es la opción por defecto recomendada, no LoRA, precisamente porque el modelo entero ya entra en VRAM de consumo. LoRA/QLoRA siguen siendo preferibles solo si se necesitan múltiples variantes/adapters por cliente o experimentación ultra-rápida.

ORPO es la recomendación específica para ≤7B en GPU única: no necesita modelo de referencia ni reward model, un solo modelo en memoria, combinable con LoRA para memoria aún menor ("zero external dependencies: no reward model, no reference model, no paired data, no separate SFT stage" — resultado de búsqueda 2026).

### 4. DPO / ORPO / KTO / GRPO — cuál usar en 2026

No hay ganador único; la recomendación estándar 2026 es secuencial: **QLoRA/full SFT primero → agregar DPO si hay pares de preferencia → cambiar a GRPO si la recompensa es verificable (matemática, código, formato estructurado)**.
- **DPO**: estable, bien entendido, requiere pares de preferencia explícitos. Es el default post-SFT de la mayoría de equipos.
- **ORPO**: mejor elección en GPU única / modelos chicos — fusiona SFT y alineación de preferencia en un solo paso sin modelo de referencia.
- **KTO**: cuando solo hay feedback binario (thumbs up/down) sin pares — misma librería/complejidad que DPO en TRL, pero con etiquetas no emparejadas.
- **GRPO**: para tareas con recompensa verificable por reglas (no aplica directo a "empatía" salvo que se defina un reward model o un juez); elimina el crítico usando ventaja relativa de grupo, memoria más baja que PPO.

Para Simón, dado que "empatía" y "estilo rioplatense" no son verificables por reglas simples, la ruta más natural es SFT + destilación on-policy (imitando al profesor grande) en vez de GRPO; DPO/ORPO serían un paso posterior opcional si se recolectan pares de preferencia humana (ej. dos respuestas del modelo chico, un juez o revisor elige la mejor).

### 5. Herramientas: TRL vs Unsloth vs Axolotl vs LLaMA-Factory (2026)

Comparación de un mismo artículo 2026 (MarkTechPost, 22-jul-2026) y confirmada por otras fuentes independientes:
- **Estrellas GitHub 2026**: LLaMA-Factory 68.4K > Unsloth 53.9K > TRL 17.6K > Axolotl 11.4K.
- **LLaMA-Factory**: más popular en adopción bruta, incluye UI web (LlamaBoard) para lanzar runs sin código; documentación inconsistente.
- **Unsloth**: kernels custom que dan 2-5x más velocidad y 50-70% menos VRAM en GPU única, ideal para LoRA/QLoRA; free tier de Colab alcanza para 7B, un H100 rentado hace 70B en <3h. Ejemplo real: Llama 3.1 8B QLoRA sobre 5.000 conversaciones, pico de 7.2GB VRAM, entrenamiento completo en 90 minutos.
- **Axolotl**: wrapper YAML sobre Transformers/PEFT/TRL/Accelerate/DeepSpeed — la opción para escalar a multi-GPU productivo.
- **TRL**: llegó a v1.0 en abril 2026, es la base "oficial" de HuggingFace que las otras tres herramientas usan por debajo (Unsloth se integra con los trainers de TRL, Axolotl también) — es el estándar de facto para lo más nuevo (como `DistillationTrainer` experimental) antes de que baje a las otras herramientas.

Conclusión práctica: para el laboratorio de Simón, **TRL directo** es la opción correcta porque necesita la feature más nueva (`DistillationTrainer` con teacher server), y **Unsloth** es la capa de aceleración/VRAM para correr eso mismo en la 3060 sin reinventar kernels.

### 6. Full fine-tune en RTX 3060 12GB: qué es realista

Ninguna fuente dio benchmarks exactos de horas/época para 360M-1B con datasets de 50k-500k ejemplos — este es un hueco real, hay que medirlo empíricamente en el propio hardware antes de comprometer un plan. Lo que sí está confirmado:
- Regla de memoria aproximada citada: ~1B parámetros FP32 ≈ 4GB solo de pesos, +4GB de gradientes, +memoria del optimizador (Adam duplica/triplica esto). Con `paged_adamw_8bit` (bitsandbytes) ese costo de optimizador baja drásticamente.
- Técnicas confirmadas y estándar para exprimir 12GB: gradient checkpointing (recompute en vez de guardar activaciones), optimizador 8-bit (`paged_adamw_8bit`), mixed precision bf16/fp16, y para modelos que no entran del todo, offload de optimizador/parámetros vía DeepSpeed ZeRO-3 o FSDP a RAM del host.
- Con estas técnicas combinadas, un modelo de ~1B en full fine-tune (no LoRA) es plausible en una 3060 12GB con batch size chico + gradient accumulation; un 360M es holgado. Esto confirma que el approach de Simón (full FT sobre 100M-2B en la 3060 local) es viable en principio, pero **el número de horas/época real (con 50k-500k ejemplos) no está documentado en ninguna fuente encontrada — recomendación: correr un benchmark propio de 100-500 pasos antes de planificar el calendario del laboratorio**.

### 7. Si el 3060 no alcanza: costo en cloud (precios julio 2026)

- GPUs de entrada (RTX 3060, RTX A4000) en la nube: desde <$0.10/hora.
- A100 80GB: rango $1.09-$5.07/hora (mejor relación costo-rendimiento para fine-tuning según consenso de las fuentes).
- H100 80GB: rango $1.40-$11.06/hora (varía mucho por proveedor; ejemplo citado $1.49-$6.98/hr en 15+ proveedores).
- GPUs de rango medio (RTX 4090, L40S, A100 40GB, 24-48GB VRAM): $0.50-$2.50/hora, suficientes para modelos medianos.
Fuente: agregadores de precios 2026 (CloudZero, Thunder Compute, aimultiple GPU index, IntuitionLabs) — todos fechados julio 2026. Para un modelo <2B, incluso una sesión de destilación on-policy con teacher server en una A100 rentada durante unas horas sale a un costo bajo (~$5-20 por corrida completa), muy por debajo del presupuesto de USD 10.000 del laboratorio.

### 8. Synthetic data distillation y modelos base pequeños candidatos

Consenso 2025-2026 sobre generar datasets sintéticos con un modelo grande: dos pasos — (1) el profesor genera datos con prompts específicos de tarea (chain-of-thought o chain-of-density), (2) fine-tune por instrucciones del estudiante sobre esos datos, con filtrado/auditoría de calidad antes de entrenar. Hallazgo importante y contraintuitivo: **un profesor más fuerte no siempre es mejor** — sus outputs pueden ser demasiado complejos y alejarse de la distribución que el estudiante puede realmente aprender (relevante para Simón: DeepSeek como profesor está bien calibrado en tamaño relativo, un modelo de frontera tipo GPT-5/Claude podría generar estilos que el modelo de 1B no logre imitar).

Modelos base candidatos para el rango de Simón (100M-2B, aptos para on-device/mobile de gama baja), citados en fuentes 2026: SmolLM2 (135M/360M/1.7B, HuggingFace, multilingüe), TinyLlama 1.1B Chat, familia Shakti (100M/250M/500M, edge AI), LaMini-GPT (774M-1.5B, multilingüe). Ninguna fuente confirmó soporte nativo o benchmarks específicos en español rioplatense — es otro hueco a validar directamente (probar SmolLM2-360M/1.7B con datos en español antes de comprometerse).

## Implicaciones para Simón-MaatWork

1. **Adoptar TRL `DistillationTrainer` (namespace experimental) como motor de post-training**, no reinventar el loop de destilación: profesor = DeepSeek actual (vía servidor externo, `use_teacher_server=True`, evita competir por VRAM de la 3060), estudiante = modelo MaatWork candidato (SmolLM2 o similar como punto de partida, sujeto a validación en español). Empezar con `lmbda` intermedio (mix on/off-policy) para no pagar el costo completo de generación on-policy desde el día uno, y subir a `lmbda=1.0` cuando el pipeline esté estable.
2. **Full fine-tuning (no LoRA) es la estrategia default recomendada** para el rango 100M-2B — la 3060 12GB alcanza con gradient checkpointing + `paged_adamw_8bit` + bf16; reservar LoRA/QLoRA solo para iteración rápida de prototipos o si se necesitan variantes por perfil de usuario. Falta benchmark propio de horas/época — correrlo antes de comprometer cronograma.
3. **Recipe recomendado (SFT curricular + destilación on-policy)** del paper openPangu-1B es el candidato más directo a copiar: primero datos con razonamiento/contexto explícito sobre por qué responder empáticamente de tal forma, después pares directos sin scaffolding, para no perder latencia en producción (crítico porque Simón corre sin streaming — la respuesta completa se genera antes de moderar).
4. **No usar GRPO como método principal** — la empatía y el estilo rioplatense no son recompensas verificables por reglas; mejor invertir en destilación on-policy + eventualmente ORPO/DPO sobre pares de preferencia (dos respuestas del modelo chico, un juez humano o LLM elige la mejor) una vez haya un modelo base funcionando.
5. **Guardrails de seguridad infantil no dependen del modelo generativo** y esto sigue así: la capa regex de crisis y la cascada de moderación (regex → OpenAI Moderation → juez LLM) son deterministas/externas al modelo conversacional, así que ningún cambio de post-training/destilación las toca — pero si el profesor usado para destilar (DeepSeek) tiene sesgos o huecos de seguridad, esos podrían transferirse al estudiante vía imitación; conviene auditar el dataset sintético generado por el profesor con la misma cascada de moderación antes de usarlo para entrenar.
6. **Presupuesto de USD 10.000 alcanza cómodo para cloud de respaldo**: incluso corridas de destilación en A100 a $1-5/hora dan margen para decenas/cientos de horas de experimentación si la 3060 resulta insuficiente para algún experimento puntual (ej. hostear el profesor grande).
7. **Hueco de conocimiento explícito a cerrar con experimentos propios**: (a) horas/época reales en la 3060 para 360M/1B con 50k-500k ejemplos, (b) calidad de SmolLM2/TinyLlama/Shakti en español rioplatense antes de elegir la base, (c) si DeepSeek como profesor produce suficiente señal de "estilo empático" o si hace falta un profesor más especializado.

## Fuentes

- [thinkingmachines.ai/blog/on-policy-distillation](https://thinkingmachines.ai/blog/on-policy-distillation/) (Thinking Machines Lab, Kevin Lu et al., 27-oct-2025) — post original de on-policy distillation, números de AIME'24, GPU-horas, recipe, comparación vs SFT/RL.
- [huggingface.co/docs/trl/distillation_trainer](https://huggingface.co/docs/trl/distillation_trainer) (HuggingFace, doc v1.9.0, leída jul-2026) — API completa de `DistillationTrainer`/`DistillationConfig`, ejemplo de código, teacher server, parámetros `lmbda`/`beta`.
- [huggingface.co/blog/trl-v1](https://huggingface.co/blog/trl-v1) y [marktechpost.com/2026/04/01/...trl-v1-0](https://www.marktechpost.com/2026/04/01/hugging-face-releases-trl-v1-0-a-unified-post-training-stack-for-sft-reward-modeling-dpo-and-grpo-workflows/) — anuncio TRL v1.0 (abril 2026), lista de trainers estables vs experimentales.
- [arxiv.org/html/2509.26497](https://arxiv.org/html/2509.26497) ("Revealing the Power of Post-Training for Small Language Models via Knowledge Distillation") — recipe curricular SFT + destilación offline on-policy validado en openPangu-1B, hiperparámetros λ_KD/top-k.
- [arxiv.org/pdf/2605.10889](https://arxiv.org/pdf/2605.10889) ("Unmasking On-Policy Distillation: Where It Helps, Where It Hurts, and Why") — matices/límites del método, 2026.
- [www.marktechpost.com/2026/07/22/...unsloth-axolotl-trl-llama-factory](https://www.marktechpost.com/2026/07/22/unsloth-vs-axolotl-vs-trl-vs-llama-factory-a-fine-tuning-framework-comparison-on-speed-vram-and-multi-gpu/) (22-jul-2026) — comparación de herramientas, estrellas GitHub, VRAM/velocidad.
- [www.index.dev/skill-vs-skill/ai-lora-vs-qlora-vs-full-finetuning](https://www.index.dev/skill-vs-skill/ai-lora-vs-qlora-vs-full-finetuning) (2026) — regla explícita full FT para <2B vs QLoRA para >2B, % de accuracy relativo.
- [futureagi.com/blog/llm-fine-tuning-guide-2025](https://futureagi.com/blog/llm-fine-tuning-guide-2025/) — comparación DPO/ORPO/KTO/GRPO, recomendación secuencial 2026.
- [intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison](https://intuitionlabs.ai/articles/h100-rental-prices-cloud-comparison) y [aimultiple.com/gpu-index](https://aimultiple.com/gpu-index) (jul-2026) — precios GPU cloud A100/H100/3060 actualizados.
- [www.intuz.com/blog/best-small-language-models](https://www.intuz.com/blog/best-small-language-models/) y [www.datacamp.com/blog/top-small-language-models](https://www.datacamp.com/blog/top-small-language-models) (2026) — catálogo de modelos base candidatos <2B (SmolLM2, TinyLlama, Shakti, LaMini-GPT).
