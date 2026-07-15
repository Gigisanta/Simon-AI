# Simón — Research Briefing para demo gubernamental (2026-07)

> Generado por deep research (25+ búsquedas, fuentes citadas) el 2026-07-15.
> Insumo para: ADR de rearquitectura, propuesta de financiamiento/pricing y plan del lab de modelo propio.
> Nota de stack: los agentes de research reportaron "AI SDK 6 como último" según su snapshot web; el ground truth local es `ai@7.0.18` pineado en `simon/package.json` (verificado) — la observación queda descartada.

## 1. Estándares de safety 2025–2026

- **Endurecimiento regulatorio global**: el campo pasó de "herramienta prometedora" a "probá que es seguro o no deployees", empujado por litigios de suicidio adolescente (Character.AI/Google settlement 01-2026; caso Raine vs OpenAI) y hallazgos de red-teaming.
- **VERA-MH** (Spring Health, open source, github.com/SpringCare/VERA-MH) es el estándar de facto emergente para evaluar manejo de riesgo suicida: user-agent LLM role-playing personas por nivel de riesgo + judge-agent con rúbrica clínica. Estudio 2026: 53,3% de chatbots generales fallan en confirmar ideación suicida; 15,2% no dan recurso de crisis 24/7. **No existe equivalente en español — gap y oportunidad para Simón.**
- **Dos modos de falla**: perder señal de riesgo, pero también el "dump-and-terminate" (hotline genérica + cortar la conversación) — los principios de intervención en crisis exigen engagement sostenido para desescalar.
- **APA Health Advisory (11-2025)**: protecciones especiales para menores; nunca presentar el bot como terapeuta/humano; detección de crisis con ruteo a humanos; prevenir dependencia parasocial.
- **UK AADC (Children's Code)** como checklist de diseño: 15 estándares — privacidad máxima por default, minimización de datos, DPIA infantil obligatoria, sin dark patterns/nudging, geolocalización off por default. Enforcement real (Reddit £14,47M, 02-2026).
- **Leyes estaduales EEUU (dirección del viento)**: Illinois WOPR Act (prohíbe terapia por IA sin licenciado), Nevada AB406 (prohíbe IA como consejero escolar), Utah HB452 (disclosure), California SB-243 (protocolo de autolesión publicado + acción privada $1.000/violación).
- **FDA**: >1.200 dispositivos IA autorizados, **cero** de salud mental generativa. No hay pathway regulatorio para dispositivos LLM de terapia.

**Para Simón**: capa de crisis determinística (no-LLM) con escalación humana; adoptar VERA-MH adaptado al español como gate interno y publicar resultados; diseñar según AADC; disclosure "Soy una IA" permanente; posicionamiento *acompañamiento/bienestar*, nunca terapia/tratamiento.

## 2. Regulatorio Argentina

- **Ley 26.657 (Salud Mental)**: rights-based, presunción de capacidad, equipos interdisciplinarios. Simón como *apoyo* al sistema encaja; un bot que "diagnostica/trata" autónomamente chocaría con la ley.
- **Ley 25.326 (Datos Personales)**: datos de salud mental de menores = **datos sensibles** → consentimiento expreso e informado, minimización, seguridad reforzada, secreto profesional. Reforma pendiente (1948-D-2025, estilo GDPR: privacy-by-design, derecho a objetar decisiones automatizadas) — construir hoy contra ese estándar.
- **Consentimiento por tramos (CCyCN art. 26 + Ley 26.061, autonomía progresiva)**: <13 deciden tutores (niño escuchado); 13–16 consiente el menor para lo no invasivo; 16+ adulto para decisiones de salud. AAIP Res. 4/2019 orienta consentimiento de datos de menores. **El portal del tutor no es una feature: es una necesidad legal.** Visibilidad del tutor = *alertas, no transcripciones* (confidencialidad del adolescente 13+).
- **ANMAT SaMD** (Disp. 2318/2002 + Disp. 64/2025/MERCOSUR GMC 25/21): el gatillo es el **claim médico**. "Diagnóstico/tratamiento/prevención de enfermedad" → producto médico clase II+. "Bienestar/acompañamiento emocional" → fuera de alcance. Conseguir opinión legal escrita antes del launch.
- **IA**: sin ley nacional; soft law = Disp. 2/2023 "IA Fiable" (JGM) + AAIP Res. 161/2023 guía IA responsable + guía CIPPEC 2025 para sector público. **Mapear Simón explícitamente a estos marcos = narrativa de compliance pre-alineada con el propio Estado.**
- **Referencia regional**: Brasil PL 2338/2023 y Chile (aprobado en Cámara) copian el EU AI Act; el EU AI Act clasifica chatbot de salud mental con soporte de crisis como **alto riesgo** (los disclaimers no cambian la clasificación). Construir a estándar alto-riesgo (logging, oversight humano, docs de robustez) future-proofs la expansión nacional.
- **Neuquén**: proyectos provinciales 2025 de prevención de suicidio juvenil y materia "Psicoeducación Digital" — alinear el pitch a esos programas.

## 3. Productos comparables — lecciones

| Producto | Lección |
|---|---|
| **Woebot** (†06-2025) | El más validado de la historia (14 RCTs, FDA Breakthrough, $124M quemados) murió persiguiendo un pathway FDA que no existe para LLMs. **B2C consumer + maximalismo regulatorio = muerte. B2G con comprador estatal = el modelo sobreviviente (el de Simón).** |
| **Kintsugi** (†2025) | Validación en Annals of Family Medicine y aun así murió por economía FDA. Mismo patrón. |
| **Wysa** (NHS) | **El template arquitectónico**: híbrido scripted+LLM, guardrails que filtran cada output, prompts de clínicos, zero-retention con el proveedor LLM, escalación a humanos. Contratos NHS £30k–£117k por servicio; ~£5,90/usuario elegible/año. |
| **Limbic** | **El template go-to-market**: claim angosto (triage), certificación Class IIa UKCA, venta a nivel sistema (45% de NHS Talking Therapies). Milestone aspiracional post-evidencia. |
| **Troodi** (Troomi) | **El template niño+tutor**: alertas críticas a padres ante ideación de autolesión, contenido por edad, PII separada de logs de conversación. |
| **Character.AI** | El modo de falla: respuestas puro-LLM a contenido de riesgo → settlement por suicidios adolescentes, prohibición de menores. |

**Evidencia honesta**: Therabot RCT (NEJM AI 2025, −51% depresión) es solo adultos y con oversight clínico pesado. Meta-análisis juvenil (JMIR 2025, 31 RCTs): efectos chicos y frágiles para IA generativa; los sistemas rule/retrieval-based tienen la evidencia confiable. **Proponer que Simón genere la evidencia argentina (piloto Neuquén con evaluación UNCo/ministerio) convierte la debilidad en activo.**

## 4. Arquitectura LLM 2026 — estado del arte

- **Router-first**: clasificador barato (enum mode / structured output) taggea riesgo+intención en cada mensaje → 60–80% del tráfico a modelo barato, escalar turnos difíciles/emocionales al modelo fuerte. 40–60% de ahorro **y** ganancia de safety (clasificador de crisis independiente del modelo conversacional). Pre-filtro regex de crisis en español bypassea el LLM por completo.
- **Cascada de guardrails** (cheapest-first): regex/keywords (0 latencia) → clasificador chico → dialog rails estilo constitución de salud mental → validador de output + PII. Ningún guardrail solo alcanza; los clasificadores tienen sesgo inglés — **evaluar en español**. Cuidado con sicofancia post-RLHF: un acompañante para chicos debe poder disentir con suavidad.
- **Prompt caching**: cachear el prefijo estable (persona + constitución de safety + few-shots), turno volátil al final; reads ~0,1× en Anthropic / ~50–90% off automático en OpenAI. **Verificar que el gateway OpenAI-compatible forwardee la semántica de caching** (muchos agregadores no lo hacen — testear empíricamente).
- **Contexto**: memoria jerárquica — ventana deslizante + resumen rodante (compaction) + tabla de hechos de perfil en Neon. No mandar historia completa por turno.
- **RAG sobre pgvector** (corpus acotado y curado: protocolos de crisis, psicoeducación, recursos locales Neuquén) > long-context: auditable, actualizable sin retraining, access-controlled junto a los datos del usuario.
- **Observabilidad**: Langfuse self-hosted (requisito gov) con masking client-side de PII antes de que nada llegue a traces; redacción tipo Presidio antes de embeddings y de cada llamada LLM.

## 5. Escalabilidad Vercel + Neon (10k–100k MAU)

- Infra **no** es el driver de costo (los tokens LLM sí): 100k MAU ≈ cientos de USD/mes (Neon 1–4 CU autoscaling $80–305/mes + Fluid Compute Active CPU que casi no cobra mientras esperás al LLM).
- Checklist: **`-pooler` en todo connection string serverless** (el error #1 a escala; directo solo para migraciones), pool a nivel módulo con Fluid, índice `messages(user_id, created_at)`, read replica para historial/RAG cuando reporting contienda (~50k MAU), `maintenance_work_mem ≥2GB` para builds HNSW.
- **Queues para escalaciones** (alertas a tutores/clínicos): durables y con retry — nunca perder una escalación si una function crashea. Vercel Queues está en beta; considerar Inngest/QStash hasta GA.
- Flag para el gov: plan Launch de Neon no tiene primary multi-AZ — presupuestar Scale o documentar DR/PITR para un SLA de servicio público.

## 6. Lab de modelo propio (~USD 10.000) — evaluación honesta

**$10k NO compra un modelo conversacional clínico propio. Compra un lab QLoRA aplicado + eval suite en español — y eso es genuinamente valioso.** Pitchearlo como "laboratorio de evaluación y modelos de seguridad en español" (honesto e impresionante), no "vamos a entrenar nuestro LLM".

- Roadmap por etapas: **(0)** $0, meses 0–3: prompt+RAG+guardrails sobre el gateway + harness de eval en español (adaptación VERA-MH) ANTES de entrenar nada. **(1)** ~$1.500, meses 2–4: QLoRA en la nube (4090 $0,34–0,69/hr) sobre Qwen 2.5 7B / Llama 3.1 8B / Gemma 2 9B con datos español MI/CBT curados+sintéticos revisados por clínicos. **(2)** ~$3–5k, meses 4–8: workstation local (3090/4090 24GB usada) si la utilización lo justifica — bonus soberanía de datos. **(Reserva)** $2–3k: horas de anotación clínica y red-teaming.
- **El recurso escaso son datos en español revisados por clínicos, no GPUs** (MIDAS es casi el único dataset público de counseling en español). Presupuestar partnership con psicólogos locales.
- **Fine-tuning degrada safety incluso con datos benignos** → pipeline de regresión de safety obligatorio en cada checkpoint; evals en inglés dan falsa confianza (los ataques se comportan distinto en español).
- Los clasificadores chicos entrenados (detector de crisis español, router, filtro) **reducen el gasto mensual de LLM** — el lab se paga parcialmente solo.
- Contexto AR: aranceles de componentes PC al 0% (2025), energía barata — importar rig es viable; "modelo argentino, datos argentinos, cómputo argentino" es narrativa de IA soberana para el gobierno.

## 7. Benchmarks de pricing — USD 3.000/mes + USD 10.000 one-time

- **USD 36k/año está en el piso o debajo de todos los comparables**: chatbots cívicos gov EEUU $25k–400k/año (awards reales: $76.820 / $223.650 / $759.247); Wysa NHS £30k–£117k por servicio; K-12 mental health $3,50–12/estudiante/año.
- **El número más fuerte para la mesa de negociación es per cápita**: Neuquén ~750k hab → ~$0,05/cápita/año; incluso con 10k usuarios activos ≈ $3,60/usuario/año, fondo del rango de benchmark (Wysa NHS ~£5,90/usuario elegible/año).
- Techo real: gasto público en salud mental en Sudamérica ≈ USD 2,30/cápita/año → tiers poblacionales en centavos-a-pocos-dólares/usuario; la cuota flat (no per cápita) es lo que hace funcionar $3k/mes a escala chica.
- **Estructura**: fee SaaS flat $3k/mes (plataforma+soporte, "pricing provincial introductorio" con benchmarks citados para poder pricear $8k–25k/mes por provincia en la expansión nacional) + lab $10k itemizado aparte como **capex de IA soberana / capacity building**. Multi-año con descuento. ROI story: $0,50–2 por interacción IA vs $8–15 humano; <2 psiquiatras/100k hab; suicidios en Neuquén (77 en 2022, 86 en 2023).
- Anexo de procurement: guardar PDFs de tenders NHS y guía de RFPs cívicos — las oficinas de compras responden a comparables, no narrativas. Disclose: benchmarks gov LatAm son opacos, proxies US/UK.

## Flags transversales

1. Sin RCTs adolescentes de chatbots generativos — no claimear eficacia clínica; claimear acompañamiento seguro + plan de generación de evidencia.
2. Sin pathway regulatorio para dispositivos LLM de salud mental en ningún país — quedarse en bienestar/acompañamiento.
3. Conflictos de pricing entre fuentes (Gemini Flash, Neon/Vercel) — re-verificar antes de cotizar en contrato.
4. **El gap español (evals, guardrails, datasets) es a la vez el mayor riesgo técnico de Simón y su moat si el lab lo cierra.**
