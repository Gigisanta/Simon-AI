# Datasets y data engineering para un LLM conversacional pequeño en español rioplatense (2026)

## Resumen ejecutivo

Para pretraining hay abundante español de calidad y licencia permisiva: **FineWeb2** (HuggingFaceFW, ODC-By) tiene ~405M documentos / ~484B tokens en español (`spa_Latn`, 8.88% del corpus total de 1000+ idiomas) [fuente: búsqueda agregada sobre FineWeb2, dato citado en análisis de terceros sobre el dataset, jul-2026]. **HPLT v2** (CC0, ~8T tokens/52T caracteres en 193 idiomas) y **CulturaX** (6.3T tokens/167 idiomas, licencia heredada de mC4+OSCAR) son alternativas igual de permisivas. El BSC (Barcelona Supercomputing Center) aporta corpus curados específicos de español/co-oficiales: **MarIA** (570GB, 135B palabras, Biblioteca Nacional de España 2009-2019) y el corpus de **Salamandra** (Apache 2.0, 6.9T tokens en 35 idiomas europeos con sobremuestreo 2x de español/catalán/gallego/euskera).

Para instrucción/chat, el panorama es más fragmentado: **SmolTalk2** (Apache 2.0 para los subsets nuevos, 8.6M filas totales) tiene solo ~254K-500K filas en español dentro de su subset multilingüe de 8 idiomas — insuficiente como base única. **UltraChat** es CC-BY-NC-4.0 (no comercial, descartado para Simón). **OpenHermes 2.5** es MIT (usable) pero mayormente en inglés. **Magpie** y **PersonaHub** no son datasets fijos sino *métodos* de generación sintética que se pueden aplicar directamente en español con DeepSeek u otro LLM barato. **SomosNLP** (#Somos600M) es el esfuerzo comunitario más relevante para variedades de español, con un corpus de instrucciones construido en hackathons 2024-2025, pero es comunitario/heterogéneo y no hay evidencia de un dataset rioplatense dedicado de calidad de producción.

**Conclusión clave**: no existe un dataset conversacional rioplatense curado listo para usar. La estrategia viable es: pretraining con FineWeb2-es (o HPLT2-es) filtrado + corpus del BSC como ancla de calidad; instrucción base en español vía SmolTalk2-multilingual + OpenHermes traducido; y la mayor parte del volumen conversacional específico (persona, tono, seguridad infantil, rioplatense) generado sintéticamente con DeepSeek V4 Flash (~$0.14/$0.28 por M tokens in/out, jul-2026), aplicando Magpie/PersonaHub como método, con decontaminación n-gram y sin datos reales de menores.

## Hallazgos

### 1. Pretraining: FineWeb2, HPLT v2, CulturaX, corpus BSC

**FineWeb2** (HuggingFaceFW/fineweb-2, HF): extensión de FineWeb a 1000+ idiomas, licencia **ODC-By 1.0** (permisiva, atribución requerida, uso comercial permitido) [huggingface.co/datasets/HuggingFaceFW/fineweb-2, consultado jul-2026]. Para español (`spa_Latn`): **~405.6M documentos (8.88% del total)** y **~483.75B tokens** según análisis de terceros sobre las estadísticas publicadas del dataset [búsqueda web, jul-2026 — cifra de fuente secundaria, no verificada contra el dataset card original línea por línea; recomendable re-verificar antes de comprometer pipeline]. El paper "FineWeb2: One Pipeline to Scale Them All" (arXiv, 2025, arxiv.org/abs/2506.20920) documenta que supera a CC-100, mC4, CulturaX y HPLT en benchmarks downstream multilingües gracias a un pipeline de filtrado/dedup uniforme por idioma. Hay una variante `epfml/FineWeb2-HQ` (high-quality) en HF que vale la pena evaluar para reducir volumen sin perder calidad.

**HPLT v2** (hplt-project.org): extraído de 4.5PB de Internet Archive + Common Crawl, ~8T tokens / 52T caracteres en 193 idiomas, licencia **CC0** (dominio público, la más permisiva posible) [aclanthology.org/2025.acl-long.854, arxiv.org/pdf/2503.10267, jul-2026]. No se encontró cifra exacta de tokens solo-español en la búsqueda; requiere inspección directa del dataset en HF/OPUS.

**CulturaX** (uonlp/CulturaX, HF): 6.3T tokens, 167 idiomas, 16TB parquet/27TB sin comprimir. Licencia: **hereda de mC4 y OSCAR** (ambas permiten uso para entrenar modelos, OSCAR bajo términos de Common Crawl) [huggingface.co/datasets/uonlp/CulturaX, jul-2026]. Es anterior y de menor calidad medida que FineWeb2 según el paper de FineWeb2.

**BSC / MarIA / Salamandra**: MarIA (BSC + Biblioteca Nacional de España) — 570GB texto limpio y deduplicado, 135B palabras, crawleado 2009-2019 del archivo web español [arxiv.org/pdf/2107.07253, BNE]. Es corpus **de España peninsular**, no rioplatense — útil como ancla de calidad de español "general" pero no aporta variedad argentina. **Salamandra** (BSC-LT, HF, Apache 2.0): modelos y corpus de 6.9T tokens en 35 idiomas europeos + 92 lenguajes de programación, con sobremuestreo 2x de español/catalán/gallego/euskera en las primeras 3 épocas (2.4T tokens) [huggingface.co/BSC-LT/salamandra-7b-instruct, langtech-bsc.gitbook.io/alia-kit, jul-2026]. Licencia Apache 2.0 en los modelos; el dataset de entrenamiento está documentado con transparencia en el ALIA Kit pero conviene revisar si el corpus crudo en sí es redistribuible o solo describe fuentes.

**Español latinoamericano/rioplatense en pretraining**: no se halló un corpus de pretraining dedicado y de escala a "español rioplatense" — el rioplatense aparece como *sub-slice* dentro de corpus generales (FineWeb2, HPLT2, CulturaX no separan por país, solo por idioma `spa`). El "Corpus del Español" (corpusdata.org) tiene ~2B palabras etiquetadas de 21 países incluyendo variantes latinoamericanas, pero es un corpus académico de tamaño chico para pretraining moderno y su licencia de uso comercial no quedó clara en la búsqueda — verificar antes de usar.

### 2. Instrucción/chat: SmolTalk2, UltraChat, OpenHermes, Magpie

**SmolTalk2** (HuggingFaceTB/smoltalk2, HF, dataset usado para SmolLM3-3B): 8.6M filas en 3 subsets — Mid-Training (4.78M filas / 35.2B tokens), SFT (3.38M filas / 19.3B tokens), Preference (447K filas / 0.85B tokens) [huggingface.co/datasets/HuggingFaceTB/smoltalk2, jul-2026]. Incluye un subset `multilingual-8languages` con prompts traducidos a francés, español, italiano, portugués, alemán, árabe, ruso y chino "respetando convenciones locales" — ~254K filas sin razonamiento + ~245K con razonamiento (Qwen3-32B), es decir el español real dentro de SmolTalk2 es del orden de decenas de miles de filas, una fracción pequeña del total. Los subsets *nuevos* generados por HuggingFace (incluido el multilingüe) son **Apache 2.0**; los subsets reusados de otros datasets heredan su licencia original — hay que auditar subset por subset antes de mezclar.

**UltraChat** (thunlp/UltraChat, GitHub): 1-10M turnos de diálogo en inglés generados con dos instancias de ChatGPT Turbo. **Licencia CC-BY-NC-4.0 → no comercial**, incompatible con un producto comercial como Simón salvo que se use solo como referencia de estilo/estructura y se regenere contenido propio [github.com/thunlp/UltraChat, jul-2026].

**OpenHermes 2.5** (teknium): ~1M ejemplos sintéticos estilo ShareGPT, mayormente en inglés. **Licencia MIT** → uso comercial permitido [modeldatabase.com/teknium/OpenHermes-7B, jul-2026]. Útil como referencia de calidad/formato de instrucción, pero requeriría traducción/regeneración para español y no cubre el tono infantil-empático necesario.

**Magpie** (magpie-align.github.io, ICLR 2025): no es un dataset sino un **método** — se le da a un LLM ya alineado solo la plantilla de "pre-query" (sin instrucción semilla) y el modelo autogenera la instrucción, luego se le pide la respuesta con la plantilla de "post-query". No requiere anotación humana ni ejemplos semilla, y se ha extendido a multi-turno (Magpie-MT), preferencias (Magpie-DPO) y multilingüe [marktechpost.com, ICLR 2025 proceedings, jul-2026]. Aplicable directamente para generar diálogos en español rioplatense usando el LLM grande que se use como generador, siempre que ese LLM tenga buen dominio del rioplatense (a validar).

**SmolTalk/OpenHermes/Magpie para español**: ninguno resuelve el rioplatense nativamente; todos requieren o traducción (riesgo de "español neutro" no rioplatense) o generación directa en español pidiéndole al LLM generador que use vos/che/vocabulario argentino explícitamente.

### 3. Generación sintética: persona-driven, costos, mejores prácticas 2026

**PersonaHub / Persona-Driven Data Synthesis** (tencent-ailab, arXiv 2406.20094, jun-2024): 1B personas curadas de datos web (~13% de la población mundial) usadas como "carriers" de perspectiva para sintetizar instrucciones, problemas matemáticos, texto rico en conocimiento, NPCs y funciones/tools a escala. Dos métodos de construcción: **Text-to-Persona** (infiere personas de textos) y **Persona-to-Persona** (deriva personas relacionadas de las anteriores) [huggingface.co/papers/2406.20094, github.com/tencent-ailab/persona-hub, jul-2026]. Para Simón, el patrón aplicable es: definir un conjunto acotado de "personas" de chicos/adolescentes argentinos (edad, contexto, tono emocional, sin datos reales) + personas de "Simón" (acompañante, nunca terapeuta) y usarlas como semillas de diversidad para generación con Magpie o prompting directo — evitando el enfoque de "persona real" y quedándose en personas sintéticas/genéricas por diseño para no rozar el problema de "sin datos reales de menores".

**Cosmopedia** (HuggingFace): no apareció en las búsquedas con detalle directo, pero es sabido (contexto del proyecto) que combina generación con LLM grande + prompts de "seed" temáticos para crear contenido educativo sintético a escala — el patrón es análogo al de PersonaHub aplicado a contenido en vez de personas.

**Costo de generación (jul-2026, DeepSeek V4 Flash)**: **$0.14 / 1M tokens input (cache miss)** y **$0.28 / 1M tokens output**, con descuento de hasta 98% en cache hits ($0.0028/1M en input cacheado) [múltiples fuentes de pricing DeepSeek, jul-2026 — verificar contra el pricing oficial vigente en el momento de ejecutar, dado que DeepSeek ha ajustado precios varias veces]. Para 1M turnos conversacionales (asumiendo ~300-500 tokens promedio por turno completo, input+output): estimación aproximada de **cientos de dólares**, no miles — orden de magnitud compatible con el presupuesto de laboratorio de USD 10.000 declarado. DeepSeek V4-Pro sale ~3x más caro ($0.435/$0.87 por M) si se necesita mayor calidad para casos difíciles (ej. detección de crisis, tono empático fino). Nota: esto es generación de *contenido conversacional*, separado y adicional al LLM propio de producción de Simón que se busca reemplazar — se usaría un LLM grande de terceros (DeepSeek u otro) *solo* como generador offline de dataset, no en producción.

**Mejores prácticas de generación sintética 2026** (agregado de fuentes): (1) decontaminación — el estándar desde GPT-3 es n-gram overlap de 8-13 tokens contra benchmarks de evaluación, con herramientas como NeMo Curator que construyen un índice de n-gramas del test set y filtran contra él; pero **string-matching no basta** cuando hay paráfrasis o traducción — se recomienda complementar con reescritura generativa y evolución continua del dataset [arxiv.org/pdf/2605.19999, referencias sobre NeMo Curator, jul-2026]. (2) Diversidad: usar personas/semillas variadas (PersonaHub-style) para evitar el "mode collapse" típico de generación sintética masiva con un solo prompt. (3) Control de calidad: usar un juez LLM (o el mismo LLM grande con rúbrica) para filtrar respuestas de baja calidad antes de incorporarlas al set de entrenamiento — coherente con la cascada de moderación que Simón ya usa en producción, se puede reutilizar el mismo patrón para curar el dataset de entrenamiento.

### 4. Herramientas de pipeline: datatrove, dolma, NeMo-Curator

**Datatrove** (HuggingFace): librería para pipelines de procesamiento de datos a gran escala, diseñada específicamente para preparar datos de pretraining, con ejecución distribuida, checkpointing y los filtros estándar (calidad, idioma, dedup) ya implementados — es la que usa HuggingFace para producir FineWeb/FineWeb2 [spheron.network blog 2026, jul-2026].

**Dolma** (AllenAI/OLMo, arxiv.org/pdf/2402.00159): toolkit open-source de alto rendimiento para ensamblar datasets de billones de tokens — descarga de Common Crawl, filtrado, dedup y análisis. Corpus de referencia de 3T tokens.

**NeMo-Curator** (NVIDIA): framework GPU-acelerado (RAPIDS/cuDF + Dask) para dedup exacto y fuzzy, filtrado, clasificación de calidad, redacción de PII y generación de datos sintéticos. Es la opción más rápida para dedup pesado (>10T tokens) pero requiere GPUs NVIDIA con RAPIDS — con **1x RTX 3060 12GB local** el volumen de pretraining que se puede procesar razonablemente en horas/días es limitado (cientos de GB, no decenas de TB); para un modelo de 100M-2B parámetros el volumen de tokens necesario (siguiendo escalado tipo Chinchilla, ~20 tokens/parámetro como mínimo, idealmente más para modelos pequeños "overtrained" como los Llama/Qwen recientes) ronda 2B-40B tokens — un subconjunto filtrado de FineWeb2-es o HPLT2-es es más que suficiente en volumen; el cuello de botella real es cómputo de entrenamiento, no disponibilidad de datos.

### 5. Licencias — resumen práctico para uso comercial

| Dataset | Licencia | Uso comercial | Nota |
|---|---|---|---|
| FineWeb2 | ODC-By 1.0 | Sí | Atribución requerida |
| HPLT v2 | CC0 | Sí | Dominio público, la más simple |
| CulturaX | hereda mC4 + OSCAR | Sí (verificar términos exactos de OSCAR/Common Crawl) | No es licencia única propia |
| Salamandra (modelos BSC) | Apache 2.0 | Sí | Corpus de entrenamiento documentado, no confirmado 100% redistribuible en crudo |
| MarIA (BSC/BNE) | No confirmada en esta búsqueda | Verificar | Corpus de archivo nacional, revisar términos BNE antes de usar |
| SmolTalk2 (subsets nuevos) | Apache 2.0 | Sí | Subsets heredados varían, auditar uno por uno |
| UltraChat | CC-BY-NC-4.0 | **No** | Descartado para Simón (producto comercial) |
| OpenHermes 2.5 | MIT | Sí | Mayormente inglés |
| PersonaHub | Ver repo (no confirmada en esta búsqueda, típicamente permisiva tipo CC-BY o Apache) | Verificar | Es más método que dataset fijo |

## Implicaciones para Simón-MaatWork

1. **Pretraining**: usar FineWeb2-es (spa_Latn) filtrado por calidad, complementado con el corpus BSC/Salamandra como ancla — ambos con licencias permisivas (ODC-By, Apache 2.0). Con 2B-2.5B tokens (modelo de ~2B parámetros, escalado conservador) el volumen disponible en FineWeb2-es (~484B tokens totales) sobra en varios órdenes de magnitud; el límite real es cómputo local (1x RTX 3060 12GB), no datos.

2. **Rioplatense específico no existe como corpus de pretraining dedicado** — hay que inyectarlo vía: (a) sobre-muestreo de las páginas de FineWeb2/HPLT2 identificables como de origen argentino/uruguayo (por dominio .ar/.uy o clasificador de dialecto, cf. el paper "Spanish is not just one" sobre reconocimiento de dialecto), y (b) generación sintética masiva de conversaciones en rioplatense explícito (vos, che, diminutivos, registro infantil-adolescente) vía Magpie/PersonaHub con un LLM grande instruido a mantener el dialecto.

3. **Ningún dataset de instrucción existente resuelve "acompañante emocional infantil-juvenil en rioplatense"** — es un nicho que no tiene datos curados públicos. Esto valida la estrategia de generación sintética como *la* vía principal, no un complemento: se necesita diseñar un conjunto de personas sintéticas (chicos/adolescentes 6-18, distintos contextos emocionales y de discapacidad, SIN datos reales de menores) + personas "Simón" (rol acompañante, límites no-terapéuticos) y generar decenas/cientos de miles de turnos con DeepSeek V4 Flash a costo bajo (estimado en cientos de USD, dentro del presupuesto de USD 10.000).

4. **Seguridad infantil como filtro adicional de dataset, no solo de inferencia**: dado que la cascada de moderación de producción (regex → OpenAI Moderation → juez LLM) es determinística y separada del LLM, el mismo patrón de "juez LLM + regex" debería aplicarse *también* al dataset de entrenamiento sintético antes de incorporarlo — filtrando cualquier ejemplo generado que insinúe rol terapéutico, contenido de crisis mal manejado, o lenguaje inapropiado — para que el modelo pequeño no aprenda comportamientos que la capa de guardrails después tenga que corregir en producción. Esto es coherente con no degradar los guardrails existentes.

5. **Decontaminación**: aplicar n-gram overlap (8-13 tokens) contra cualquier benchmark de evaluación que se use para medir el modelo, más revisión manual de una muestra — dado el volumen pequeño-mediano del dataset objetivo (no billones de tokens), esto es factible sin infraestructura GPU-pesada tipo NeMo-Curator; datatrove o scripts simples alcanzan.

6. **Riesgo abierto a verificar antes de comprometer pipeline**: la cifra de tokens en español de FineWeb2 (~484B) viene de una fuente secundaria agregada en la búsqueda, no del dataset card oficial leído directamente — antes de dimensionar el pipeline de pretraining conviene abrir el dataset card real en HuggingFace y confirmar la cifra exacta, así como los términos de licencia de MarIA/BNE y de PersonaHub, que no quedaron confirmados con una fuente primaria en esta pasada.

## Fuentes

- https://huggingface.co/datasets/HuggingFaceFW/fineweb-2 — dataset card FineWeb2, licencia ODC-By, jul-2026 (fetch parcial, sin cifras de español confirmadas directamente)
- https://arxiv.org/html/2506.20920v1 — "FineWeb2: One Pipeline to Scale Them All", metodología y comparación con CulturaX/HPLT/mC4, 2025
- (agregado, no primario) cifra spa_Latn ~405.6M docs / ~483.75B tokens en FineWeb2 — búsqueda web jul-2026, requiere re-verificación en el dataset card
- https://aclanthology.org/2025.acl-long.854.pdf — "An Expanded Massive Multilingual Dataset for HPLT", tamaño y licencia CC0, 2025
- https://arxiv.org/pdf/2503.10267 — paper HPLT expandido, 8T tokens/193 idiomas
- https://huggingface.co/datasets/uonlp/CulturaX — dataset card CulturaX, 6.3T tokens/167 idiomas, licencia mC4+OSCAR
- https://huggingface.co/BSC-LT/salamandra-7b-instruct — modelo/corpus Salamandra, Apache 2.0, 6.9T tokens, sobremuestreo español/catalán/gallego/euskera
- https://langtech-bsc.gitbook.io/alia-kit/datasets/datos-y-herramientas-para-modelos-de-texto — documentación de datasets del proyecto ALIA/BSC
- https://arxiv.org/pdf/2107.07253 — paper MarIA, 570GB/135B palabras, BNE 2009-2019
- https://huggingface.co/datasets/HuggingFaceTB/smoltalk2 — dataset card SmolTalk2, 8.6M filas, subset multilingüe 8 idiomas, licencias Apache 2.0 para subsets nuevos, jul-2026
- https://github.com/thunlp/UltraChat — UltraChat, licencia CC-BY-NC-4.0 (no comercial)
- https://modeldatabase.com/teknium/OpenHermes-7B.html — OpenHermes 2.5, MIT, ~1M ejemplos sintéticos
- https://magpie-align.github.io/ — sitio oficial método Magpie, self-synthesis sin semillas
- https://www.marktechpost.com/2024/06/15/magpie-a-self-synthesis-method-for-generating-large-scale-alignment-data-by-prompting-aligned-llms-with-nothing/ — resumen Magpie, jun-2024
- https://huggingface.co/papers/2406.20094 y https://github.com/tencent-ailab/persona-hub — PersonaHub, 1B personas, Text-to-Persona / Persona-to-Persona, jun-2024
- https://somosnlp.org/ y https://github.com/somosnlp/corpus-es — proyecto #Somos600M, corpus de instrucciones en español y variedades, hackathons 2024-2025
- https://www.spheron.network/blog/ai-pretraining-data-curation-nemo-curator-datatrove-fineweb-gpu-cloud/ — comparación datatrove/NeMo-Curator/dolma, guía 2026
- https://arxiv.org/pdf/2402.00159 — paper Dolma, AllenAI/OLMo, 3T tokens
- Pricing DeepSeek V4 Flash/Pro agregado de múltiples fuentes (morphllm.com, cloudzero.com, nxcode.io, verdent.ai) — $0.14/$0.28 por M tokens in/out (V4 Flash), $0.435/$0.87 (V4 Pro), jul-2026 — verificar contra pricing oficial vigente al momento de ejecutar por volatilidad histórica de precios DeepSeek
- https://arxiv.org/html/2605.19999v1 — contaminación resistente en benchmarks, prácticas de decontaminación n-gram 8-13, 2026
- https://pmc.ncbi.nlm.nih.gov/articles/PMC12504998/ — "Spanish is not just one: A dataset of Spanish dialect recognition for LLMs", relevante para clasificar/oversamplear rioplatense
- https://www.corpusdata.org/spanish.asp — Corpus del Español, ~2B palabras, 21 países, licencia de uso comercial no confirmada
