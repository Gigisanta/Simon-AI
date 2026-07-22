# Inferencia de LLMs en el navegador — estado 2026 (para Simón/MaatWork)

## Resumen ejecutivo

En julio de 2026, correr un LLM conversacional en el navegador de un usuario argentino promedio (celular Android de gama baja/media, 2-4GB RAM) es técnicamente posible pero con un techo de tamaño muy bajo: **modelos de ~100M-500M parámetros cuantizados a q4 (100-350MB de descarga)** son el rango realista para una experiencia fluida en la mayoría de los dispositivos; 1B es el límite superior aceptable solo si hay WebGPU y algo de paciencia en la primera respuesta. WebGPU llegó a **stable en todos los navegadores mayores** (Chrome/Edge/Firefox desde 2023, **Safari 26 con iOS 26 en 2025**), con ~78-82% de cobertura global, pero en Android real la fracción con GPU compatible y suficiente RAM libre es más baja y variable. El stack recomendado es **transformers.js v3 (ONNX Runtime Web, backend WebGPU con fallback WASM)** por su tooling de conversión maduro y su fallback automático, con **wllama** como alternativa cuando se quiera reusar directamente checkpoints GGUF de llama.cpp sin conversión. WebLLM/MLC es más veloz en GPUs potentes pero exige compilar el modelo al formato MLC (paso adicional) y su huella de memoria mínima lo hace menos apto para gama baja. La Prompt API de Chrome (Gemini Nano) no sirve como reemplazo de un modelo propio: es de terceros, no garantiza soporte robusto de español, y no cumple el requisito de "modelo propio MaatWork". Para Simón, la recomendación es **no depender del navegador como única vía**: usar in-browser inference como *modo degradado/offline* opcional (con fallback duro a "no disponible, escribile a un adulto") nunca como reemplazo de la cascada de moderación server-side, que debe seguir corriendo igual con cualquier salida generada.

## Hallazgos

### 1. WebLLM / MLC-LLM — estado y modelos soportados

WebLLM (`mlc-ai/web-llm`) es "a high-performance in-browser LLM inference engine" acelerado 100% por WebGPU, sin servidor, compatible con la API de OpenAI (streaming, JSON mode, function calling) (github.com/mlc-ai/web-llm, README consultado 22 jul 2026, release **v0.2.83, 24 abr 2026**, 18.4k stars). Soporta familias Llama 3/2, Phi 3/2/1.5, Gemma, Mistral, Qwen vía `prebuiltAppConfig.model_list`. Benchmarks citados en fuentes secundarias (localaimaster.com, no verificado en fuente primaria): en M3 Max, Llama 3.1 8B q4 a 41 tok/s y Phi 3.5 mini a 71 tok/s (~71-80% de velocidad nativa) — pero eso es hardware de escritorio Apple Silicon, **no representativo de un Android de gama baja**.

**Agregar un modelo propio**: requiere pasar por el pipeline de **MLC-LLM** (proyecto hermano, Python): `mlc_llm convert_weight <dir> --quantization q4f16_1 -o <out>` y luego `mlc_llm gen_config` para generar `mlc-chat-config.json` y tokenizer (llm.mlc.ai/docs/compilation/, consultado 22 jul 2026). WebLLM después consume dos artefactos: la URL de pesos/metadata y la URL de la librería wasm compilada específica del modelo (webllm.mlc.ai/docs/developer/add_models.html). Esto es un paso de compilación no trivial por cada arquitectura/tamaño — más fricción que transformers.js para un modelo custom entrenado desde cero.

### 2. transformers.js v3+ — ONNX Runtime Web, WebGPU vs WASM

Transformers.js v3 (Hugging Face, lanzado **22 octubre 2024**, huggingface.co/blog/transformersjs-v3) añadió soporte WebGPU, nuevos formatos de cuantización y 120 arquitecturas soportadas, con más de 1200 modelos preconvertidos en el Hub. Usa **ONNX Runtime Web** como motor; activar GPU es tan simple como `device: 'webgpu'` al cargar el modelo. La diferencia de rendimiento WebGPU vs WASM es dramática: se reporta **hasta 100x más rápido** en el blog oficial, y benchmarks de sitepoint.com muestran para all-MiniLM-L6-v2 (batch 1): WASM 378ms vs WebGPU 32ms — pero eso es un modelo de embeddings pequeño, no un LLM generativo completo; la ganancia relativa en decodificado autoregresivo suele ser menor (10-15x según pkgpulse.com, no verificado en fuente primaria).

**Convertir modelo propio**: script oficial `python -m scripts.convert --quantize --model_id <id>`, que exporta a ONNX y cuantiza (q8/q4/fp16); luego se sube al Hub con el tag `transformers.js` para que la librería lo descubra automáticamente. Este flujo es más simple que el de MLC porque no requiere compilar wasm específico por modelo — el runtime ONNX es genérico.

Dato de rendimiento citado (fuente secundaria, buildmvpfast.com/pockit.tools, no confirmado en blog oficial): FP16 cuantizado corre ~40% más rápido que FP32 con pérdida mínima de precisión en WebGPU, y Llama-3.2-1B logra **~20 tok/s en navegador**.

### 3. wllama (llama.cpp en WASM)

`ngxson/wllama` compila el código C++ de llama.cpp directamente a WebAssembly: **cualquier checkpoint GGUF cuantizado de Hugging Face funciona sin paso de conversión** (github.ngxson.com/wllama/docs/, consultado 22 jul 2026). Corre en CPU vía WASM SIMD, sin dependencias runtime, con multi-hilo vía SharedArrayBuffer (requiere headers `Cross-Origin-Embedder-Policy` y `Cross-Origin-Opener-Policy` para habilitarlo — si faltan, cae a single-thread automáticamente). Soporta todos los formatos de cuantización GGUF (Q4_K_M, Q5_K_M, Q8_0, etc.), tool calling, capacidades multimodales de imagen/audio y API OpenAI-compatible.

**Límite crítico de tamaño de archivo**: el máximo por archivo es **2GB, por la restricción de tamaño de `ArrayBuffer`** en JS — para modelos mayores hay que trocearlos, y la doc recomienda chunks de máx. 512MB para descargas paralelas más rápidas. Para los tamaños que nos interesan (100M-2B params en q4 = decenas a cientos de MB) este límite no es un problema.

WASM no alcanza el throughput de WebGPU en modelos grandes, pero cumple dos roles clave: **fallback universal para dispositivos sin GPU compatible**, y target de compilación para motores no-JS. wllama también expone soporte WebGPU opcional (no confirmado el detalle exacto de qué backend usa por default).

### 4. Soporte real de WebGPU en 2026

- **Global**: ~70-82% según la fuente (programming-helper.com cita 82% "según caniuse" en 2026; byteiota.com cita 70%; ambas cifras no verificadas contra caniuse.com directamente — recomiendo chequear caniuse en el momento de decidir, la variación entre fuentes sugiere metodologías distintas).
- **Chrome/Edge desktop**: WebGPU es stable desde Chrome 113 (2023).
- **Chrome Android**: soporte desde **Chrome 121** (llegó primero solo para GPUs Qualcomm Adreno serie 600+, se expandió a Mali-G78+ en **Chrome 123**) y requiere **Android 12+**. Al Q1 2026, ~**78% de usuarios de Chrome Android** tienen acceso hardware-acelerado a WebGPU según una fuente (github.com/Fyrd/caniuse issue #6979 + búsquedas secundarias) — pero esto es "usuarios de Chrome Android", no "usuarios de Android en general"; un Android viejo (< Android 12) o con GPU no soportada simplemente no tiene WebGPU, punto.
- **Safari/iOS**: **WebGPU pasó a stable en Safari 26 (2025), habilitado por defecto en iOS 26, iPadOS 26, macOS Tahoe 26** (webkit.org/blog "News from WWDC25", junio 2025; confirmado por múltiples fuentes secundarias de 2026). Antes de esto Safari/iOS era el hueco más grande de la matriz — ya cerrado a mediados de 2025/2026.
- **Conclusión práctica para Argentina**: el problema no es tanto "¿existe WebGPU?" sino **el parque de hardware real** — celulares Android de 2-4GB RAM y Android <12 (muy común en el segmento de menor poder adquisitivo) simplemente no califican, sin importar la versión de Chrome. Para ese segmento el fallback WASM/CPU es obligatorio, no opcional.

### 5. Rendimiento real: tokens/segundo por tamaño y dispositivo

Los benchmarks concretos y confiables para *browser* + *gama baja Android* son escasos; la mayoría de benchmarks públicos son de apps nativas (PocketPal, MLC Chat APK) que usan aceleración nativa, no WASM/WebGPU del navegador — hay que tratar esos números como techo optimista, no como lo que se logra dentro de una pestaña.

Datos encontrados (con nivel de confianza indicado):
- **WASM CPU en Android de gama baja, sin GPU**: TinyLlama (1.1B) logra **1-2 tok/s** (deploybase.ai, fuente secundaria no verificada en benchmark original). Esto es la cota inferior real y coincide con la intuición: inaceptable para chat en tiempo real.
- **Apps nativas** (no browser) con modelos 1B-4B (Gemma 3 1B, Llama 3.2 1B/3B, Qwen2.5 1.5B) en Android/iPhone: 15-40 tok/s (localaimaster.com) — sirve como referencia de "lo que el hardware puede dar con aceleración nativa", útil para calibrar expectativas de lo que WebGPU *podría* acercarse si el driver/stack está bien optimizado.
- **Modelo ultra-chico + WebGPU**: un dato llamativo y específico — "**LFM2.5 230M** en navegador con WebGPU alcanza **1400 tok/s**" (essamamdani.com, título del artículo; leído como snippet de búsqueda, no fetcheado en fuente primaria — tratar con escepticismo alto, probablemente medido en desktop GPU potente, no en un Android de gama baja; aun así confirma que en el rango <300M parámetros con WebGPU el throughput deja de ser el cuello de botella).
- Regla general citada: **50-500ms por token** en inferencia browser (rango amplio que cubre desde WebGPU rápido hasta WASM lento) — "aceptable para chat pero no para procesamiento batch de alta velocidad" (buildmvpfast.com).

**Conclusión de rendimiento**: con WebGPU disponible, modelos ≤500M-1B dan experiencia de chat fluida (probablemente >10-20 tok/s incluso en gama media). Sin WebGPU (fallback WASM), solo modelos ≤100-360M dan algo utilizable en tiempo real en gama baja; 1B+ en WASM puro es demasiado lento (1-2 tok/s) para un chat con un chico que espera respuesta.

### 6. Límites de memoria de una pestaña

- **WASM32 clásico**: límite duro de **4GB de memoria lineal** (65536 páginas de 64KB), el máximo direccionable con punteros de 32 bits (v8.dev/blog/4gb-wasm-memory). En la práctica los navegadores rara vez dejan usar los 4GB completos a una sola pestaña por límites de memoria del proceso/dispositivo.
- **Memory64**: proposal liberado en **Firefox 134 y Chrome 133** (~inicios de 2025), agrega punteros de 64 bits, remueve el límite de 4GB. Pero **el propio equipo de SpiderMonkey advierte** (spidermonkey.dev, ene 2025) que Memory64 corre entre 10% y >100% más lento que memoria de 32 bits, y "la única razón para usarlo es si de verdad necesitás más de 4GB" — para nuestros modelos (100M-2B params en q4, decenas/cientos de MB) **no hace falta Memory64**, wasm32 alcanza sobrado.
- **`ArrayBuffer` de JS**: límite práctico de 2GB citado explícitamente por wllama para archivos de modelo individuales — de nuevo, irrelevante para el rango de tamaño que nos interesa.

### 7. Tamaño de descarga por modelo (q4, GGUF)

Dato duro verificado en Hugging Face (búsqueda directa, jul 2026): **SmolLM2-360M-Instruct-GGUF**: Q4_K_M ≈ **271 MB**, Q4_K_S ≈ 260 MB, Q4_0 ≈ 229 MB (huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF).

Extrapolando la regla general "q4 ≈ params × 0.5-0.6 bytes/param + overhead de tokenizer/metadata" (regla de pulgar de la comunidad GGUF, no una fuente única citada):
- **~100M params q4** ≈ 60-90 MB
- **~360M params q4** ≈ 230-270 MB (confirmado arriba)
- **~1B params q4** ≈ 550-700 MB
- **~2B params q4** ≈ 1.1-1.4 GB

Para conexiones argentinas móviles reales (a menudo 3G/4G lento fuera de CABA/GBA), **100-300MB es el techo de "descarga tolerable" en primera visita**; por encima de eso, sin cache/PWA agresiva la fricción de adopción es alta.

### 8. Estrategias de cache

- **Cache API** (Service Worker): estándar para cachear assets estáticos, incluyendo el archivo del modelo, con control fino sobre invalidación por versión.
- **OPFS (Origin Private File System)**: "sistema de archivos virtual de alto rendimiento, privado al origen"; más rápido que IndexedDB para operaciones de archivo, sin pedir permiso repetido al usuario (a diferencia de File System Access API) — es el mecanismo recomendado hoy para persistir pesos de modelo grandes entre sesiones (developer.mozilla.org/OPFS, petemillspaugh.com, consultados jul 2026). El caso de uso real citado (Kiwix PWA) persiste gigabytes de contenido offline con este mecanismo, validando que escala al tamaño de nuestros modelos.
- **Service worker + PWA offline**: patrón estándar — precache del shell de la app, luego cache-on-first-use del modelo vía OPFS o Cache API, con estrategia "cache-first" para el peso una vez descargado (no debería volver a bajar en cada visita).
- Para Simón: esto habilita un modo "instalá la app / agregá a inicio" que descarga el modelo una sola vez y despues funciona sin re-descarga, crítico dado el tamaño de archivo y el costo de datos móviles en Argentina.

### 9. Prompt API / Gemini Nano (Chrome built-in AI)

La Prompt API expone el modelo **Gemini Nano** bajo el objeto global `LanguageModel` (antes `window.ai`), corriendo 100% on-device, gratis, sin cargo de Google por inferencia (developer.chrome.com/docs/ai/prompt-api, consultado jul 2026). Estado de disponibilidad: **limitada a extensiones hasta Chrome 138**; según una fuente (pasqualepillitteri.it, no oficial) **Chrome 148 (Q2 2026) la estabiliza para páginas web normales**, con salida completa del origin trial recién en **Chrome 150 (fines de 2026)** — es decir, a julio de 2026 (fecha de este informe) **todavía está en transición/no es universal para web pages**, solo confirmado para extensiones y trials. Está pensada para tareas léxicas: clasificación, parsing, resúmenes cortos, traducción — no para sostener una conversación emocional extendida y con persona/tono propios.

No encontramos confirmación explícita de calidad de español en las fuentes consultadas. Independientemente de eso, **Gemini Nano no sirve para el objetivo de Simón-MaatWork**: es un modelo de terceros (Google) sin control de fine-tuning, sin garantía de disponibilidad cross-browser (solo Chrome/Chromium, nada de Safari/Firefox), sin capacidad de aplicarle los guardrails de seguridad infantil que MaatWork necesita auditar/entrenar, y su despliegue depende de que Google decida activarlo en el dispositivo del usuario (descarga del modelo gestionada por Chrome, no por MaatWork).

## Implicaciones para Simón-MaatWork

1. **El navegador no reemplaza al servidor para producción hoy.** La cascada de moderación (regex → OpenAI Moderation → juez LLM) y la capa determinística de crisis deben seguir corriendo server-side siempre, incluso si el texto se generó client-side — nunca mostrar output de un modelo en el navegador a un menor sin pasar por la misma cascada. Esto es no-negociable y no cambia con esta investigación.

2. **Tamaño máximo realista para el modelo propio "MaatWork mini" pensado para navegador**: **100M-500M parámetros**, cuantizado q4 (60-270MB de descarga). Esto da margen para funcionar decentemente incluso en WASM puro (sin WebGPU) en Android de gama baja, y muy fluido con WebGPU. 1B es viable solo como "modo mejorado" condicionado a detectar WebGPU + RAM suficiente, nunca como el único camino.

3. **Stack recomendado**: **transformers.js v3 con backend WebGPU y fallback automático a WASM** como primera opción — porque (a) el pipeline de conversión a ONNX es más simple para un modelo entrenado desde cero que compilar a MLC, (b) el fallback WASM es de la misma librería (no hay que mantener dos integraciones), y (c) hay 1200+ ejemplos de modelos convertidos como referencia. **wllama** es la alternativa a evaluar si el equipo de entrenamiento termina exportando a GGUF de todos modos para servir con llama.cpp en el laboratorio local (RTX 3060) — reusar el mismo artefacto GGUF sin reconvertir sería más simple ("un solo formato de exportación para todo"). WebLLM/MLC se descarta como opción principal por el costo de mantenimiento de compilar wasm por modelo/tamaño, aunque es la opción más rápida en hardware potente si alguna vez se necesita.

4. **Fallback sin WebGPU (obligatorio, no opcional) dado el parque argentino**: WASM vía la misma librería (transformers.js con `device:'wasm'`, o wllama). Con un modelo de 100-360M params, WASM da un chat "usable pero lento" en gama baja — aceptable como modo degradado, con expectativa puesta explícitamente frente al usuario ("esto puede tardar unos segundos").

5. **Cache/PWA es obligatorio, no un nice-to-have**: dado el tamaño (decenas-cientos de MB) y el costo/calidad de datos móviles en Argentina, sin OPFS + Service Worker cache-first la fricción de "bajar el modelo cada vez" mata la propuesta. Recomendación: app instalable (PWA), descarga del modelo una sola vez a OPFS, versión con hash para invalidar cache al actualizar el modelo.

6. **Gemini Nano/Prompt API: no usar como base del producto.** Sirve, si acaso, para tareas auxiliares no críticas en el propio panel admin de MaatWork (clasificar/resumir texto interno) — nunca para generar la respuesta que el menor lee, porque no hay control sobre el modelo ni garantía de disponibilidad ni de calidad en español, y rompe el principio de "modelo propio auditado".

7. **Riesgo a marcar para el equipo**: casi todos los benchmarks de tok/s encontrados son de fuentes secundarias no verificadas contra el paper/repo original (marcado explícitamente arriba) — antes de comprometerse a un tamaño de modelo final para el navegador, correr un benchmark propio con el modelo real MaatWork (una vez entrenado) en 2-3 dispositivos Android reales de gama baja/media argentinos, con y sin WebGPU forzado, en vez de confiar en estos números de terceros.

## Fuentes

- github.com/mlc-ai/web-llm — README, consultado 22 jul 2026 — versión v0.2.83 (24 abr 2026), modelos soportados, mecanismo de modelo custom.
- webllm.mlc.ai/docs/developer/add_models.html — doc oficial WebLLM, consultado 22 jul 2026 — cómo agregar modelos (model + model_lib).
- llm.mlc.ai/docs/compilation/convert_weights.html y compile_models.html — doc oficial MLC-LLM, consultado 22 jul 2026 — pipeline de conversión de pesos propios.
- huggingface.co/blog/transformersjs-v3 — blog oficial HF, publicado 22 oct 2024, consultado 22 jul 2026 — novedades v3, WebGPU, script de conversión, tag de descubrimiento.
- github.ngxson.com/wllama/docs/ — doc oficial wllama, consultado 22 jul 2026 — límite de 2GB por ArrayBuffer, headers COOP/COEP, formatos soportados.
- webkit.org/blog/16993 "News from WWDC25: WebKit in Safari 26 beta" — jun 2025, consultado 22 jul 2026 — confirmación WebGPU stable en Safari 26/iOS 26.
- v8.dev/blog/4gb-wasm-memory — V8 blog, consultado 22 jul 2026 — límite de 4GB en wasm32.
- spidermonkey.dev/blog/2025/01/15/is-memory64-actually-worth-using.html — ene 2025, consultado 22 jul 2026 — penalidad de performance de Memory64 (10-100%+).
- huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct-GGUF — consultado 22 jul 2026 — tamaños de archivo Q4 reales (229-271MB).
- developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system — consultado 22 jul 2026 — qué es OPFS y por qué sirve para cachear modelos.
- web.dev/case-studies/kiwix — consultado 22 jul 2026 — caso real de PWA cacheando gigabytes offline con OPFS.
- developer.chrome.com/docs/ai/prompt-api — doc oficial Chrome, consultado 22 jul 2026 — Prompt API, LanguageModel global, modelo Gemini Nano on-device.
- github.com/Fyrd/caniuse issue #6979 "Webgpu Android Chrome 121" — consultado 22 jul 2026 — historial de soporte WebGPU en Chrome Android (Adreno 600+, luego Mali-G78+ en Chrome 123).
- essamamdani.com/blog/lfm2-5-230m-webgpu-browser-inference-1400-tokens-per-second — consultado 22 jul 2026, NO verificado en detalle (solo snippet) — dato de 1400 tok/s con LFM2.5 230M + WebGPU, tratar como no confirmado / posible desktop GPU.
- localaimaster.com/blog/run-llm-on-phone y deploybase.ai/articles/free-open-source-llm-browser — consultados 22 jul 2026, fuentes secundarias no oficiales — cifras de tok/s en apps nativas y WASM gama baja (1-2 tok/s TinyLlama sin GPU; 15-40 tok/s apps nativas 1B-4B).
