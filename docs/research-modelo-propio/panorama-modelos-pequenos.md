# Panorama de modelos de lenguaje pequeños (sub-2B) — julio 2026

## Resumen ejecutivo

A mediados de 2026 hay una oferta madura y **mayormente Apache 2.0** de modelos base sub-2B, con foco creciente en edge/on-device (celular, browser, Raspberry Pi). Para español específicamente, la mejor base abierta con checkpoint pre-entrenado (no solo instruct) sigue siendo **Salamandra-2B** (BSC-LT, Apache 2.0, entrenado con 35 idiomas europeos incluido español con peso alto), aunque a 2.25B parámetros excede el rango "sub-1B sub-2GB RAM" que pide Simón. Para sub-1B con buen multilingüe (incluye español, no español-first) las mejores bases genéricas para fine-tunear son **Qwen3-0.6B** y **SmolLM3/SmolLM2 (135M-1.7B)**, ambas Apache 2.0 con checkpoints base disponibles. Para el caso concreto "corre en navegador o Android de 2-4GB", los candidatos más fuertes de 2026 son **LFM2.5-230M** (Liquid AI, corre en Raspberry Pi 5 y celulares gama media/alta) y **Gemma 3 270M** (Google, license custom Gemma-3, no Apache), ambos pensados explícitamente para el edge extremo. IBM **Granite 4.0 Nano 350M** (Apache 2.0, octubre 2025) es la opción más "browser-native" documentada — corre directamente en el navegador vía WebGPU/transformers.js. Ningún modelo pequeño (sub-2B) tiene español como idioma dominante de entrenamiento salvo Salamandra y EuroLLM (ambos multilingües europeos, no español-first); esto confirma que MaatWork necesitará fine-tuning/continued-pretraining propio para calidad conversacional rioplatense, no solo un fine-tune superficial de instrucciones.

## Hallazgos

### SmolLM2 / SmolLM3 (Hugging Face)
- **SmolLM2**: familia de 135M, 360M y 1.7B parámetros, licencia **Apache 2.0**, checkpoints base e instruct disponibles. El 360M se entrenó con ~4T tokens (FineWeb-Edu, DCLM, The Stack + datasets filtrados nuevos). SmolLM2-1.7B supera a Llama-3.2-1B en HellaSwag (68.7% vs 61.2%), ARC (60.5% vs 49.2%) y PIQA (77.6% vs 74.8%) [neurohive.io, sin fecha exacta pero post-lanzamiento 2024]. Sin benchmarks públicos específicos de español encontrados.
- **SmolLM3-3B**: lanzado 8 julio 2025 por HuggingFaceTB. Decoder-only con GQA + NoPE (ratio 3:1), 11.2T tokens de entrenamiento, licencia **Apache 2.0**, 100+ checkpoints intermedios públicos en `HuggingFaceTB/SmolLM3-3B-checkpoints`, orientado a razonamiento y multilingüe/long-context. Está por encima del rango sub-2B que pide Simón, pero es referencia de arquitectura y metodología de entrenamiento reproducible (fuente: huggingface.co/HuggingFaceTB/SmolLM3-3B-Base).

### Qwen3 0.6B / 1.7B (Alibaba)
- Lanzados 28 abril 2025 dentro del lineup dense Qwen3 (0.6B, 1.7B, 4B, 8B, 14B, 32B). **Licencia Apache 2.0** en toda la familia, permite fine-tuning y uso comercial sin restricciones. Hay checkpoints **base** (no solo instruct) para 0.6B y 1.7B, soporte de "thinking mode" dual (razonamiento explícito vs respuesta directa) heredado del diseño Qwen3. Buen soporte multilingüe genérico (Qwen entrena con mezcla masiva de idiomas incluyendo español), aunque no hay reporte específico de benchmarks en español encontrado en esta pasada. Es la base "todo terreno" más citada para fine-tuning ligero por su ecosistema de tooling (Unsloth, llama.cpp, vLLM) ya maduro [unsloth.ai/docs, baeseokjae.github.io].

### Gemma 3 270M / 1B (Google) — y nota sobre Gemma 4
- Gemma 3 incluye tamaños 270M, 1B, 4B, 12B, 27B; el 270M y 1B son solo texto. Hay variantes **QAT** (quantization-aware training) para 1B, 4B, 12B, 27B que preservan calidad cercana a BF16 con ~3x menos memoria. Soporta 140+ idiomas incluido español. Fine-tuning gratis vía Colab documentado por Unsloth. **Licencia: Gemma Terms of Use** (custom, no Apache) — permite uso comercial pero con "Prohibited Use Policy" que se propaga a fine-tunes/adapters y obliga a redistribuir avisos y la licencia junto con el modelo modificado (fuente: wcr.legal, análisis legal 2026).
- **Gemma 4** (lanzado abril 2026, según artificialanalysis.ai) pasó a **licencia Apache 2.0 pura**, sin restricciones de "Prohibited Use Policy" heredadas — cambio importante para cualquiera que use Gemma comercialmente. PERO Gemma 4 **no tiene variantes sub-1B**: el tamaño más chico es E2B (~2.3B "efectivo", con audio+imagen+texto). Es decir, para el rango sub-1B que necesita Simón, **Gemma 3 270M/1B siguen siendo la única opción Gemma disponible, y siguen bajo la licencia custom más restrictiva**, no la Apache 2.0 de Gemma 4.

### LFM2 / LFM2.5 (Liquid AI)
- **LFM2** (2025): arquitectura híbrida (attention + convolución/SSM), tamaños 350M, 700M, 1.2B, contexto 32K, bfloat16, vocab 65K, formato ChatML. LFM2-1.2B compite con Qwen3-1.7B (47% más parámetros); LFM2-700M supera a Gemma 3 1B IT; LFM2-350M compite con Qwen3-0.6B y Llama 3.2 1B Instruct. Evaluado en 7 benchmarks incluyendo multilingüe (MGSM, MMMLU) en 7 idiomas **incluido español**. **Licencia**: base Apache 2.0 más licencia custom "lfm1.0" para ciertos usos — verificar términos exactos antes de despliegue comercial (fuente: liquid.ai blog, x.com/gm8xx8).
- **LFM2.5-230M** (2026, el más nuevo de la familia): 230M parámetros, contexto 32K, pensado explícitamente para "correr en cualquier lado" — 213 tok/s en Samsung Galaxy S25 Ultra, 42 tok/s en Raspberry Pi 5. Benchmarks: GPQA Diamond 25.41, IFEval 71.71, IFBench 38.40, BFCLv4 21.03. No se documentó explícitamente soporte de español ni licencia exacta en la página oficial consultada — requiere verificación directa en el model card de Hugging Face antes de decidir (fuente: liquid.ai/blog/lfm2-5-230m).

### MobileLLM (Meta)
- Familia 125M, 350M, 600M, 1B (paper original julio 2024, pesos publicados después). Mejoras de 2.7% y 4.3% en accuracy zero-shot vs SOTA previo en 125M/350M respectivamente. **Licencia: CC-BY-NC 4.0 (no comercial)** — esto es una limitación dura: **no sirve para Simón en producción** sin negociar licencia aparte con Meta, pese a la buena arquitectura (fuente: venturebeat.com, huggingface.co/facebook/MobileLLM-125M). Nota: existe variante `facebook/MobileLLM-1.5B` también bajo CC-BY-NC-4.0.

### Granite 4.0 Nano (IBM)
- Lanzado 28 octubre 2025. 8 modelos en 2 tamaños (350M y ~1B), variantes híbridas SSM+transformer y transformer puro, cada uno en base e instruct. **Licencia Apache 2.0**. Soporta español entre 12 idiomas certificados. Diseñado explícitamente para correr en laptop CPU (8-16GB RAM) y — según VentureBeat — **directamente en el navegador**, lo que lo hace el candidato más documentado para el caso de uso "browser" de Simón. Certificación ISO 42001 de IA responsable (fuente: huggingface.co/blog/ibm-granite/granite-4-nano, siliconangle.com, marktechpost.com, todas oct 2025).

### Falcon-H1 / Falcon-H1-Tiny (TII)
- Falcon-H1: familia híbrida (attention + SSM) de 0.5B a 34B, base+instruct, licencia basada en Apache 2.0 (paper jul 2025, arxiv 2507.22448).
- **Falcon-H1-Tiny** (enero 2026, TII/tii.ae): 15 modelos "extremadamente pequeños", con tamaños desde **90M** (`Falcon-H1-Tiny-90M-Base`) hasta 0.6B (`Falcon-H1-Tiny-R-0.6B`), cubriendo chat general, multilingüe, código, function-calling y razonamiento. Resultados competitivos en AIME24/25, LiveCodeBench, Math500 pese al tamaño. Licencia permisiva basada en Apache 2.0. Es la familia más reciente (2026) con foco explícito en "extreme small scale" — vale la pena evaluar el 90M-350M para el caso "navegador de gama muy baja" (fuente: huggingface.co/spaces/tiiuae/tiny-h1-blogpost, tii.ae/insights).

### Salamandra 2B (Barcelona Supercomputing Center)
- Suite de 2B, 7B, 40B, **Apache 2.0**, entrenada desde cero en **35 idiomas europeos** (español con peso alto) + 92 lenguajes de programación, 2.4T tokens de corpus (Salamandra-2B usa ~12.875T tokens totales contando épocas repetidas, fuente: model card HF). Arquitectura: 2,253,490,176 parámetros, 24 capas, hidden 2048, 16 attention heads, contexto 8192, vocab 256K. Hay **checkpoint base** (`BSC-LT/salamandra-2b`) e instruct separado.
- Benchmarks español (5-shot): COPA 72.8%, XStoryCloze 64.73%, XQuAD 57.59%, XNLI 44.74% — comparado contra EuroLLM-1.7B, FLOR-1.3B y Gemma-2-2B, con desempeño competitivo (arxiv.org/pdf/2502.08489, Salamandra Technical Report).
- Advertencia propia del paper: el modelo base muestra sesgos cognitivos (efectos de primacía fuertes en 0-shot) — **recomienda tuning de seguridad específico antes de producción**, dato directamente relevante para Simón dado el contexto infantil.
- Relacionado: **ALIA**, iniciativa del gobierno español (PERTE de la Lengua) liderada por BSC, primer LLM diseñado específicamente para las lenguas oficiales de España — mismo linaje técnico que Salamandra.

### EuroLLM (consorcio europeo: Unbabel, IST, Edinburgh, etc.)
- EuroLLM-1.7B: **Apache 2.0**, 4T tokens, 35 idiomas incluido español, hay checkpoint pre-entrenado (`utter-project/EuroLLM-1.7B`) y variante instruct. Buen soporte multilingüe balanceado por diseño (proyecto financiado por la UE explícitamente para no sesgar hacia inglés). Referencia usada por el propio paper de Salamandra como comparación directa.

### Phi-4-mini (Microsoft) — referencia, no sub-2B
- 3.8B parámetros, lanzado 26 feb 2025, **licencia MIT**, ~3GB VRAM, contexto 128K, líder de clase 3-4B en MMLU (67.3% 5-shot) y GSM8K (88.6%). Excede el rango sub-2B de Simón pero es referencia de calidad/licencia MIT (la más permisiva de todas las revisadas). Sin datos específicos de español encontrados en esta pasada de investigación.

### OLMo 2 (Allen Institute)
- Familia completamente abierta (pesos + datos + código + logs de entrenamiento + miles de checkpoints intermedios), pero los tamaños documentados son 7B, 13B, 32B — **no hay variante sub-2B confirmada** en esta investigación (arxiv 2501.00656). Relevante solo como referencia de "apertura total" para el laboratorio propio de MaatWork, no como base de fine-tuning directo.

### Modelos para navegador (WebGPU / transformers.js)
- Transformers.js v3 (oct 2024) soporta WebGPU (hasta 100x más rápido que WASM), 120 arquitecturas, 1200+ modelos pre-convertidos en HF Hub. Recomendación práctica de la comunidad: usar modelos ≤2B para velocidad interactiva en browser; casos como autocompletado, clasificación, moderación de contenido y traducción en tiempo real funcionan bien con sub-2B en WebGPU (maddevs.io, huggingface.co/blog/transformersjs-v3).
- Mejor candidato documentado explícitamente para "corre en el navegador" hoy: **Granite 4.0 Nano 350M** (Apache 2.0) y **SmolLM2-135M/360M** (Apache 2.0, ya empaquetados como demos en el navegador por HF). LFM2.5-230M y Falcon-H1-Tiny 90-350M son candidatos nuevos de 2026 pendientes de validar en WebGPU pero prometen por su foco en edge extremo.

## Implicaciones para Simón-MaatWork

1. **No hay atajo español-first sub-1B listo para producción.** Salamandra es la mejor base con buen español, pero a 2.25B es pesada para "Android 2-4GB + browser". Las opciones sub-1B (Qwen3-0.6B, SmolLM2, Gemma3-270M/1B, LFM2-350M/230M, Falcon-H1-Tiny, Granite-4.0-Nano-350M) tratan el español como uno más de docenas de idiomas — la calidad conversacional en rioplatense dependerá enteramente del fine-tuning/continued-pretraining que haga MaatWork, no de lo que traiga el modelo de fábrica.
2. **Licencia: evitar MobileLLM (Meta) para producción** — CC-BY-NC-4.0 bloquea uso comercial sin acuerdo aparte con Meta. Vigilar también Gemma 3 270M/1B: license custom con obligaciones que se propagan al fine-tune (a diferencia de Gemma 4, que sí es Apache 2.0 puro pero no baja de ~2.3B). Todo lo demás relevante (Qwen3, SmolLM2/3, Granite 4.0 Nano, Salamandra, EuroLLM, Falcon-H1) es Apache 2.0 franco.
3. **Mejor punto de partida concreto según el objetivo doble de Simón:**
   - *Base sub-1B para fine-tunear con mejor arquitectura/tooling maduro*: **Qwen3-0.6B** (Apache 2.0, checkpoint base, ecosistema Unsloth/llama.cpp ya rodado) o **SmolLM2-360M/1.7B** (Apache 2.0, receta de entrenamiento totalmente documentada por HF, útil como referencia metodológica para el laboratorio propio con la RTX 3060).
   - *Sub-500M utilizable en navegador de gama baja*: **Granite 4.0 Nano 350M** (Apache 2.0, documentado corriendo en browser vía WebGPU, 12 idiomas incluido español) es hoy la opción más verificable. **LFM2.5-230M** y **Falcon-H1-Tiny 90M-350M** son alternativas más nuevas (2026) con métricas de velocidad en hardware real (Raspberry Pi 5, Galaxy S25) pero con licencia/soporte de español a confirmar antes de comprometerse.
4. **Guardrails**: ninguno de estos modelos base trae seguridad infantil integrada — confirma que la arquitectura de Simón (regex determinística + cascada de moderación server-side sin streaming) debe permanecer completamente independiente del modelo generativo, tal como está diseñada hoy. El propio paper de Salamandra advierte explícitamente que el modelo base necesita "tuning de seguridad" antes de uso final — razón adicional para no relajar la capa de moderación al migrar de DeepSeek a un modelo propio pequeño.
5. **Laboratorio propio con RTX 3060 12GB + USD 10K**: la ruta más realista es continued-pretraining/fine-tuning full o LoRA sobre una base Apache 2.0 sub-1B (Qwen3-0.6B o SmolLM2 family) con corpus propio en español rioplatense, siguiendo la receta pública de SmolLM2/SmolLM3 (currículum de datos en etapas, datasets documentados) como plantilla metodológica, en vez de entrenar desde cero.

## Fuentes

- https://huggingface.co/HuggingFaceTB/SmolLM3-3B-Base — jul 2025, arquitectura/tokens/licencia SmolLM3
- https://github.com/huggingface/smollm/blob/main/text/README.md — receta de entrenamiento SmolLM2/3
- https://unsloth.ai/docs/models/tutorials/qwen3-how-to-run-and-fine-tune — Qwen3 lineup, licencia, fine-tuning
- https://baeseokjae.github.io/posts/qwen-3-full-lineup-guide-2026/ — guía completa Qwen3 2026
- https://unsloth.ai/blog/gemma3 — Gemma 3 270M/1B, QAT, fine-tuning
- https://ai.google.dev/gemma/docs/core — Gemma 4 overview, abril 2026
- https://artificialanalysis.ai/articles/gemma-4-everything-you-need-to-know — Gemma 4 tamaños y licencia Apache 2.0
- https://wcr.legal/google-gemma-license-risks/ — análisis legal licencia Gemma custom vs Apache
- https://www.liquid.ai/blog/liquid-foundation-models-v2-our-second-series-of-generative-ai-models — LFM2 350M/700M/1.2B, benchmarks
- https://www.liquid.ai/blog/lfm2-5-230m — LFM2.5-230M, 2026, velocidad en hardware real
- https://huggingface.co/facebook/MobileLLM-125M — licencia CC-BY-NC-4.0
- https://venturebeat.com/ai/meta-makes-its-mobilellm-open-for-researchers-posting-full-weights — MobileLLM release y restricción no-comercial
- https://huggingface.co/blog/ibm-granite/granite-4-nano — Granite 4.0 Nano, oct 2025, Apache 2.0, browser
- https://huggingface.co/ibm-granite/granite-4.0-350m-base — checkpoint base Granite 4.0 Nano
- https://falcon-lm.github.io/blog/falcon-h1/ — Falcon-H1 familia, arquitectura híbrida
- https://huggingface.co/spaces/tiiuae/tiny-h1-blogpost — Falcon-H1-Tiny, ene 2026, 90M-0.6B
- https://huggingface.co/BSC-LT/salamandra-2b — model card completo, arquitectura, benchmarks español
- https://arxiv.org/pdf/2502.08489 — Salamandra Technical Report
- https://huggingface.co/utter-project/EuroLLM-1.7B — EuroLLM base, Apache 2.0, 35 idiomas
- https://aiwiki.ai/wiki/phi_4_mini — Phi-4-mini specs, licencia MIT
- https://arxiv.org/abs/2501.00656 — OLMo 2, apertura total pero sin variante sub-2B
- https://huggingface.co/blog/transformersjs-v3 — Transformers.js v3, WebGPU, modelos en navegador
- https://strongmocha.com/ai-infrastructure-data-centers/alia-the-spanish-answer/ — proyecto ALIA, contexto español gubernamental
