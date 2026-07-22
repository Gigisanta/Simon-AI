# Inferencia on-device y cuantización para modelos 100M–2B (2026)

## Resumen ejecutivo

En julio 2026 el ecosistema de inferencia local para modelos pequeños (100M–2B parámetros) está maduro pero con matices importantes para el caso Simón. **llama.cpp/GGUF** sigue siendo el estándar de facto para CPU, con la familia K-quants (Q4_K_M como default razonable) y los I-quants (IQ) para bit-width extremo con importance matrix. **QAT (quantization-aware training)** — validado por Google con Gemma 3 — recupera ~54% de la degradación de perplexity vs post-training quantization (PTQ) en int4, lo cual es directamente aplicable al entrenamiento propio de MaatWork: entrenar con QAT desde el principio, no cuantizar después. **BitNet b1.58 (ternario, 1.58-bit)** de Microsoft ya es práctico en 2026 — el modelo b1.58-2B-4T iguala benchmarks de modelos full-precision similares con 6.17x de speedup en CPU x86 y consumo de energía 70-82% menor — pero requiere entrenar (o re-entrenar) nativamente en ternario, no es una cuantización post-hoc de cualquier checkpoint. Para ejecutores móviles, **ExecuTorch** (Meta) es la apuesta más sólida y portable; **MediaPipe LLM Inference API está en modo mantenimiento**, reemplazada por LiteRT-LM; MLC LLM sigue activo pero con menor tracción reciente. En hardware real: un celular Android gama baja (3GB RAM, chip ~2020) corre un modelo 1B cuantizado Q4_K_M a **2-5 tok/s**, gama media 6GB RAM a 3-6 tok/s, Raspberry Pi 5 a 12-18 tok/s para 1B y 4-8 tok/s para 3B, notebook vieja sin AVX2 significativamente más lento que con AVX2/AVX-512. Como plan B de transición, servir un 1B propio en un VPS Hetzner (~€8-10/mes) con llama.cpp server es viable y barato comparado con serverless GPU (RunPod desde ~$0.58/hr) o Cloudflare Workers AI (cobra por familia de modelo, no por tamaño real, ~$2.50/1M input tokens en modelos tipo Llama 3.1 8B — desproporcionado para un 1B propio).

## Hallazgos

### 1. llama.cpp / GGUF: estado 2026

El formato GGUF sigue siendo el pivote de la inferencia CPU. La librería implementa cuantización weight-only con dos familias:

- **Formatos originales**: Q4_0, Q4_1, Q5_0, Q5_1, Q8_0 (legacy, simples, rápidos).
- **K-quants** (Q2_K…Q6_K, con variantes _S/_M/_L): son el punto de partida recomendado; **Q4_K_M sigue siendo el "sweet spot" tamaño/calidad** según la documentación oficial y guías de 2026 (arxiv 2601.14277 — estudio unificado 2026 sobre Llama-3.1-8B con benchmarks de razonamiento, conocimiento, instruction-following y truthfulness por bit-width).
- **I-quants (IQ1_S…IQ4_XS)**: usan codebooks/lookup tables y requieren una *importance matrix* (imatrix) calibrada; dan la mejor calidad a bit-width muy bajo (2-bit y menos) pero son más lentos de decodificar y más complejos de generar. Se recomiendan solo cuando el presupuesto de memoria es muy ajustado (ej. querer meter un modelo más grande en RAM limitada), no como default. [Fuentes: github.com/ggml-org/llama.cpp/tools/quantize/README.md; qwen.readthedocs.io — quantization/llama.cpp.html]

Para un modelo propio de 100M-2B, la recomendación práctica: entrenar en bf16/fp16, exportar a GGUF, y distribuir Q4_K_M como default (mejor compatibilidad y velocidad), con una variante Q8_0 para servidor (más calidad, memoria no es problema) y opcionalmente una IQ3/IQ4 para el celular más limitado de la matriz.

### 2. Quantization-Aware Training (QAT): el caso Gemma 3

Google publicó (2025) versiones QAT de toda la familia Gemma 3 (1B, 4B, 12B, 27B) entrenando ~5.000 pasos adicionales simulando operaciones de baja precisión, usando las probabilidades del checkpoint no cuantizado como target de distilación. Resultado medido en perplexity sobre llama.cpp: **la caída de perplejity al pasar a Q4_0 se reduce en 54%** comparado con cuantizar el mismo checkpoint sin QAT (post-training quantization). Memoria de pesos en int4: 1B → 0.5GB VRAM, 4B → 2.6GB, 12B → 6.6GB, 27B → 14.1GB (sin contar KV cache). [Fuente: developers.googleblog.com/en/gemma-3-quantized-aware-trained-state-of-the-art-ai-to-consumer-gpus/, 2025]

**Implicación directa para MaatWork**: si se va a entrenar un modelo propio desde cero o vía fine-tuning intensivo, conviene incorporar QAT en las últimas etapas del entrenamiento (no como paso separado post-hoc), porque la ganancia de calidad al bit-width objetivo (probablemente int4 o incluso ternario) es sustancial y barata en cómputo relativo (miles de steps, no el entrenamiento completo).

### 3. AWQ, GPTQ, HQQ — cuantización post-training

- **AWQ** (activation-aware): pondera qué pesos proteger según sensibilidad de activación; en benchmarks 2025-2026 tiende a superar a GPTQ en tareas de razonamiento (ej. InternLM2.5-7B) pero requiere datos de calibración y más tiempo.
- **GPTQ**: optimización capa por capa, más rápido de aplicar, buena compatibilidad de hardware, pero calidad algo menor que AWQ en tareas exigentes.
- **HQQ** (half-quadratic quantization): **no requiere datos de calibración** (data-free/zero-shot), ~50x más rápido que GPTQ en tiempo de cuantización, puede cuantizar modelos de varios billones de parámetros en minutos en una sola GPU. Ideal para iterar rápido en un laboratorio de 1 persona con presupuesto ajustado — no hay que armar/curar un dataset de calibración cada vez que se saca un checkpoint nuevo. [Fuente: rohan-paul.com — Quantization Methods GPTQ AWQ bitsandbytes HQQ; arxiv 2505.08620]

Para el caso MaatWork: dado el equipo de 1 persona, **HQQ es la opción de menor fricción operativa** para iterar cuantizaciones rápido durante desarrollo; AWQ o QAT nativo para el release final si el presupuesto de tiempo lo permite.

### 4. Cuantización extrema: 2-bit e IQ, y BitNet 1.58-bit

Cuantización a 2-bit vía IQ2_XXS/XS/S/M es funcional con imatrix pero la degradación de calidad crece rápido en modelos ya chicos (100M-2B tienen menos redundancia paramétrica que un 7B/13B, por lo que toleran peor la compresión extrema — esto es una intuición razonada, no un dato medido directamente en la búsqueda, marcar como estimación).

**BitNet b1.58-2B-4T** (Microsoft, 2.4B parámetros, entrenado nativamente en ternario {-1,0,+1} con activaciones int8, 4 billones de tokens de entrenamiento) **sí es práctico en 2026**, pero es un modelo entrenado desde cero en ternario, no una cuantización aplicable a cualquier checkpoint existente:
- Benchmarks: ARC-Challenge 68.5% (iguala a Llama 3 3B con 68.2%, usando ~12x menos memoria); HellaSwag 84.3% (supera a Qwen 1.8B con 82.1%). [arxiv.org/pdf/2504.12285, technical report 2025]
- Framework oficial `bitnet.cpp` (github.com/microsoft/BitNet): activamente mantenido a julio 2026, con kernels optimizados de CPU/GPU. Requiere Python ≥3.10, CMake ≥3.22, **Clang ≥18** (dependencia específica no trivial).
- Speedups reportados: **2.37x-6.17x en CPU x86**, **1.37x-5.07x en ARM**, reducción de energía 71.9-82.2% (x86) y 55.4-70.0% (ARM). En enero 2026 Microsoft lanzó una optimización de kernels CPU con paralelismo y tiling configurable que agrega 1.15x-2.1x adicional. Un modelo 100B en ternario corre en una sola CPU a velocidad "de lectura humana" (5-7 tok/s) — de referencia de escala, no directamente aplicable a un 2B, que sería sensiblemente más rápido. [github.com/microsoft/BitNet README, julio 2026]

**Implicación**: BitNet es la opción más agresiva de eficiencia, pero implica comprometerse a una arquitectura de entrenamiento ternario desde el diseño del modelo propio — mayor riesgo/novedad para un equipo de 1 persona con $10k de presupuesto, pero el ROI en tokens/s en celulares de gama baja es el mejor de todas las opciones si el pipeline de entrenamiento (RTX 3060 12GB) lo soporta. Vale la pena un piloto pequeño (100-360M) antes de comprometer el modelo principal a esta arquitectura.

### 5. Ejecutores móviles: ExecuTorch, MediaPipe/LiteRT, MLC, llama.cpp/Termux

- **ExecuTorch** (Meta, sucesor de PyTorch Mobile): runtime base de ~50KB, portable, con "delegates" hardware-aware (NNAPI, Core ML, Vulkan, XNNPACK, etc.). Es la opción con mejor respaldo a largo plazo (Meta) y la más flexible para llevar un modelo entrenado en PyTorch directo a mobile sin pasar por conversión GGUF. [meetprajapati.com; cactuscompute.com/compare, 2026]
- **MediaPipe LLM Inference API: en modo mantenimiento**, Google recomienda migrar a **LiteRT-LM** (el sucesor), que ya potencia Gemini Nano en Chrome y Pixel Watch. Cualquier decisión de usar el stack de Google debería apuntar a LiteRT-LM directamente, no a MediaPipe. [developers.google.com/edge/mediapipe; cactuscompute.com]
- **MLC LLM**: sigue activo (commits recientes en febrero 2026), soporta modelos DeepSeek y provee versiones pre-convertidas cuantizadas en Hugging Face cargables directo en MLC Chat en Android. Buena opción si se quiere aprovechar compilación TVM para GPU móvil (Vulkan/Metal).
- **llama.cpp en Termux**: sigue siendo la vía más simple y probada para Android sin pasar por una app nativa — compilar llama.cpp con backend Vulkan dentro de Termux, hablando con la GPU Mali/Adreno vía `libvulkan.so`. Es el camino de menor esfuerzo de ingeniería para un piloto rápido, aunque para producción (integrarlo en la app Simón) ExecuTorch o MLC son más apropiados que depender de Termux (que requiere que el usuario instale una segunda app).

Para Simón (app propia, no depende de que el usuario instale Termux): **ExecuTorch** es la recomendación de default para el runtime móvil productivo, con llama.cpp/GGUF como vía de prototipado rápido y servidor.

### 6. Tokens/segundo reales por dispositivo (matriz)

| Dispositivo | Modelo/cuant. | Tok/s | Fuente |
|---|---|---|---|
| Android gama baja (~2019-2022, 3GB RAM) | 1B Q4_K_M | **2-5 tok/s** (estimado interpolando del rango 3-6GB) | nkaushik.in 2026; insiderllm.com |
| Android gama media (4-6GB RAM, ej. Pixel 6/S21) | 1B-3B Q4_K_M | **3-6 tok/s** | localaimaster.com 2026 |
| Android gama media/alta (Qwen3 0.6B, LFM2.5 1.2B) | 0.6B-1.2B Q4_K_M | **10-18 tok/s** en procesadores móviles de 4-6GB RAM | insiderllm.com 2026 |
| Snapdragon 8 Elite / X Elite (gama alta) | 8B | 10-13 tok/s | huggingface.co/qualcomm benchmarks 2026 |
| Raspberry Pi 5 (Cortex-A76, 8GB, sin GPU usable) | TinyLlama 1.1B Q4_0/Q4_K_M | **12-18.4 tok/s** | tinyweights.dev; localaimaster.com 2026 |
| Raspberry Pi 5 | Llama 3.2 3B Q4 | **4-8.8 tok/s** | stratosphereips.org; localaimaster.com |
| Notebook vieja sin AVX2/AVX-512 | 1B-3B Q4_K_M | notablemente más lento que con AVX2 (no cuantificado en fuentes; los flags SIMD son el cuello de botella dominante) | ceur-ws.org paper11 2026 |
| CPU moderna con AVX2/AVX-512 (Xeon reciente) | Llama 3.2 1B | hasta **120 tok/s**; CPUs viejos (E5-2695 v2) ~25 tok/s | promptquorum.com 2026 |
| CPU-only genérico moderno | 3B-7B Q4_K_M | 4-15 tok/s | promptquorum.com 2026 |

Nota de escepticismo: los números de "gama baja 3GB" son extrapolación razonada de rangos publicados para 4-6GB, no una medición directa de un dispositivo de exactamente 3GB — no se encontró un benchmark dedicado a 3GB RAM específicamente. Tratar como estimación con incertidumbre, validar con un dispositivo real de referencia (ej. un Android barato argentino comprado para testing) antes de comprometer specs de producto.

### 7. Speculative decoding con draft chico

Múltiples papers de 2025-2026 (SLED — ACM/IEEE Edge Computing 2026; PipeSD; Dovetail) muestran ganancias reales: con un draft model tipo Vicuna-68M y target Llama2-7B, reducción de latencia promedio del 35% vs autoregresivo puro, con hasta 11% adicional con técnicas de fast decoding, y algunos métodos reportan hasta 3.72x de speedup manteniendo precisión casi sin pérdida. La arquitectura típica en edge es "cloud-edge collaborative": el draft corre en el dispositivo, la verificación en un servidor con el modelo grande — relevante si Simón mantiene un modelo grande de respaldo en servidor y uno chico en el dispositivo, pero para el caso de un solo modelo propio 1-2B sirviendo standalone en el celular, el valor de speculative decoding es limitado (no hay "modelo grande" al que acelerar acceso local). Más relevante sería un escenario híbrido: draft ultra-chico (100M) en el celular + verificación con el 1-2B en servidor, pero esto reintroduce latencia de red — a evaluar solo si la calidad conversacional de un 1-2B puro en dispositivo no alcanza el estándar de seguridad/calidad requerido.

### 8. Servir el 1B propio en cloud como plan B

- **VPS Hetzner**: CPX22 (2 vCPU/4GB RAM) subió de €5.99 a €7.99/mes desde abril 2026; sigue siendo ~3x más barato que alternativas equivalentes (ej. DigitalOcean Basic 2/4 a $24/mes). Con llama.cpp server corriendo un 1B propio cuantizado, este tier alcanza para atender tráfico bajo-medio sin GPU, con latencia aceptable para un chat no-streaming como el de Simón (se genera completo server-side de todos modos). [betterstack.com; costgoat.com, julio 2026]
- **RunPod serverless**: GPUs desde $0.58/hr (activo), RTX 4090 ~$1.10/hr efectivo, H100 ~$4.55/hr — apropiado si se necesita GPU para latencia baja a escala, pero para un 1B propio probablemente sobredimensionado; conviene solo si el volumen de tráfico justifica GPU dedicada.
- **Cloudflare Workers AI**: cobra por *familia* de modelo, no por tamaño real del modelo propio (ej. $2.50/1M input + $10/1M output tokens equiparado a la clase "Llama 3.1 8B") — **no aplica directamente a un modelo propio custom** salvo que Cloudflare ofrezca soporte para subir pesos propios (no confirmado en la búsqueda; Workers AI históricamente sirve solo su catálogo curado de modelos, no BYO-model). A verificar con la documentación oficial de Cloudflare antes de descartar/adoptar.
- **Modal / HF Inference**: mencionados en fuentes de pricing generales pero sin cifra específica encontrada para un 1B custom — requeriría cotización directa o prueba en sandbox gratuito.
- Contexto de mercado 2026: el costo de 1M tokens en modelos eficientes de terceros (DeepSeek, Gemini Flash) ya está por debajo de $1, lo cual es el benchmark a superar: **el modelo propio en VPS Hetzner solo tiene sentido económico/estratégico si el objetivo es soberanía de datos infantil y control de guardrails, no ahorro de costo puro** — a $0/token actual con DeepSeek V4 Flash, cualquier alternativa propia en fase de transición debe justificarse por seguridad/control, no por precio.

## Implicaciones para Simón-MaatWork

1. **Camino de entrenamiento recomendado**: entrenar el modelo MaatWork base en fp16/bf16 en la RTX 3060 12GB (factible para 100M-1B, ajustado para 2B), incorporar **QAT en las últimas ~5.000 steps** apuntando a int4 (siguiendo el patrón validado por Google/Gemma 3), y usar **HQQ** para iterar variantes de cuantización rápidamente sin necesidad de curar datasets de calibración en cada ciclo.
2. **Evaluar un piloto BitNet ternario** (100-360M) en paralelo al modelo principal QAT-int4: si el pipeline de entrenamiento lo soporta, BitNet ofrece el mejor techo de eficiencia en dispositivos de gama baja argentina, pero es la opción de mayor riesgo/novedad — no comprometer el modelo principal a esta arquitectura sin validar el piloto primero.
3. **Runtime móvil productivo**: apostar a **ExecuTorch** para integrar el modelo en la app Simón (Android), no a MediaPipe (en mantenimiento) ni a depender de que el usuario tenga Termux instalado. Usar llama.cpp/GGUF como vía de prototipado y para el server-side.
4. **Distribución de artefactos**: publicar al menos Q4_K_M (default) y Q8_0 (servidor) en GGUF; considerar variante IQ3/IQ4 solo si el dispositivo de gama más baja de la matriz real (a testear con hardware físico argentino) lo requiere.
5. **No asumir 3GB RAM sin medir**: los números de esta franja son extrapolados, no medidos directamente en las fuentes revisadas — antes de fijar specs mínimas de producto, conseguir 1-2 celulares Android baratos reales (~2020, 3GB) y correr benchmarks propios con el modelo candidato.
6. **Plan B de servidor**: mantener la opción de un VPS Hetzner (~€8-10/mes) sirviendo el 1B propio vía llama.cpp server como fallback/transición mientras el modelo on-device madura — el ahorro de costo vs DeepSeek V4 Flash actual (que ya está a $0/token en la suscripción vigente) es irrelevante; el valor de esta vía es **control total de guardrails y no depender de un proveedor comercial**, coherente con el objetivo estratégico planteado, no con ahorro de dinero.
7. **Guardrails no negociables**: nada de lo anterior toca la cascada de moderación server-side (regex → OpenAI Moderation → juez LLM) ni la capa determinística de crisis — cualquier modelo propio (por chico/cuantizado que sea) debe pasar por la misma cascada sin streaming antes de llegar al menor; la cuantización agresiva (BitNet, IQ2) exige verificación empírica extra de que el modelo no degrada su capacidad de generar texto "seguro por default" en escenarios límite, dado que modelos más chicos ya tienen menos margen de calidad para empezar.

## Fuentes

- github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md — formatos K-quant e IQ-quant, recomendaciones oficiales.
- arxiv.org/html/2601.14277v1 — estudio unificado 2026 de cuantización llama.cpp en Llama-3.1-8B-Instruct, benchmarks por bit-width.
- qwen.readthedocs.io/en/latest/quantization/llama.cpp.html — guía de cuantización GGUF.
- developers.googleblog.com/en/gemma-3-quantized-aware-trained-state-of-the-art-ai-to-consumer-gpus/ (2025) — metodología QAT de Gemma 3, reducción 54% de degradación de perplexity, tabla de memoria int4 por tamaño.
- huggingface.co/google/gemma-3-1b-it-qat-int4-unquantized — modelo QAT 1B publicado.
- github.com/microsoft/BitNet (consultado julio 2026) — estado del proyecto, requisitos (Clang≥18), speedups CPU x86/ARM, modelos soportados.
- arxiv.org/pdf/2504.12285 — BitNet b1.58 2B4T Technical Report, benchmarks ARC-Challenge/HellaSwag vs Llama3-3B y Qwen 1.8B.
- huggingface.co/microsoft/bitnet-b1.58-2B-4T — model card.
- rohan-paul.com/p/quantization-methods-for-large-language — comparación AWQ/GPTQ/HQQ, velocidad de calibración.
- arxiv.org/pdf/2505.08620 — Resource-Efficient Language Models, cuantización para inferencia accesible.
- cactuscompute.com/compare y /compare/best-tensorflow-lite-alternative (2026) — comparación ExecuTorch/MediaPipe/LiteRT/MLC.
- developers.google.com/edge/mediapipe/solutions/genai/llm_inference — confirma que MediaPipe LLM API está en mantenimiento, migrar a LiteRT-LM.
- meetprajapati.com/blogs/running-on-device-ai-models-android-mediapipe-llamacpp-executorch — comparación práctica Android 2026.
- nkaushik.in/writing/how-to-run-llm-models-on-old-android-devices-locally (2026) — benchmarks Termux en Android viejo.
- insiderllm.com/guides/run-llms-old-phones-mobile-inference — tok/s en gama media/baja Android.
- localaimaster.com/blog/run-llm-on-phone y /blog/llm-raspberry-pi-5 (2026) — matriz de tok/s por dispositivo, Raspberry Pi 5 benchmarks.
- tinyweights.dev/posts/run-llms-raspberry-pi-5 — benchmarks reales TinyLlama 1.1B en Pi 5.
- stratosphereips.org/blog/2025/6/5/how-well-do-llms-perform-on-a-raspberry-pi-5 — benchmarks Pi 5.
- ceur-ws.org/Vol-4164/paper11.pdf — deploying LLMs CPU-only, impacto AVX2/AVX-512.
- promptquorum.com/local-llms/best-cpu-only-llm (mayo 2026) — tok/s modelos CPU-only, comparación Xeon nuevo vs viejo.
- huggingface.co/qualcomm/Llama-SEA-LION-v3.5-8B-R — benchmarks Snapdragon 8 Elite/X Elite.
- dl.acm.org/doi/10.1145/3769102.3770608 (SLED, ACM/IEEE Edge Computing 2026) — speculative decoding en edge.
- betterstack.com/community/guides/web-servers/hetzner-cloud-review (2026) y costgoat.com/pricing/hetzner — precios VPS Hetzner actualizados abril 2026.
- thundercompute.com/blog/runpod-pricing-vs-thunder-compute (2026) — precios RunPod serverless por GPU.
- markaicode.com/pricing/cloudflare-workers-cost-analysis — precio Cloudflare Workers AI por familia de modelo.
- aimagicx.com/blog/llm-pricing-collapse-developer-guide-building-cheap-ai-2026 — contexto de mercado, costo por millón de tokens 2026.
