# Simón — Propuesta de financiamiento y pricing (borrador 2026-07)

> Documento de trabajo para la negociación con el Gobierno de la Provincia del Neuquén.
> Benchmarks y fuentes: ver `docs/research-briefing-gov-2026-07.md` (anexo con comparables citados).
> Alcance, arquitectura, gates y gaps técnicos: ver [`propuesta-tecnica-2026-07.md`](propuesta-tecnica-2026-07.md), fuente canónica de la oferta técnica.
> Estado: BORRADOR — cifras de infraestructura a re-verificar al momento de cotizar en contrato.

## 1. Resumen ejecutivo

Simón es un acompañante emocional con IA para chicos y adolescentes (6–18) con arquitectura tutor-first, en producción en `https://simon.maat.work`, construido Argentina-first en español rioplatense. La propuesta:

| Concepto | Monto | Naturaleza |
|---|---|---|
| Plataforma Simón (SaaS provincial) | **USD 3.000/mes** | Fee mensual: operación, soporte, seguridad, evolución continua |
| Laboratorio de IA en español | **USD 10.000** (única vez) | Capex de capacidad soberana: eval de seguridad en español + modelos de clasificación propios |

## 2. El problema (por qué ahora, por qué acá)

- Suicidio es una de las principales causas de muerte en adolescentes de 15–19 (OMS). Neuquén registró 77 suicidios en 2022 y 86 en 2023.
- Brecha de cuidado estructural: <2 psiquiatras cada 100k habitantes en la región vs ~12 en países de altos ingresos; solo 20–30% de quienes tienen trastornos comunes recibe atención.
- Los adolescentes ya usan chatbots generales para esto: 1 de cada 8 jóvenes consulta salud mental con IA no diseñada ni protegida para menores (RAND, 11-2025). La alternativa a Simón no es "nada": es Character.AI sin protecciones — con settlements por suicidios adolescentes en EEUU (01-2026).
- La provincia ya identificó la intersección: proyectos legislativos 2025 de prevención de suicidio juvenil y de "Psicoeducación Digital" en el nivel medio. Simón es el instrumento operativo de esa agenda.

## 3. Qué es (y qué no es) Simón — posicionamiento regulatorio

**Es**: acompañamiento y bienestar emocional, psicoeducación, detección temprana de señales de crisis con escalación a humanos, y puente con los recursos reales de la provincia (directorio georreferenciado "Cerca tuyo", guías de trámites, fichas revisables por profesionales).

**No es**: terapia, diagnóstico ni tratamiento. Este posicionamiento reduce el riesgo de encuadre como producto médico, pero no lo resuelve por declaración: alcance, claims, flujos y evidencia deben ser revisados por asesoría argentina antes del piloto. Simón se limita a acompañamiento, orientación y derivación humana.

**Diseño de cumplimiento argentino propuesto**: consentimiento y autonomía progresiva sujetos a revisión legal, datos sensibles bajo Ley 25.326, minimización, cifrado, retención limitada, visibilidad del tutor como *alertas — no transcripciones* y evaluación de impacto. Los gaps técnicos previos al piloto están declarados en la propuesta técnica canónica; no se afirma cumplimiento completo antes de cerrarlos y obtener validación jurídica. Compatible además con Ley 26.657 (Salud Mental): régimen *rights-based*, presunción de capacidad, atención por equipos interdisciplinarios — Simón se posiciona como apoyo al sistema (triage, psicoeducación, puente a recursos), nunca como sustituto que diagnostica o trata de forma autónoma; ese límite es lo que evita la colisión con la ley.

**Seguridad por construcción** (arquitectura tipo Wysa/NHS, no tipo Character.AI): capa de crisis determinística sin LLM (~35ms, plantillas exactas con 135 / 0800-345-1435 / 102 / 137 / 911), doble moderación de todo lo que entra y sale del modelo, fail-closed (si algo falla, la respuesta segura sale igual), alertas de crisis al tutor, y gate de tests determinístico de 35+ suites que corre antes de cada deploy.

## 4. Estructura de precios

### 4.1 Fee provincial: USD 3.000/mes — por qué es conservador

| Comparable | Precio real |
|---|---|
| Chatbots cívicos gubernamentales EEUU (RFPs 311) | USD 25k–400k/año (awards: $76.820, $223.650, $759.247) |
| Wysa en NHS (Reino Unido) | £30k–£117k por servicio/ICB; ~£5,90 por usuario elegible/año |
| Software K-12 de salud mental (EEUU) | USD 3,50–12 por estudiante/año |
| Contratos IT públicos argentinos (COMPR.AR 2025) | USD 126k–905k |

**Simón a USD 36.000/año ≈ USD 0,05 por neuquino por año** (~750k hab.). Incluso midiendo solo sobre 10.000 usuarios activos: USD 3,60/usuario/año — el piso del rango internacional. El fee es **pricing provincial introductorio**: la expansión nacional puede pricear USD 8k–25k/mes por provincia sin contradicción, citando estos mismos benchmarks.

**Qué incluye**: hosting y operación (Vercel + Neon + Upstash + Resend + tokens LLM), soporte, monitoreo de seguridad, actualización de contenido (fichas/recursos/trámites con revisión profesional), evolución del producto y reportes a la provincia.

#### 4.1.1 Desglose de costos de operación (10k / 50k / 100k MAU)

Supuestos declarados (conservadores — ver riesgo #4 en §6):

- ~25 turnos (intercambio usuario↔Simón) por usuario activo mensual (uso moderado, no diario intensivo).
- Contexto por turno acotado por el presupuesto de tokens (ADR-7): ~1.400 tokens de entrada "frescos" (resumen + últimos mensajes) + ~2.500 tokens de system prompt/persona/fichas con cache-hit (estable entre turnos) + ~220 tokens de salida.
- +15% de overhead provisional por cascada de guardrails y tareas auxiliares (`AI_SMALL_MODEL`: título, memoria). La mezcla real entre regex, moderación externa y chequeo LLM debe medirse; no se presupone una API de moderación gratuita ni configurada.
- Arquitectura base vigente (ADR-1/2/3/4/7, ver `docs/adr-rearquitectura-2026-07.md`): router capaz de fallbacks, cascada de guardrails y purga por TTL. Un segundo proveedor realmente configurado/probado y los gaps declarados en la propuesta técnica siguen siendo prerequisitos del piloto institucional.

| Servicio | 10k MAU | 50k MAU | 100k MAU | Supuesto / fuente |
|---|---|---|---|---|
| Vercel (Pro + Fluid Compute) | ~USD 25–35 | ~USD 45–70 | ~USD 70–110 | Pro USD 20/mes (1 seat) + Active CPU USD 0,128/h + memoria provisionada USD 0,0106/GB-h; el tiempo de espera a la respuesta del LLM no se cobra (Active CPU pricing) |
| Neon Postgres | ~USD 25–40 | ~USD 100–160 | ~USD 280–350 | USD 0,106/CU-h (plan Launch) a USD 0,222/CU-h (plan Scale) + USD 0,35/GB-mes; a 100k MAU conviene Scale por PITR de 30 días y private networking, relevante para el SLA de un servicio estatal |
| Upstash Redis | ~USD 5 | ~USD 25 | ~USD 50 | USD 0,20 cada 100k comandos; ~10 comandos/turno (rate limit + sesión de better-auth vía `secondaryStorage`) |
| Resend | USD 0 (free) | ~USD 20 | ~USD 20 | Plan Pro (USD 20/mes) cubre 50k emails/mes; el volumen escala con altas de tutor + alertas de crisis, **no** 1:1 con MAU (los menores nunca reciben email, ver `docs/research-guardian.md` §3) |
| Tokens LLM (DeepSeek V4 Flash) | ~USD 75–90 | ~USD 380–450 | ~USD 760–900 | USD 0,14 / USD 0,0028 (cache-hit) / USD 0,28 por millón de tokens entrada/cache/salida (ver `docs/research-architecture.md` §1) |
| **Total infraestructura + LLM** | **~USD 130–190/mes** | **~USD 570–725/mes** | **~USD 1.180–1.430/mes** | |
| **Margen sobre el fee de USD 3.000/mes** | **~94–96%** | **~76–81%** | **~52–61%** | |

El margen decrece con la escala (previsible: los tokens LLM son el costo variable dominante) pero se mantiene sano en los tres escenarios, incluso con el 15% de buffer ya cargado en el supuesto de tokens.

**Hipótesis de ROI para validar en piloto**: costo unitario, derivaciones efectivas, tiempo profesional evitado y costo total por menor activo. Los comparables internacionales sirven para diseñar la medición, no para prometer ahorro local ni equivalencia con atención humana.

### 4.2 Laboratorio de IA: USD 10.000 (única vez) — capex de capacidad

**Qué se compromete honestamente**: NO es "entrenar un LLM propio desde cero". Es un **laboratorio de evaluación y modelos de seguridad en español rioplatense**, con entregables y gates detallados en `docs/propuesta-tecnica-2026-07.md`:

1. **Suite de evaluación de conversaciones de riesgo en español**: adaptación documentada de benchmarks abiertos como VERA-MH, más fixtures argentinos revisados profesionalmente. Se entrega con licencias, procedencia y baseline; no se promete exclusividad ni primacía nacional sin una búsqueda independiente.
2. **Clasificadores propios en español rioplatense** (`maat-guard`): detección/ruteo de crisis y abuso, evaluados en shadow mode antes de participar en decisiones productivas. El ahorro de LLM es una hipótesis a medir, no ingreso comprometido.
3. **Dataset sintético y revisado por profesionales**: los datos reales de menores quedan excluidos hasta contar con consentimiento de entrenamiento separado, finalidad, revocación y supresión verificables. La vinculación clínica/UNCo es una dependencia a contratar, no un hecho consumado.
4. **Cómputo reproducible y bajo demanda**: spot cloud con cap de gasto para entrenamiento; CPU/GPU existente para harness, cuantización y evaluación. Comprar workstation se decide solamente después de medir utilización y TCO.

**Narrativa defendible**: capacidad argentina para evaluar y controlar seguridad en español, con activos transferibles y menor dependencia de un proveedor. La familia generativa Maat permanece como I+D condicionada a gates; no forma parte del compromiso de USD 10.000.

### 4.3 Estructura contractual sugerida

- Fee SaaS flat mensual (no per cápita) + tier per cápita/por escuela opcional al escalar.
- Contrato inicial por piloto con opción de continuidad; plazo y descuento se definen después de medir operación y resultados.
- Lab itemizado por separado como inversión de capacidad (así separan licencia de implementación los deals de referencia).
- Cláusula de evaluación de resultados: piloto con medición independiente por una institución contratada (por ejemplo UNCo/ministerio), orientado a generar evidencia local sin anticipar conclusiones.

## 5. Roadmap comprometido (alto nivel)

| Fase | Hito |
|---|---|
| 0–3 meses | Harness de evaluación de seguridad en español (pre-requisito de todo lo demás) + hardening continuo de la plataforma |
| 3–6 meses | Clasificador de crisis en español en producción como capa de ruteo; piloto provincial con cohorte definida |
| 6–12 meses | Evaluación independiente del piloto; dataset clínico v1; expansión de cobertura provincial |
| 12+ meses | Caso nacional con evidencia propia; pricing por provincia según benchmarks citados |

## 6. Riesgos declarados (transparencia ante el comprador)

1. La evidencia mundial de eficacia de chatbots generativos **en adolescentes** es aún débil — por eso Simón no claimea eficacia clínica: claimea acompañamiento seguro + plan de generación de evidencia local.
2. La clasificación regulatoria de sistemas LLM orientados a bienestar/salud evoluciona; el contrato no debe afirmar aprobación, exención ni equivalencia clínica sin dictamen actualizado.
3. Benchmarks de contratos gov LatAm son opacos; los comparables citados son proxies US/UK (declarado en el anexo).
4. Cifras de infraestructura (§4.1.1: Vercel/Neon/Upstash/Resend/LLM) son estimaciones a partir de pricing público vigente a jul-2026 y de supuestos de uso declarados (25 turnos/MAU/mes) — no de tráfico real medido. Re-verificar contra telemetría de producción antes de fijar en contrato multi-año.
