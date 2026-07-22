# Seguridad de modelos de lenguaje pequeños on-device para una app infantil de salud emocional (Simón / MaatWork)

> Investigación: julio 2026. Términos técnicos en inglés. Foco: guardrails de seguridad infantil cuando el LLM corre en el dispositivo del menor.

## Resumen ejecutivo

La pregunta central —¿qué arquitectura de seguridad multi-capa es defendible cuando el LLM corre en el dispositivo del menor?— tiene una respuesta con evidencia razonablemente sólida a julio 2026, y **no** favorece "confiar en que el modelo chico sea seguro por sí solo".

Cuatro hechos ordenan la decisión:

1. **El fine-tuning degrada el safety alignment incluso con datos benignos.** Es un resultado replicado 2024-2026: entrenar un modelo alineado sobre datasets sin contenido dañino (GSM8K, código, chit-chat) sube el Attack Success Rate. Para un modelo propio de MaatWork que se va a fine-tunear en español rioplatense, esto es el riesgo #1: el propio proceso de crear el modelo puede romper los guardrails que trae de base.

2. **El safety "baked-in" a un modelo de 100M-2B es real pero frágil.** Modelos chicos son medibles más jailbreakeables que los grandes (paper "Small but Dangerous", Springer 2025). Un 360M puede aprender a rechazar y derivar, pero no es defendible como *única* capa para una app infantil de crisis.

3. **Existen safety classifiers chicos que corren on-device HOY y soportan español.** El más relevante: **Llama Guard 3-1B-INT4** (Meta), 440MB, ≥30 tokens/s y ≤2.5s time-to-first-token en CPU Android de gama media, con soporte oficial de español entre 8 idiomas. Es la pieza que hace viable la moderación local. ShieldGemma no baja de 2B (demasiado para gama baja).

4. **El problema arquitectural es real: si la inferencia es client-side, el servidor ya no ve el output antes que el menor.** Los productos reales (Apple Intelligence, Gemini Nano) lo resuelven con **guardrail models locales pre/post-inferencia**, no moviendo la moderación a la nube. La cascada server-side de Simón deja de ser un gate síncrono y pasa a ser telemetría/auditoría asíncrona.

**Recomendación arquitectural (defendible):** capa determinística local de crisis (regex + plantillas, sin LLM, igual que hoy) → generación local completa (sin streaming) → **classifier local pequeño** (Llama Guard 3-1B-INT4 o encoder DeBERTa distilado) como gate post-generación antes de mostrar → **moderación/juez server-side asíncrona** cuando hay red, para auditoría y mejora, no como gate en vivo. La capa 1 (determinística) es la que sostiene el argumento legal y ético; nunca debe depender del modelo propio.

---

## Hallazgos

### 1. Fine-tuning degrada el alignment aunque los datos sean benignos — y cómo mitigarlo

El resultado base está establecido desde Qi et al. (ICLR 2024) y se ha replicado y profundizado en 2024-2026: **fine-tunear un modelo safety-aligned sobre un dataset benigno degrada su seguridad**, subiendo el Attack Success Rate incluso sin un solo ejemplo dañino en el training set. La causa propuesta es la *brittleness* del alignment: la seguridad vive en un "safety subspace" delgado de parámetros, y los gradientes de datos benignos empujan los pesos fuera de esa región (búsqueda WebSearch, arxiv múltiples, 2024-2026).

Implicación directa para MaatWork: el plan de fine-tunear un modelo propio en español rioplatense es *exactamente* el escenario de riesgo. No alcanza con partir de un base model alineado; el proceso de especialización lo puede desalinear.

Mitigaciones con evidencia (2024-2026), de más a menos práctica para un lab de 1 persona:

- **Safety data mixing:** mezclar obligatoriamente un porcentaje de datos de seguridad (rechazos, derivaciones a adulto/línea de ayuda) en cada batch de fine-tuning. Es la mitigación más barata y directa. El paper de ICLR 2025 "Safety Alignment Should Be Made More Than Just a Few Tokens Deep" argumenta que el alignment superficial (solo los primeros tokens de la respuesta) es la raíz de la fragilidad, y que hay que profundizarlo con datos que fuercen comportamiento seguro más allá del token inicial.
- **Prompt template discrepancy:** introducir una discrepancia entre el prompt template de fine-tuning y el de inferencia mitiga la degradación (NeurIPS 2024, "Keeping LLMs Aligned After Fine-tuning: The Crucial Role of Prompt Templates"). Barato de implementar.
- **Parameter freezing / safety subspace protection:** congelar o proteger el gradiente de los parámetros críticos de seguridad durante el fine-tuning. Más complejo, requiere identificar el subespacio.
- **Data purification / selection:** filtrar del dataset benigno los ejemplos que más dañan el safety loss landscape (p.ej. "Layer-Aware Representation Filtering", arxiv 2025). Útil pero requiere pipeline extra.
- **Evaluación por checkpoint (crítico y de bajo costo):** correr un red-team suite fijo (HarmBench-style) y un eval de crisis en español en *cada checkpoint* del fine-tuning, y quedarse con el checkpoint que maximiza utilidad manteniendo el safety score. Esto convierte la degradación de un riesgo invisible a una métrica observable. **Writer ≠ checker**: el eval de seguridad no lo corre el mismo loop que entrena.

Nota de escepticismo: varios de los arxiv IDs que devolvió la búsqueda (2512.x, 2604.x, 2606.x) son de fecha 2025-2026 y no pude verificar cada uno individualmente; el *patrón* (fine-tuning benigno degrada safety, mitigable con data mixing / deep alignment / checkpoint eval) sí está confirmado por fuentes primarias establecidas (Qi et al. ICLR 2024, ICLR 2025, NeurIPS 2024).

### 2. Safety classifiers chicos que corren on-device y su rendimiento en español

Esta es la buena noticia técnica del informe. Sí existen guardrails que caben en un celular Android de gama baja.

**Llama Guard 3-1B-INT4 (Meta) — la pieza clave.** Fine-tuned desde Llama 3.2 1B, clasifica input y output en 13 categorías de riesgo (taxonomía MLCommons). La variante INT4 combina *pruning + quantization* (matmuls de 4-bit, activaciones de 8-bit) para lograr ~7× de reducción de tamaño:
- **440 MB** de tamaño (arxiv 2411.17713, nov 2024, abstract verificado).
- **≥30 tokens/s** de throughput y **≤2.5s** de time-to-first-token en **CPU** de Android commodity (sin acelerador). Verificado en el abstract.
- ~1.12B parámetros efectivos post-pruning.
- **Soporte oficial de español** entre 8 idiomas (English, French, German, Hindi, Italian, Portuguese, Spanish, Thai). Meta incluyó prompts benignos multilingües en el training para bajar el false positive rate por idioma. F1 en inglés reportado ~0.904 (INT4) vs 0.899 (1B full); no pude verificar el F1 específico de español en el abstract, hay que leer la tabla del PDF completo antes de comprometerse.
- License: Llama 3.2 Community License (no es OSI-approved; tiene cláusula de uso aceptable y umbral de 700M MAU). Aceptable para MaatWork por escala, pero conviene leer la AUP porque una app de menores toca varias de sus cláusulas.

**ShieldGemma (Google) — no sirve para gama baja.** La familia va de **2B a 27B**; el menor es 2B (verificado, MarkTechPost ago 2024). Cubre 6 categorías (sexually explicit, hate speech, dangerous content, harassment, violence, obscenity/profanity). SG-9B supera a Llama Guard 1 por 10.8% de AU-PRC. ShieldGemma 2 pasó a Gemma-3 y clasifica imágenes. Un 2B en INT4 son ~1.2-1.5GB: viable en gama media, apretado o inviable en 2-3GB RAM corriendo *además* del modelo generativo. **Descartar para el escenario de gama baja; considerar solo como classifier server-side o para dispositivos con ≥4GB.**

**Encoder classifiers (DeBERTa/RoBERTa) — la opción más liviana.** Un encoder es órdenes de magnitud más chico y rápido que un LLM decoder para clasificación:
- **Prompt Guard / Prompt Guard 2** (Meta, basado en DeBERTa-v2): filtro de input rápido y barato para jailbreaks/prompt-injection.
- **Distilación de Llama-Guard-3-8B a DeBERTa-v3-large (435M params)** para deployment en dispositivos con recursos limitados (mencionado en survey de collaborating small/large LLMs, arxiv 2510.13890).
- **xlm-roberta multilingüe** para toxicidad (unitary/multilingual-toxic-xlm-roberta; malexandersalazar/xlm-roberta-large-binary-cls-toxicity) — soportan español entre 7 idiomas: threat, obscene, insult, identity-hate.
- Existen datasets multilingües de toxicidad safe/unsafe en inglés, alemán y español para entrenar classifiers propios.

Trade-off encoder vs Llama Guard: el encoder es más chico/rápido y se puede fine-tunear con la RTX 3060 local en horas, pero cubre categorías más genéricas (toxicidad) y no viene con la taxonomía de crisis/self-harm afinada. **Un DeBERTa multilingüe propio, fine-tuneado con datos de self-harm/violencia/sexual en español rioplatense, es probablemente la mejor relación tamaño/control** para la capa local, con Llama Guard 3-1B-INT4 como alternativa "lista para usar" si el lab no llega a entrenar el encoder.

### 3. El problema arquitectural: inferencia client-side rompe el gate server-side

Hoy Simón genera completo → modera server-side (regex → OpenAI Moderation → juez LLM) → recién muestra. Ese diseño **depende de que el output pase por el servidor antes que por el menor**. Si el LLM propio corre on-device o en el navegador (WebLLM/WebGPU), esa garantía desaparece: el output existe en el dispositivo antes de que ningún servidor lo vea, y un cliente comprometido o offline nunca lo manda.

Cómo lo resuelven los productos reales — y la respuesta es unánime: **la moderación se hace también on-device, con guardrail models locales.**

- **Apple Intelligence (modelo on-device ~3B, tech report 2025):** estrategia multi-capa con dos componentes. (a) El modelo entrenado para ser "cauteloso" (safety baked-in). (b) **Guardrail models que corren como pre- y post-processing en el momento de inferencia**, evaluando daño en input y output *localmente*. Además: multilingual post-training alignment a nivel foundational, adapters feature-specific con safety data, y guardrails con language-specific training. La moderación NO se delega a la nube: viaja con el modelo. (Nota: investigadores ya reportaron bypasses de estos guardrails —SecurityWeek, jun 2025—, lo que refuerza el principio de defensa en profundidad, no una sola capa.)
- **Gemini Nano (Android on-device):** safety filters integrados en el runtime on-device, mismo patrón: la seguridad se empaqueta con el modelo local.
- **Arquitecturas híbridas (patrón general 2025-2026):** el modelo local intenta primero y **escala a la nube solo cuando hace falta**. Para safety esto se traduce en: gate local sincrónico + verificación/auditoría cloud asíncrona cuando hay red.

Conclusión arquitectural para Simón: la cascada server-side no se elimina, **se recategoriza**. Deja de ser el gate que decide si el menor ve el mensaje (imposible si la inferencia es local) y pasa a ser: (a) telemetría de seguridad para detectar drift y falsos negativos, (b) segunda opinión asíncrona que puede disparar intervención humana/alerta a tutor, (c) fuente de datos para re-entrenar los classifiers locales. El gate *en vivo* tiene que ser 100% local.

### 4. ¿Safety baked-in a un 360M es robusto o ilusorio?

Evidencia mixta, con conclusión clara para uso infantil.

- **Los modelos chicos son medibles más vulnerables.** El paper "Small but Dangerous: Evaluating and Mitigating Jailbreak Vulnerabilities in Small Language Models" (Springer, 2025) es exactamente sobre esto: los SLMs tienen mayor jailbreak success rate que los grandes y necesitan mitigación explícita. No pude extraer las cifras exactas (paper detrás de paywall Springer), pero la tesis del título y el framing son inequívocos.
- **El refusal se puede borrar con una sola dirección.** "Refusal in language models is mediated by a single direction" y trabajos de 2025-2026 sobre "Refusal-Escape Directions" muestran que el comportamiento de rechazo, sobre todo en modelos chicos, es una feature frágil y localizada — fácil de suprimir con perturbaciones o fine-tuning.
- **Pero el safety baked-in no es inútil:** sí baja la tasa base de outputs dañinos y da un comportamiento por defecto de derivar/rechazar. Es una *capa*, valiosa como primer filtro y como fallback, no como garantía.

Veredicto: para una app infantil de salud emocional, **confiar en el safety interno de un 100M-2B como única barrera es indefendible** (legal, ética y técnicamente). El comportamiento seguro debe estar baked-in *y* verificado por un classifier externo local *y* respaldado por la capa determinística. Ninguna sola de las tres alcanza.

### 5. Regulación 2025-2026 relevante para un companion infantil argentino

Argentina no tiene aún una ley específica de companion bots (a julio 2026), pero el estándar de facto lo fijan tres jurisdicciones que importan porque definen "qué es diligencia razonable" y porque cualquier expansión o inversión los va a exigir:

- **California SB 243 (firmada 13-oct-2025, vigente 1-ene-2026)** — la más operativa. Primera ley estatal USA que obliga safeguards en companion chatbots. Requisitos relevantes para Simón (fuente: Skadden, oct 2025, verificado): (a) disclosure de que es IA, y para menores conocidos, recordatorio "tomá un descanso / no soy humano" **cada 3 horas**; (b) **protocolo publicado para prevenir contenido de ideación suicida / suicidio / self-harm**, con derivación a crisis service providers cuando se detecta; (c) medidas razonables para prevenir material sexualmente explícito hacia menores; (d) reporte anual a la Office of Suicide Prevention desde 1-jul-2027; (e) **private right of action**: daños mínimos de **USD 1.000 por violación** o daño real, el mayor, más honorarios. Definición de companion chatbot: interfaz de lenguaje natural con respuestas adaptativas human-like capaz de sostener una relación a lo largo de interacciones — Simón califica de lleno.
- **EU AI Act, Artículo 5 (prohibiciones vigentes desde 2-feb-2025):** prohíbe sistemas de IA que exploten vulnerabilidades por edad o discapacidad, o que usen técnicas subliminales/manipulativas. Chatbots de companionship están explícitamente señalados como riesgo para menores (fomento de dependencia emocional). Julio 2025: guidelines de la Comisión sobre protección de menores online (escalation mechanisms, age verification, auditoría independiente). Oct 2025: el Parlamento pide enforcement firme contra chatbots manipulativos. El precedente Replika (Garante italiano) muestra que la falta de age verification y controles es sancionable.
- **Federal / otros estados USA:** propuestas de ley (Husted, sept 2025) para proteger menores de contenido sexual de companion chatbots; el patrón regulatorio se está estandarizando alrededor de suicide/self-harm protocols + disclosure + age gating.

Implicación: aunque Simón sea argentino, el diseño debe cumplir SB 243 y el AI Act como *baseline*, porque (a) definen el estándar de cuidado que un juez o inversor va a mirar, y (b) MaatWork explícitamente NO simula terapeuta, lo que ayuda pero no exime de los deberes de self-harm protocol y disclosure.

### 6. Evaluaciones de seguridad en salud mental y en español

- **VERA-MH (Spring Health + Expert Council, 20-oct-2025)** — "Validation of Ethical and Responsible AI in Mental Health": primer eval open-source clínicamente fundado para chatbots de salud mental, **foco inicial en suicide risk**. Mecánica: dos agentes ancilares — un *user-agent* que simula personas con niveles de riesgo predefinidos, y un *judge-agent* que puntúa contra un rubric construido por clínicos. Validación: inter-rater reliability clínica 0.77; el LLM judge alineó 0.81 con el consenso clínico (arxiv 2510.15297 concept paper; estudio de validación humana arxiv 2602.05088). RFC abierto hasta 20-dic-2025. Spring Health tiene además un track específico "Safer AI Standards for Children and Mental Health". **Es directamente adoptable como parte del gate de Simón**, aunque hay que adaptar personas/rubric al español rioplatense y a edades 6-18.
- **Benchmarks de seguridad en español:** más escasos. Existen datasets multilingües de toxicidad con español (unitary, xlm-roberta), y HarmBench como framework de red-teaming (mayormente inglés). No encontré un benchmark de crisis/self-harm en español rioplatense listo para usar — **es un gap que MaatWork probablemente tenga que construir** (eval propio con personas argentinas 6-18, rubric estilo VERA-MH traducido y localizado). Precedente para guards en idioma no-inglés: Bielik Guard (clasificadores de seguridad en polaco) y X-Guard (multilingual guard agent) muestran que entrenar un guard por idioma es una estrategia validada.

---

## Implicaciones para Simón-MaatWork

**Arquitectura de seguridad propuesta (defensa en profundidad, gate en vivo 100% local):**

1. **Capa 1 — Determinística local (la que sostiene el caso legal/ético).** Mantener la regex de crisis + plantillas fijas + derivación a línea de ayuda argentina, corriendo en el dispositivo, **sin LLM y sin red**. Es la única capa que no puede fallar por drift del modelo, jailbreak o fine-tuning degradation, y es la que responde al deber SB 243 de "protocolo para prevenir self-harm content". No debe depender jamás del modelo propio.

2. **Capa 2 — Generación local sin streaming.** Igual que hoy: generar completo, nunca mostrar token-by-token. Sin streaming es *precondición* de moderar antes de mostrar cuando la inferencia es local.

3. **Capa 3 — Classifier local post-generación (el reemplazo del gate server-side).** Antes de renderizar al menor, pasar el output por un guard local. Dos opciones:
   - **Opción A (lista para usar): Llama Guard 3-1B-INT4**, 440MB, ~2.5s TTFT en CPU Android, español oficial. Costo: +440MB + latencia; verificar F1 en español en el PDF antes de comprometerse.
   - **Opción B (más control, más liviana): DeBERTa/xlm-roberta multilingüe propio** (~300-435M), fine-tuneado en la RTX 3060 con datos de self-harm/violencia/sexual en español rioplatense. Más chico, más rápido, taxonomía a medida; costo: hay que construir el dataset y el pipeline de eval.
   - Recomendación: **empezar con A para validar la arquitectura, migrar a B** cuando el lab tenga datos y eval propios. En gama baja (2-3GB RAM) donde no entren dos modelos, B es probablemente obligatorio.

4. **Capa 4 — Moderación/juez server-side ASÍNCRONA (recategorizada).** La cascada actual (OpenAI Moderation → juez LLM) deja de ser gate en vivo y pasa a: telemetría de falsos negativos, segunda opinión que puede alertar a tutor/humano, y fuente de datos para re-entrenar la Capa 3. Corre cuando hay red; su ausencia (offline) no debe bloquear la protección, que ya está cubierta por capas 1-3.

**Riesgos de proceso (no solo de arquitectura):**

- **Fine-tuning degradation es el riesgo #1 del proyecto de modelo propio.** Obligatorio: safety data mixing en cada batch, prompt template discrepancy, y **eval de seguridad por checkpoint** (HarmBench-style + eval de crisis en español), con writer ≠ checker.
- **No confiar en safety baked-in del modelo chico como única capa.** A 100M-2B el refusal es frágil (single-direction, jailbreakeable). Sirve como default, no como garantía.
- **Compliance como requisito de diseño, no de abogados al final.** SB 243 (recordatorio cada 3h para menores, protocolo self-harm publicado, derivación a crisis) y AI Act Art. 5 (no explotar vulnerabilidad por edad) deben estar en el spec desde el día 1. Age-appropriateness 6-18 y el caso de discapacidad refuerzan el deber de cuidado.
- **Construir un eval de crisis en español rioplatense** estilo VERA-MH (personas 6-18 argentinas + rubric clínico localizado). No existe listo; es trabajo propio y es parte del gate objetivo, no opcional.

**Presupuesto/recursos:** todo lo anterior es factible con 1x RTX 3060 12GB y USD 10k. Fine-tunear un encoder DeBERTa 435M y correr evals cabe en la 3060. Llama Guard 3-1B-INT4 es descarga gratuita (Llama license). El costo real es *humano*: construir dataset de safety en español rioplatense y el eval de crisis. Ahí conviene poner el presupuesto (anotación clínica), no en GPU.

---

## Fuentes

- **Qi et al., "Fine-tuning Aligned Language Models Compromises Safety" (ICLR 2024)** y línea de trabajo derivada — establece que fine-tuning con datos benignos degrada safety. Confirmado por múltiples réplicas 2024-2026. Aporta: el riesgo central del modelo propio.
- **ICLR 2025, "Safety Alignment Should Be Made More Than Just a Few Tokens Deep"** — https://proceedings.iclr.cc/paper_files/paper/2025/file/88be023075a5a3ff3dc3b5d26623fa22-Paper-Conference.pdf — la fragilidad viene de alignment superficial; deep alignment + data mixing como mitigación.
- **NeurIPS 2024, "Keeping LLMs Aligned After Fine-tuning: The Crucial Role of Prompt Templates"** — https://proceedings.neurips.cc/paper_files/paper/2024/file/d6f034bb216b472fc7d32ec7aff20342-Paper-Conference.pdf — prompt template discrepancy mitiga degradación. Barato de implementar.
- **"Layer-Aware Representation Filtering" (arxiv 2507.18631, 2025)** — purificar el fine-tuning data para preservar safety. (Fecha 2025, no verificada línea por línea.)
- **Google ShieldGemma (MarkTechPost, 2-ago-2024)** — https://www.marktechpost.com/2024/08/02/google-ai-introduces-shieldgemma-... — familia 2B-27B, 6 categorías, SG-9B supera Llama Guard 1 en 10.8% AU-PRC. Verificado: el menor es 2B, no hay sub-2B.
- **Llama Guard 3-1B-INT4 (arxiv 2411.17713, nov 2024)** — https://arxiv.org/abs/2411.17713 — 440MB, ≥30 tok/s, ≤2.5s TTFT en CPU Android, ~7× reducción vía pruning+quantization. Abstract verificado directamente.
- **PurpleLlama / Llama Guard 3 model card (Meta, GitHub)** — https://github.com/meta-llama/PurpleLlama/blob/main/Llama-Guard3/1B/MODEL_CARD.md — 13 categorías MLCommons, 8 idiomas incl. español, Llama 3.2 license. Aporta: taxonomía y soporte español.
- **Prompt Guard / DeBERTa distillation** — mencionado en survey "Collaborating Small and Large LLMs" (arxiv 2510.13890) — Llama-Guard-3-8B distilado a DeBERTa-v3-large 435M para edge. Aporta: opción encoder liviana.
- **xlm-roberta multilingual toxicity** — https://huggingface.co/unitary/multilingual-toxic-xlm-roberta y https://huggingface.co/malexandersalazar/xlm-roberta-large-binary-cls-toxicity — soporte español, categorías de toxicidad. Aporta: base para classifier local propio en español.
- **Apple Intelligence Foundation Models tech report 2025** — https://machinelearning.apple.com/research/apple-foundation-models-2025-updates — on-device ~3B, guardrail models pre/post-inferencia locales, multilingual post-training alignment. Verificado vía WebFetch. Aporta: patrón arquitectural de referencia (moderación viaja con el modelo).
- **Apple guardrails bypassed (SecurityWeek, jun 2025)** — https://www.securityweek.com/apple-intelligence-ai-guardrails-bypassed-in-new-attack/ — refuerza defensa en profundidad, no una sola capa.
- **"Small but Dangerous: Evaluating and Mitigating Jailbreak Vulnerabilities in Small Language Models" (Springer, 2025)** — https://link.springer.com/chapter/10.1007/978-3-032-19099-4_35 — SLMs más vulnerables a jailbreak que modelos grandes. Paywall; tesis extraída del título/abstract, cifras no verificadas.
- **"Refusal in LLMs is mediated by a single direction"** y "Refusal-Escape Directions" (arxiv 2605.08878, 2025-2026) — el refusal es una feature frágil y localizada, sobre todo en modelos chicos.
- **California SB 243 (Skadden, oct 2025)** — https://www.skadden.com/insights/publications/2025/10/new-california-companion-chatbot-law — firmada 13-oct-2025, vigente 1-ene-2026; disclosure, recordatorio 3h para menores, protocolo self-harm publicado, private right of action USD 1.000/violación. Verificado vía WebFetch. Texto oficial: https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202520260SB243
- **EU AI Act Art. 5 / protección de menores (5Rights Foundation, feb 2025; Parlamento Europeo, oct 2025)** — https://5rightsfoundation.com/ai-systems-that-exploit-the-vulnerabilities-of-children-are-now-illegal-in-the-eu/ y https://www.europarl.europa.eu/news/en/press-room/20251013IPR30892/ — prohibición de explotar vulnerabilidad por edad; companionship chatbots señalados como riesgo.
- **VERA-MH (Spring Health, 20-oct-2025)** — https://www.springhealth.com/news/spring-health-expert-council-vera-mh-first-open-source-evaluation-ai-mental-health — eval open-source de suicide risk con user-agent + judge-agent; IRR clínica 0.77, judge 0.81. Concept paper: https://arxiv.org/abs/2510.15297 ; validación humana: https://arxiv.org/abs/2602.05088. Track infantil: https://www.springhealth.com/blog/advancing-safer-ai-standards-for-children-and-mental-health
- **WebLLM (arxiv 2412.15803, dic 2024)** — https://arxiv.org/abs/2412.15803 — inferencia in-browser vía WebGPU, 71-80% del throughput nativo. Aporta: viabilidad y límites de inferencia client-side (y por qué el gate debe ser local).
