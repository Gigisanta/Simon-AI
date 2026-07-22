# Costos y alternativas de serving para Simón — TCO comparado 2026

## Resumen ejecutivo

Con el volumen actual de Simón (~30.000 mensajes/mes) **el costo de LLM ya es prácticamente irrelevante en cualquier escenario**: DeepSeek V4 Flash cuesta ~US$7/mes, y hasta la opción "premium" (Gemini 3.1 Flash-Lite) cuesta ~US$24/mes. A 10x volumen (300k msgs/mes) las diferencias entre proveedores comerciales siguen siendo de decenas de dólares, no de miles. Esto cambia el cálculo del proyecto: **la razón para entrenar un modelo propio no es el ahorro de tokens de API — es control total sobre safety/latencia/censura, soberanía de datos de menores, y la posibilidad de correr 100% offline en el dispositivo del chico** (conectividad argentina real, escuelas rurales, celulares de gama baja). El TCO de un modelo propio en VPS (Hetzner CPX31, ~€15-20/mes) es comparable o más barato que las APIs comerciales *solo si el tráfico entra en la capacidad de CPU de una sola caja*; a 300k msgs/mes probablemente hace falta escalar horizontalmente (más VPS o GPU serverless), lo que sube el costo por encima de simplemente pagar la API comercial más barata (Groq/DeepSeek). El caso "browser-first" es el único que rompe la curva de costo marginal por token, pero **no puede eliminar el server-side de la arquitectura de seguridad de Simón**: la cascada de moderación (regex de crisis → OpenAI Moderation → juez LLM) tiene que seguir corriendo server-side sobre el texto ya generado antes de mostrarlo al menor, sea cual sea el origen del texto. El ahorro real del browser-first es de *cómputo de generación* (la parte más cara), no de moderación (que ya es gratis o casi gratis hoy). Depender de OpenCode Go (US$10/mes, sin billing por token) para producción con menores es un riesgo de continuidad de servicio no de costo — es un gateway de terceros con roster de modelos que cambia, pensado para *coding agents*, no para SLA de un producto infantil.

## Hallazgos

### 1. APIs comerciales — precios reales julio 2026

| Proveedor / modelo | Input US$/1M tok | Output US$/1M tok | Notas |
|---|---|---|---|
| **DeepSeek V4 Flash** (actual de Simón) | $0.14 (cache miss) / $0.0028 (cache hit) | $0.28 | 1M contexto, endpoint OpenAI-compatible. Legacy aliases `deepseek-chat`/`deepseek-reasoner` deprecan 24/07/2026 ([NxCode, jul 2026](https://www.nxcode.io/resources/news/deepseek-api-pricing-complete-guide-2026); [CloudZero](https://www.cloudzero.com/blog/deepseek-pricing/)) |
| **Groq Llama 3.1 8B Instant** | $0.05 | $0.08 | El más barato de los benchmarkeados; Batch+caching stackeable a ~25% del precio on-demand ([CloudZero, 2026](https://www.cloudzero.com/blog/groq-pricing/); [AI Pricing Guru, jun 2026](https://www.aipricing.guru/groq-pricing/)) |
| **GPT-5.4-nano** (sucesor de gpt-5-nano) | $0.20 | $1.25 | gpt-5-mini/nano ya no figuran en pricing oficial de OpenAI, reemplazados por familia 5.4/5.5 ([Morph, 2026](https://www.morphllm.com/openai-api-pricing); [pricepertoken](https://pricepertoken.com/pricing-page/provider/openai)) |
| **Gemini 3.1 Flash-Lite** | $0.25 | $1.50 | Gemini 2.5 Flash-Lite ($0.10/$0.40) se retira 16/10/2026, reemplazo confirmado 3.1 ([CloudZero](https://www.cloudzero.com/blog/gemini-pricing/); [BenchLM, jul 2026](https://benchlm.ai/google/api-pricing)) |
| **OpenRouter (:free)** | $0 | $0 | 27+ modelos gratis, pero 20 req/min tope duro y 50-1000 req/día según crédito histórico comprado. Explícitamente "no recomendado para producción" por el propio ecosistema ([klymentiev.com, 2026](https://klymentiev.com/blog/openrouter-free-tier); [teamday.ai, jul 2026](https://www.teamday.ai/blog/best-free-ai-models-openrouter-2026)) |

**Moderación**: `omni-moderation-latest` de OpenAI (basado en GPT-4o, 13 categorías, texto+imagen) es **gratis** y no cuenta contra rate limits, con latencia 15-25ms — sigue siendo la opción más barata para la capa 2 de la cascada de Simón ([help.openai.com](https://help.openai.com/en/articles/4936833-is-the-moderation-endpoint-free-to-use); [aimoderationtools.com, 2026](https://aimoderationtools.com/posts/openai-moderation-api-review/)).

**Embeddings**: `text-embedding-3-small` de OpenAI, $0.02/1M tokens ($0.01 batch). Self-hosting (BGE-M3 en A100 spot) baja a ~$0.001/1M tokens pero solo se justifica arriba de 10-15M embeddings/mes ([embeddingcost.com](https://embeddingcost.com/); [DeployBase, 2026](https://deploybase.ai/articles/best-embedding-models)). Con el volumen de Simón, self-host de embeddings no se justifica todavía.

### 2. Riesgo de OpenCode Go / Zen como gateway de producción

OpenCode Go es un bundle de 12 modelos open-source (DeepSeek V4, Qwen 3.6, GLM 5.2, MiniMax M3) por **US$10/mes** sin billing por token; OpenCode Zen es pago-por-request con roster de modelos gratis que "es un moving target, no un contrato permanente" según la propia documentación revisada en abril 2026 ([bitdoze.com](https://www.bitdoze.com/opencode-go-plan/); [aihackers.net](https://aihackers.net/tools/opencode/)). Es un producto pensado para *coding agents* (de ahí el nombre OpenCode), no para servir un chatbot de niños con SLA. **Riesgo real**: sin garantía contractual de disponibilidad, sin SLA de uptime, y con el roster de modelos "gratis" sujeto a cambio sin aviso. Para producción con menores esto es una dependencia frágil — vale como fallback de emergencia o entorno de dev, no como proveedor primario. El propio contexto del proyecto (subsidio $0/token vía este gateway) confirma que hoy Simón corre sobre esta fragilidad.

### 3. Servir un modelo propio 0.5-2B

**VPS CPU (Hetzner):**
- CPX22 subió de €5.99 a €7.99/mes en abril 2026; instancias CPX usan AMD EPYC-Genoa ([Northflank, 2026](https://northflank.com/blog/hetzner-cloud-server-price-increases); [bitdoze.com](https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/)).
- Throughput: un CX23 (instancia cost-optimizada) corre un modelo de 3B a ~3-6 tok/s con inferencia CPU pura — "usable para workflows async, no para chat interactivo" ([betterstack.com, 2026](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/)). Un 1B cuantizado en una CPX de 4-8 vCPU probablemente rinde 2-4x eso (8-15 tok/s estimado, no verificado con benchmark directo — extrapolación, no dato de fuente).
- **Implicación de capacidad**: a ~30-50 tok/s por hilo y ~400 tokens de output por respuesta, una sola VPS sirve un mensaje cada 10-15s *en serie*. Eso da ~250-350 respuestas/hora sostenidas por caja — suficiente para el promedio de 30k msgs/mes (~42 msgs/hora) con margen para picos, pero **no** para 300k msgs/mes (~420 msgs/hora promedio) sin paralelizar en 2-3 cajas o batching real.
- Costo: 1 CPX31 (~€15-20/mes, ~US$16-22) cubre el escenario de 30k msgs/mes. A 300k msgs/mes, escalar a 2-3 instancias lleva el costo a ~US$50-65/mes — todavía competitivo frente a Gemini/GPT pero ya no claramente más barato que Groq/DeepSeek API.

**GPU serverless:**
- **Modal**: T4 a $0.000164/seg (~$0.59/hr), A10G a ~$0.000306/seg (~$1.10/hr); cold starts de contenedor "sub-segundo" en el caso típico, pero minutos si hay que descargar pesos del modelo ([usagepricing.com](https://www.usagepricing.com/blueprint/modal); [hostfleet.net, abr 2026](https://hostfleet.net/serverless-gpu-pricing-matrix-2026/)).
- **RunPod serverless**: cold start "bajo 200ms" en el caso promedio, pero se factura el segundo completo desde que arranca la inicialización — para H100 eso es $4.55/hr ([RunPod docs](https://www.runpod.io/articles/guides/serverless-gpu-pricing); [DeployBase, 2026](https://deploybase.ai/articles/runpod-review)). Un modelo de 1-2B no necesita H100; con T4/A10 el costo baja a rango Modal.
- **Fly.io GPU**: A10 $0.75/hr, L40S $0.70/hr, A100 40G $1.25/hr, A100 80G $1.50/hr, facturación por segundo — **pero Fly anunció el retiro completo de GPUs para el 1 de agosto de 2026** ([fly.io/docs/gpus](https://fly.io/docs/gpus/); búsqueda web, jul 2026). Fly queda descartado como opción viable para este proyecto.
- Estimación de costo Modal a volumen de Simón: con ~2-3s de cómputo GPU por respuesta (modelo 1-2B en T4), 30k msgs/mes = ~20 horas-GPU/mes ≈ **US$12/mes**; 300k msgs/mes ≈ **US$120/mes**. Escala linealmente con volumen (a diferencia de la VPS, que tiene un techo de capacidad fijo por caja) — ventaja para picos impredecibles, sin gestión de servidor.

**Cloudflare Workers AI:**
- $0.011 por 1.000 "Neurons", 10.000 Neurons/día gratis (~300k/mes) ([docs.cloudflare.com, actualizado 8 jul 2026](https://developers.cloudflare.com/workers-ai/platform/pricing/)).
- Llama 3.2 1B: 2.457 neurons/1M tokens input, 18.252 neurons/1M tokens output — a precio real eso es ~$0.027/1M input y ~$0.20/1M output, **más caro que DeepSeek V4 Flash actual**.
- **Modelos propios**: Cloudflare permite subir **LoRA adapters** (hasta 100MB, rank ≤8, máx. 30 por cuenta) sobre bases fijas — Gemma 2B/7B, Llama 2 7B, Mistral 7B ([blog.cloudflare.com](https://blog.cloudflare.com/workers-ai-ga-huggingface-loras-python-support/); WebFetch a docs oficiales, jul 2026). **No** permite subir un modelo base propio entrenado desde cero — solo fine-tunes LoRA sobre sus bases. Esto descarta Workers AI como target de deploy para un modelo MaatWork ~100M-2B entrenado desde cero, salvo que se re-entrene como LoRA sobre una de esas bases (limita drásticamente el control del proyecto).

**Hugging Face Inference Endpoints:**
- CPU desde $0.03/core-hora; GPU: T4 ~$0.50/hr, L4 ~$0.80/hr, A10 ~$1.30/hr, A100 ~$4.50/hr, facturación por minuto, scale-to-zero cuando no hay tráfico ([klymentiev.com](https://klymentiev.com/blog/huggingface-inference-api); metacto.com, 2026). Para tráfico bursty tipo Simón (100-1000 req/día) el propio ecosistema estima $20-60/mes con autoscaling — rango similar a Modal.

### 4. Browser-first (modelo corriendo en el dispositivo del usuario)

- WebGPU vía WebLLM alcanza ~80% de la velocidad nativa y funciona offline una vez cacheado el modelo ([localaimaster.com, 2026](https://localaimaster.com/blog/webllm-browser-ai-guide); arxiv 2605.20706, 2026). El techo práctico en navegador por límites de memoria es ~8B cuantizado — un modelo de 1-2B entra cómodo.
- Android: Vulkan está disponible en prácticamente todo Android moderno; llama.cpp corre 1B con **6GB+ RAM recomendado, 8GB+ cómodo** ([contentbuffer.com, 2026](https://www.contentbuffer.com/guides/run-local-llm-android-llamacpp-vulkan); buildmvpfast.com, 2026). **Esto es una alerta directa para el público real de Simón**: celulares Android de gama baja argentinos con 2-4GB RAM (mencionados en el objetivo del proyecto) están **por debajo** del umbral cómodo reportado por la comunidad para correr incluso un 1B — hace falta cuantización agresiva (INT4/INT3) y probablemente un modelo más chico (~100-300M) para ese segmento específico, no un 1-2B genérico.
- Costo marginal de generación: **$0** por turno resuelto client-side — no hay línea de esto en ningún proveedor cloud.
- **Restricción arquitectónica clave que el research debe remarcar**: la seguridad de Simón exige que ningún texto llegue al menor sin pasar la cascada server-side (regex de crisis → OpenAI Moderation → juez LLM). Si el modelo genera client-side, **el texto generado igual tiene que viajar al servidor para moderación antes de mostrarse** — el ahorro real no es "cero llamadas al servidor", es "cero cómputo de generación en el servidor". La cascada de moderación (que hoy es gratis vía OpenAI Moderation + barata vía juez LLM chico) sigue corriendo igual. Esto tira abajo cualquier estimación ingenua de "ahorro 70-90%" si se mide en llamadas de red — el ahorro correcto se mide en **tokens de generación evitados**, que es justamente la parte que ya es más barata (output tokens) frente al framing de "verificar cada mensaje con LLM juez" que sí sigue corriendo igual sin importar dónde se generó el texto.

## Implicaciones para Simón-MaatWork

1. **El ahorro de API no es el business case.** A 30k y hasta 300k msgs/mes, la diferencia entre seguir con DeepSeek V4 Flash (~US$7-70/mes) y cualquier alternativa comercial es de decenas de dólares. El caso para el modelo propio tiene que apoyarse en: control de guardrails, latencia sin dependencia de red, funcionamiento offline en zonas de mala conectividad, y soberanía de datos de menores — no en TCO de tokens.
2. **Cloudflare Workers AI queda descartado como target de deploy del modelo propio** salvo que el diseño se adapte a LoRA sobre una base ajena (Gemma/Llama/Mistral) — contradice el objetivo de tener una familia de modelos MaatWork propia entrenada desde cero.
3. **Fly.io GPU queda descartado** por el retiro anunciado de su oferta de GPU (1 ago 2026).
4. **VPS Hetzner (CPX31, ~US$16-22/mes) es viable como serving primario solo hasta ~30-50k msgs/mes en una sola caja**; a 300k msgs/mes hace falta escalar horizontalmente o migrar a GPU serverless (Modal, ~US$120/mes estimado), y en ese punto el costo deja de ser claramente inferior a simplemente pagar Groq/DeepSeek API.
5. **El browser-first solo tiene sentido si se preserva intacta la cascada de moderación server-side** — el texto generado en el dispositivo del menor debe seguir viajando al servidor para el juicio de seguridad antes de mostrarse. Esto es no negociable dado el mandato de seguridad infantil del proyecto, y hay que comunicarlo así en cualquier propuesta de arquitectura híbrida para no vender un ahorro de costos que en realidad es solo un ahorro de cómputo de generación (real y valioso, pero parcial).
6. **Para celulares Android de gama baja (2-4GB RAM) el modelo tiene que apuntar más chico que 1B** (rango ~100-300M con cuantización agresiva) para no degradar la experiencia — los benchmarks de la comunidad recomiendan 6-8GB+ RAM para correr 1B cómodo, muy por encima del hardware real objetivo.
7. **OpenCode Go/Zen debe tratarse como fallback de contingencia, no como proveedor primario de producción** con menores — no hay SLA ni compromiso de continuidad de roster, y su propósito de diseño es coding agents, no chatbots infantiles.
8. **Moderación y embeddings no valen la pena internalizar todavía**: OpenAI Moderation es gratis, y self-hosting de embeddings solo se justifica arriba de 10-15M embeddings/mes (muy por encima de la proyección de Simón).

## Tabla TCO mensual estimada

Supuestos declarados: ~800 tokens input + ~400 tokens output por mensaje (incluye contexto de conversación + system prompt). 30k msgs/mes ≈ 24M input + 12M output tokens/mes; 300k msgs/mes ≈ 10x. Cifras de cómputo GPU/CPU marcadas como **estimación** (no hay benchmark de fuente primaria para un 1-2B MaatWork específico, que aún no existe).

| Escenario | 30k msgs/mes | 300k msgs/mes | Fuente / certeza |
|---|---|---|---|
| DeepSeek V4 Flash (actual) | ~US$7 | ~US$67 | Verificado, precios oficiales jul 2026 |
| Groq Llama 3.1 8B (más barato) | ~US$2 | ~US$22 | Verificado |
| GPT-5.4-nano | ~US$20 | ~US$198 | Verificado |
| Gemini 3.1 Flash-Lite | ~US$24 | ~US$240 | Verificado |
| VPS propio (Hetzner CPX31, 1 caja) | ~US$16-22 (fijo) | **insuficiente en 1 caja** → ~US$50-65 con 2-3 cajas | Estimado — throughput de 1B extrapolado de benchmark de 3B, no medido |
| GPU serverless (Modal, T4/A10) | ~US$12 | ~US$120 | Estimado — supone 2-3s cómputo/respuesta, sin contar cold starts frecuentes |
| Browser-first + fallback server (70-90% client-side) | Ahorro de generación server-side proporcional; moderación server-side sin cambios (gratis/barata) | Igual proporción | Conceptual — no hay cifra de mercado directa, depende de % real de resolución client-side una vez construido el modelo |

## Fuentes

- [NxCode — DeepSeek API Pricing Complete Guide, jul 2026](https://www.nxcode.io/resources/news/deepseek-api-pricing-complete-guide-2026) — precios exactos DeepSeek V4 Flash/Pro
- [CloudZero — DeepSeek pricing 2026](https://www.cloudzero.com/blog/deepseek-pricing/) — confirma precios y deprecación de aliases legacy
- [CloudZero — OpenAI API Cost In 2026](https://www.cloudzero.com/blog/openai-pricing/) — contexto familia GPT-5.x
- [Morph — OpenAI API Pricing 2026](https://www.morphllm.com/openai-api-pricing) — tabla completa per-token, confirma retiro de gpt-5-mini/nano
- [CloudZero — Gemini pricing en 2026](https://www.cloudzero.com/blog/gemini-pricing/) — precios Flash-Lite y fecha de retiro 2.5
- [BenchLM — Gemini API Pricing jul 2026](https://benchlm.ai/google/api-pricing) — confirma 3.1 Flash-Lite $0.25/$1.50
- [CloudZero — Groq Pricing en 2026](https://www.cloudzero.com/blog/groq-pricing/) — precios Llama 3.1 8B y descuentos batch/caching
- [AI Pricing Guru — Groq API Pricing, jun 2026](https://www.aipricing.guru/groq-pricing/) — confirma rango de precios Groq
- [help.openai.com — Is the Moderation endpoint free to use?](https://help.openai.com/en/articles/4936833-is-the-moderation-endpoint-free-to-use) — confirma gratuidad
- [aimoderationtools.com — OpenAI Moderation API Review 2026](https://aimoderationtools.com/posts/openai-moderation-api-review/) — detalle de categorías y latencia
- [Cloudflare Workers AI — Pricing (docs oficiales, WebFetch, actualizado 8 jul 2026)](https://developers.cloudflare.com/workers-ai/platform/pricing/) — $0.011/1000 neurons, 10k neurons/día gratis
- [Cloudflare Blog — Leveling up Workers AI: GA + Hugging Face LoRAs](https://blog.cloudflare.com/workers-ai-ga-huggingface-loras-python-support/) — límites de LoRA (100MB, rank≤8, 30/cuenta), bases soportadas
- [betterstack.com — Hetzner Cloud Review 2026](https://betterstack.com/community/guides/web-servers/hetzner-cloud-review/) — benchmark 3B en CX23, 3-6 tok/s
- [Northflank — Hetzner cloud server price increases 2026](https://northflank.com/blog/hetzner-cloud-server-price-increases) — aumento CPX22 abril 2026
- [bitdoze.com — Hetzner Cloud Pricing After April 2026 Increase](https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/) — tabla de precios post-aumento
- [usagepricing.com — Modal Pricing](https://www.usagepricing.com/blueprint/modal) — $/seg T4 y A10G
- [hostfleet.net — Every serverless GPU host compared, abr 2026](https://hostfleet.net/serverless-gpu-pricing-matrix-2026/) — matriz comparativa cold starts
- [RunPod — Unpacking Serverless GPU Pricing](https://www.runpod.io/articles/guides/serverless-gpu-pricing) — mecánica de billing por cold start
- [DeployBase — RunPod Review 2026](https://deploybase.ai/articles/runpod-review) — precios H100/H200/B300 jul 2026
- [fly.io/docs/gpus](https://fly.io/docs/gpus/) — precios A10/L40S/A100 y anuncio de retiro 1 ago 2026
- [klymentiev.com — Hugging Face Inference API, 2026](https://klymentiev.com/blog/huggingface-inference-api) — precios CPU/GPU endpoints
- [arxiv 2605.20706 — Llamas on the Web: WebGPU LLM inference](https://arxiv.org/html/2605.20706v1) — límites de memoria en navegador, techo ~8B cuantizado
- [localaimaster.com — WebLLM: Run LLMs in Your Browser 80% native speed](https://localaimaster.com/blog/webllm-browser-ai-guide) — rendimiento WebGPU
- [contentbuffer.com — Run a Local LLM on Android with llama.cpp + Vulkan](https://www.contentbuffer.com/guides/run-local-llm-android-llamacpp-vulkan) — recomendación 6-8GB+ RAM para 1B
- [klymentiev.com — OpenRouter Free Tier 2026](https://klymentiev.com/blog/openrouter-free-tier) — límites 20 rpm, 50/1000 req-día
- [teamday.ai — Best Free Models on OpenRouter jul 2026](https://www.teamday.ai/blog/best-free-ai-models-openrouter-2026) — roster y advertencia de no-producción
- [bitdoze.com — OpenCode Go: 12 AI Coding Models for $10/Month](https://www.bitdoze.com/opencode-go-plan/) — estructura de precio bundle
- [aihackers.net — OpenCode Zen review](https://aihackers.net/tools/opencode/) — advertencia de roster "moving target"
- [embeddingcost.com — Embedding Cost calculator/comparison 2026](https://embeddingcost.com/) — precios embeddings API vs self-host
