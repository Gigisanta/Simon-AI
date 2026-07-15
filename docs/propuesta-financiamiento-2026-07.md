# Simón — Propuesta de financiamiento y pricing (borrador 2026-07)

> Documento de trabajo para la negociación con el Gobierno de la Provincia del Neuquén.
> Benchmarks y fuentes: ver `docs/research-briefing-gov-2026-07.md` (anexo con comparables citados).
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

**No es**: terapia, diagnóstico ni tratamiento. Este posicionamiento es deliberado: (a) mantiene a Simón fuera del régimen de producto médico de ANMAT (Disp. 64/2025); (b) evita el camino que quebró a los jugadores más validados del mundo (Woebot: 14 RCTs, US$124M quemados persiguiendo una vía regulatoria que no existe para LLMs); (c) es lo que exige la dirección regulatoria global (Illinois, Nevada, California SB-243, EU AI Act).

**Compliance nativo argentino**: consentimiento por tramos etarios (CCyCN art. 26, autonomía progresiva; tutores <13, asistido 13–16), datos sensibles bajo Ley 25.326 (consentimiento expreso, minimización, cifrado, TTL de retención con purga diaria automática), visibilidad del tutor como *alertas — no transcripciones*, y mapeo explícito a los marcos del propio Estado: Disp. JGM 2/2023 "IA Fiable", guía AAIP de IA responsable y guía CIPPEC de IA para el sector público.

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

**Qué incluye**: hosting y operación (Vercel + Neon, margen sano: infra+LLM a 10k MAU < USD 500/mes), soporte, monitoreo de seguridad, actualización de contenido (fichas/recursos/trámites con revisión profesional), evolución del producto y reportes a la provincia.

**ROI para la provincia**: costo por interacción de IA USD 0,50–2 vs USD 8–15 de atención humana equivalente de primer contacto; cada triage temprano descomprime un sistema con lista de espera. (Wysa-NHS reporta ~£105 y 97 minutos clínicos ahorrados por triage.)

### 4.2 Laboratorio de IA: USD 10.000 (única vez) — capex de soberanía

**Qué se compromete honestamente**: NO es "entrenar un LLM propio desde cero" — es un **laboratorio de evaluación y modelos de seguridad en español**, el primer activo de este tipo del país:

1. **Suite de evaluación de riesgo suicida en español** (adaptación de VERA-MH, el estándar abierto internacional): hoy no existe en español en ningún lado. Publicable — diferenciación instantánea frente a cualquier producto importado.
2. **Clasificadores propios en español rioplatense** (detección de crisis, ruteo, filtros): modelos chicos, entrenables con QLoRA por decenas de dólares por corrida, que además **reducen el gasto mensual de LLM** (el lab se paga parcialmente solo).
3. **Dataset argentino revisado por clínicos** (partnership con psicólogos locales / UNCo): el recurso genuinamente escaso a nivel mundial no son las GPUs — son datos de counseling en español validados profesionalmente.
4. Workstation local (GPU 24GB) para iteración diaria e inferencia privada sobre datos sensibles en territorio argentino — aranceles de componentes al 0% desde 2025 y energía barata hacen viable el fierro local.

**Narrativa**: modelo argentino, datos argentinos, cómputo argentino. Para un gobierno con ambición nacional, es un activo político-estratégico, no un gasto.

### 4.3 Estructura contractual sugerida

- Fee SaaS flat mensual (no per cápita) + tier per cápita/por escuela opcional al escalar.
- Contrato multi-año con descuento (norma en NHS/distritos EEUU).
- Lab itemizado por separado como inversión de capacidad (así separan licencia de implementación los deals de referencia).
- Cláusula de evaluación de resultados: piloto con medición independiente (UNCo/ministerio) — Simón genera la evidencia argentina que hoy no existe en el mundo para esta población.

## 5. Roadmap comprometido (alto nivel)

| Fase | Hito |
|---|---|
| 0–3 meses | Harness de evaluación de seguridad en español (pre-requisito de todo lo demás) + hardening continuo de la plataforma |
| 3–6 meses | Clasificador de crisis en español en producción como capa de ruteo; piloto provincial con cohorte definida |
| 6–12 meses | Evaluación independiente del piloto; dataset clínico v1; expansión de cobertura provincial |
| 12+ meses | Caso nacional con evidencia propia; pricing por provincia según benchmarks citados |

## 6. Riesgos declarados (transparencia ante el comprador)

1. La evidencia mundial de eficacia de chatbots generativos **en adolescentes** es aún débil — por eso Simón no claimea eficacia clínica: claimea acompañamiento seguro + plan de generación de evidencia local.
2. Ningún regulador del mundo autorizó todavía un dispositivo LLM de salud mental — por eso el posicionamiento bienestar/acompañamiento.
3. Benchmarks de contratos gov LatAm son opacos; los comparables citados son proxies US/UK (declarado en el anexo).
4. Cifras de infraestructura (Neon/Vercel/LLM) varían por época de plan — re-verificar antes de fijar en contrato.
