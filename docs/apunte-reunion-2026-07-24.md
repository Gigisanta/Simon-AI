# Simón — Apunte para la reunión de mañana
## ANIDE + Gobierno del Neuquén · 24 julio 2026

> **Objetivo:** cerrar 6 decisiones y salir con fecha de workshop técnico de 90 minutos.

---

## Orden de la reunión

1. **Resumen ejecutivo** (2 min) — la idea
2. **Demo en vivo** (5 min) — simon.maat.work
3. **Presentación técnica** (15 min) — arquitectura + safety + lab
4. **Cheatsheet** — backup para preguntas
5. **Decisiones** (10 min) — datos, cohorte, operación
6. **Cierre** (3 min) — workshop de 90 min

---

## Apertura (memorizá esto)

> "Simón es un acompañante digital para chicos y adolescentes. No es un terapeuta. La seguridad no es un feature que agregamos: es la arquitectura. Además, estamos construyendo un laboratorio propio de modelos en español — no existe nada igual en el mundo. Hoy les vamos a mostrar cómo funciona, qué falta cerrar, y qué decisiones necesitamos tomar juntos."

---

## Las 5 ideas que tenés que tener claras

### 1. "La IA propone, el código decide."
- Las crisis son determinísticas: plantilla fija escrita por profesionales, nunca la improvisa la IA.
- Fail-closed: si un filtro no puede verificar, bloquea en vez de dejar pasar.
- El LLM nunca tiene autoridad sobre crisis.

### 2. La alternativa no es "nada" — es Character.AI sin protecciones.
- 86 suicidios en Neuquén en 2023.
- <2 psiquiatras cada 100.000 habitantes.
- 1 de cada 8 jóvenes ya habla de salud mental con chatbots sin filtros.
- Character.AI ya tuvo settlements por suicidios adolescentes en EEUU.

### 3. El laboratorio es la propuesta central.
- No existe en el mundo un modelo español-first sub-1B.
- No hay dataset conversacional rioplatense.
- No hay eval de seguridad infantil en español.
- No hay lab argentino de LLM.
- La razón NO es ahorro (DeepSeek cuesta ~USD 7/mes): es **soberanía**, **offline** (escuelas rurales sin señal), e **innovación**.
- La familia Maat: nano (150M) → micro (250M) → mini (400M) → 1B.
- Cada etapa entrega valor por sí sola. El proveedor comercial queda como fallback.

### 4. Guardamos lo mínimo.
- Email del tutor, año de nacimiento (no fecha completa), vínculo, consentimiento.
- Conversación: 365 días. Memoria sin PII: 90 días. Safety: 730/180 días.
- NO guardamos: dirección, escuela, fotos, geolocalización, biométricos.
- Consentimiento de producto ≠ consentimiento de entrenamiento.

### 5. La transparencia de deuda es una fortaleza.
- 7 gates P0 antes de datos reales. Si uno queda abierto, no hay cohorte.
- No fingimos que todo está terminado. Eso genera más confianza que prometer.

---

## Números para tener a mano

| Dato | Valor |
|------|-------|
| Suites | 37 |
| Casos de test | 1198 |
| Baseline crítico | 72/72 |
| Tests unitarios | ~60% |
| Tests integración | ~30% |
| Tests E2E | ~10% |
| Crisis fixtures | 72 (T1–T7) |
| Gates P0 | 7 |
| Disponibilidad SLO | ≥99,5% |
| Guardrail salida | ≥99,9% |
| Alertas críticas | 99% <5 min |
| Purga | 100% diario |
| Conversación TTL | 365 días |
| Memoria TTL | 90 días |
| Safety TTL | 730 / 180 días |
| Fee mensual | USD 3.000 |
| Lab (única vez) | USD 11.000 (10k lab + 1k herramientas) |
| Infra total (10k MAU) | ~USD 60–100/mes (sin LLM) |
| Costo por neuquino/año | ~USD 0,05 |
| Benchmarks internacionales | USD 3,50–12/estudiante/año |
| Familia Maat | 150M → 250M → 400M → 1B |
| Lab compute | ~USD 2.000–4.700/año (H100 spot) |
| Neuquén 2023 | 86 suicidios |
| Psiquiatras región | <2 cada 100k |

---

## Los 7 gates P0 (memorizá el orden)

1. **Training consent** — consentimiento de entrenamiento separado del de producto.
2. **Rate limit compartido** — backend real, sin fallback a memoria local.
3. **Alert outbox** — callback perdido, retry, dedupe, reconciliación.
4. **Mood TTL** — definir finalidad, visibilidad y retención del estado de ánimo.
5. **LLM vendor** — SLA, no-training, retención, incidentes y fallback.
6. **Restore drill** — recuperación probada en rama aislada.
7. **Canal tutor** — dominio/remitente verificado y entrega a externos.

**Si uno queda abierto → NO-GO. No hay cohorte con datos reales.**

---

## Resiliencia — qué pasa cuando algo falla

| Falla | Qué pasa | Qué sigue funcionando |
|-------|----------|----------------------|
| Proveedor de IA | Timeout + fallback a segundo proveedor | Crisis (plantillas fijas) |
| Neon (base de datos) | Error 503, sin escritura parcial | PITR para restaurar |
| Vercel | App no disponible | Datos seguros en Neon |
| Email al tutor | Outbox pendiente, reintento automático | Reconciliación diaria |

**Principio:** degradar funcionalidad, nunca seguridad.

---

## Proveedor de IA — matriz para tener preparada

| Criterio | OpenAI | Anthropic | Azure | DeepSeek (actual) |
|----------|--------|-----------|-------|-------------------|
| DPA / no-training | ✓ Enterprise | ✓ API | ✓ Azure | ✗ No verificado |
| Retención | 30 días | 30 días | 0 días (config) | Desconocida |
| SLA | 99,9% | 99,9% | 99,99% | Sin SLA |
| Región | US/EU | US/EU | Seleccionable | US |
| Incident response | ✓ | ✓ | ✓ | ✗ |
| Costo | Alto | Alto | Alto | Bajo |

**Si preguntan "¿cuál sería el proveedor?":** "Se elige en la mesa según SLA, residencia y costo. El sistema no depende de ningún modelo puntual — se cambia con 2 variables de entorno."

---

## Threat model — lo que un arquitecto de seguridad puede preguntar

| Amenaza | Control |
|---------|---------|
| Prompt injection / jailbreak | Precedencia determinística + moderación de salida + tests adversariales |
| IDOR / tutela | Autorización por relación tutor-menor, ownership checks |
| PII / exfiltración | Redacción, minimización, allowlist, logs sin texto |
| Alertas perdidas | Outbox, idempotencia, dedupe, retry, reconciliación |
| Supply chain | Lockfile, SBOM, model ID, hashes, canary, rollback |
| OWASP LLM01 | Precedencia + moderación |
| OWASP LLM02 | Minimización + logs sin texto |
| OWASP LLM06 | Sin herramientas con efectos laterales accesibles al LLM |
| Secretos | Vercel env vars, no en Git, rotación documentada |
| Secreto de prompts | En código, versionado en Git, rotación por deploy |

---

## Preguntas difíciles — respuestas cortas

### "¿La IA puede decir algo dañino?"
→ Puede generar texto imperfecto, pero nunca llega al menor sin pasar por un filtro de reglas. Si el filtro detecta riesgo, reemplaza la respuesta con una plantilla escrita por profesionales.

### "¿Qué pasa si la IA no detecta una crisis?"
→ Tenemos una capa de reglas fijas que busca patrones de crisis antes de que la IA genere nada. Si detecta algo, la respuesta es automática y no pasa por la IA. Como un detector de humo.

### "¿Por qué no ChatGPT directamente?"
→ ChatGPT no fue diseñado para menores. No tiene consentimiento parental, no tiene filtros de crisis específicos, y guarda datos para entrenar. Simón usa IA con reglas de seguridad propias.

### "¿La IA 'aprende' de los chicos?"
→ No. Los datos de menores no se usan para entrenar. La IA es un servicio externo: procesa y olvida. Hay consentimiento separado, y hoy está prohibido.

### "¿Qué datos guardan?"
→ Lo mínimo: email del tutor, año de nacimiento (no fecha completa), la conversación con retención configurable. No dirección, no escuela, no fotos.

### "¿El tutor lee las conversaciones?"
→ No. Recibe alertas si hay riesgo y un resumen semanal de temas. No transcripciones.

### "¿USD 3.000/mes? ¿No es caro?"
→ Hosting, soporte, seguridad, contenido y evolución. Benchmarks: USD 3,50–12/estudiante/año en EEUU. Simón a USD 36.000/año para toda la provincia es el piso del rango.

### "¿Qué pasa si desaparece la empresa?"
→ Código estándar (Next.js, Postgres), no tecnología propietaria. Contrato con cláusulas de continuidad y escrow de código.

### "¿Reemplaza psicólogos?"
→ No. No diagnostica, no prescribe, no reemplaza. Es acompañamiento y derivación. La provincia tiene <2 psiquiatras cada 100k.

### "¿Por qué monolito?"
→ Más simple de operar, auditar y asegurar. Para un piloto con una jurisdicción, no necesitamos microservicios. Si crecemos, evaluamos separar — solo cuando una métrica lo justifique.

### "¿Por qué construir su propio modelo?"
→ No es ahorro. Es soberanía de datos de menores, funcionamiento offline en escuelas rurales, y un nicho vacío verificado: no existe ningún modelo español-first sub-1B en el mundo.

### "¿Qué pasa si cae el proveedor de IA?"
→ Fallback a otro proveedor. Si ambos fallan, chat se pausa pero plantillas de crisis siguen activas.

### "¿Tienen backup?"
→ PITR + backups de config en Git. No afirmamos RPO/RTO hasta hacer un restore drill real. Eso es uno de los 7 gates.

### "¿Dónde están los datos?"
→ Servidores de EEUU (Vercel y Neon). Cumplimos Ley 25.326. Si exigen residencia en Argentina, es una decisión de costo.

---

## Frases que sí funcionan

- "La IA propone, el código decide."
- "Fail-closed: si no sabemos si es seguro, no se muestra."
- "No guardamos datos 'por si acaso'."
- "El tutor recibe alertas, no transcripciones."
- "La alternativa no es 'nada': es Character.AI sin protecciones."
- "No existe un modelo español-first sub-1B en el mundo."
- "Cada etapa del lab entrega valor por sí sola."
- "No prometemos eficacia clínica: prometemos acompañamiento seguro."

---

## Frases que NO hay que decir

- ❌ "Previene suicidios" — no hay evidencia para afirmarlo.
- ❌ "Es como hablar con un psicólogo" — no lo es.
- ❌ "La IA aprende de los chicos" — los datos no se usan para entrenar.
- ❌ "Es 100% seguro" — nada lo es; decirlo genera liability.
- ❌ "Podemos tenerlo listo en 2 semanas" — los 7 gates toman tiempo.
- ❌ "El costo es fijo para siempre" — depende del uso y decisiones de infra.
- ❌ "DeepSeek es nuestro proveedor" — es el runtime de desarrollo, no el institucional.

---

## Decisiones que necesitamos de ellos

1. **Datos:** ¿Quién es el responsable de datos? ¿Qué retención aprueban? ¿Residencia en EEUU o Argentina?
2. **Cohorte:** ¿Cuántos usuarios? ¿Qué edades? ¿Qué territorio? ¿Qué recursos locales?
3. **Operación:** ¿Owner técnico? ¿Quién firma los gates? ¿Cuándo el workshop de 90 min?

---

## Cierre (memorizá esto)

> "Si acordamos quién es el responsable de datos, qué proveedores aprobamos, y cuándo hacemos el workshop técnico, convertimos los siete gates en un backlog con owner y fecha. Sin ese acuerdo, no proponemos habilitar datos reales. La seguridad no se negocia."

---

## Checklist para salir con

- [ ] Arquitecto / owner técnico
- [ ] Responsable de datos
- [ ] Owner de safety
- [ ] Fecha de workshop

---

## Notas post-reunión

**Restricciones / integraciones que mencionaron:**



**Decisiones / owners / fechas:**



**Follow-ups:**

