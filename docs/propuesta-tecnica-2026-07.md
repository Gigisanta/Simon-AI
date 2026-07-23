# Simón AI — Propuesta técnica canónica

> Versión: 2026-07-23 · Estado: **PROPUESTA TÉCNICA PARA PILOTO INSTITUCIONAL**
> Alcance: plataforma Simón + laboratorio de seguridad/modelos en español.
> Fuentes de implementación: [`ARCHITECTURE.md`](ARCHITECTURE.md), [`adr-rearquitectura-2026-07.md`](adr-rearquitectura-2026-07.md), código bajo `simon/` y laboratorio bajo `lab/`.
> Fuente comercial: [`propuesta-financiamiento-2026-07.md`](propuesta-financiamiento-2026-07.md).
> Regla: este documento define **qué ofrecemos técnicamente**. Los documentos de research justifican decisiones; no amplían por sí solos el alcance contractual.

## 1. Resumen ejecutivo

Simón es una plataforma digital tutor-first de acompañamiento, orientación y acceso a recursos para chicos y adolescentes de 6 a 18 años. No diagnostica, no prescribe, no reemplaza atención profesional y no se presenta como terapeuta.

La propuesta combina dos entregables separados:

1. **Plataforma provincial operable**: aplicación web segura, auditable y de bajo costo, con chat protegido, consentimiento del tutor, recursos locales, trámites, alertas y retención limitada.
2. **Laboratorio de seguridad en español**: benchmark, dataset sintético/revisado y clasificador de riesgo rioplatense. La familia generativa Maat es I+D interna condicionada a evidencia; no es requisito para operar la plataforma ni promesa de reemplazo inmediato del proveedor comercial.

Arquitectura PONYTAIL:

- un monolito modular Next.js;
- un Postgres administrado como fuente de verdad;
- un proveedor LLM sustituible;
- seguridad determinística fuera del LLM;
- email y jobs pequeños;
- ningún servicio externo de colas, vector DB o microservicio adicional sin un trigger medido.

## 2. Resultado que compra la provincia

### 2.1 Producto operativo

- Alta de menores exclusivamente desde una cuenta de tutor verificada.
- Consentimiento del tutor previo al chat y revocable, más información y asentimiento del menor en lenguaje adecuado a su edad.
- Chat en español rioplatense con disclosure visible de que Simón es una IA.
- Intervención determinística ante crisis y abuso, sin depender de una generación libre.
- Derivación hacia líneas y recursos reales, versionados y revisados.
- Alertas al tutor sin incluir transcripciones.
- Herramientas de regulación, diario/check-in, recursos cercanos y guía de trámites.
- Exportación, suspensión y supresión de datos conforme al contrato y la política aprobada.
- Métricas operativas y de seguridad sin contenido conversacional.

### 2.2 Activos transferibles del laboratorio

- Taxonomía de riesgo T1–T7 documentada.
- Corpus de evaluación infantil en español rioplatense con procedencia y licencias.
- Adaptación evaluable de VERA-MH al español argentino, sujeta a validación profesional.
- Clasificador `maat-guard` con model card, dataset card y reporte de evaluación.
- Harness reproducible para comparar reglas, proveedores y checkpoints.
- Runbooks de promoción, rollback e incidentes de modelo.

### 2.3 Fuera de alcance

- Psicoterapia, diagnóstico, prescripción o decisión clínica automatizada.
- Monitoreo oculto del menor o entrega de transcripciones al tutor por defecto.
- Perfilado publicitario, venta de datos o entrenamiento implícito con conversaciones.
- Promesa de prevención de suicidio o eficacia clínica sin estudio independiente.
- Entrenar desde cero un LLM general de frontera.
- Reemplazar profesionales, líneas de emergencia o servicios públicos existentes.
- Integraciones clínicas/HCE, biometría, voz continua o geolocalización precisa en el piloto.

## 3. Principios de diseño

1. **Interés superior del menor**: ante conflicto entre engagement, costo y seguridad, gana seguridad.
2. **Tutor-first, no vigilancia-first**: consentimiento verificable y privacidad proporcional a la edad.
3. **El LLM no decide la emergencia**: crisis y abuso tienen detección/plantillas determinísticas y derivación humana.
4. **Minimización**: guardar lo mínimo, por tiempo limitado y con finalidad explícita.
5. **Fallback seguro**: si el proveedor o la moderación fallan, el sistema degrada funcionalidad; no degrada el piso de seguridad.
6. **Writer ≠ checker**: una regla, modelo o dataset no se promueve usando solamente su propia evaluación.
7. **Proveedor sustituible**: ningún proveedor queda incrustado en la lógica de dominio.
8. **Sin infraestructura anticipada**: escalar solo por SLO, volumen o incidentes medidos.
9. **Claims conservadores**: acompañamiento y orientación, no eficacia clínica no demostrada.

## 4. Arquitectura objetivo

```text
Navegador
   |
   v
Next.js 16 / React 19 (Vercel)
   |
   +-- Auth y consentimiento ----------+
   +-- Chat pipeline ------------------+---- Neon Postgres
   +-- Panel tutor / recursos ---------+     fuente de verdad
   +-- Cron de purga y reconciliación -+
   |
   +-- Resend (email transaccional)
   |
   +-- LLM institucional compatible con OpenAI API
          |
          +-- proveedor primario contratado
          +-- fallback contratado/probado
          +-- futuro endpoint Maat, solo tras gate
```

### 4.1 Aplicación

- **Next.js 16 + React 19 + Tailwind v4**: UI y handlers HTTP en un despliegue.
- **Prisma 7 + Neon Postgres**: usuarios, tutela, conversaciones, recursos, eventos, telemetría y locks.
- **better-auth**: credenciales y sesiones en nuestra base.
- **AI SDK**: adaptador OpenAI-compatible y router ordenado de proveedores.
- **Resend**: verificación y alertas; el contenido sensible no viaja en el email.
- **RAG liviano**: selección sobre fichas revisadas en Postgres. `pgvector` se habilita solo si la evaluación demuestra que la selección léxica deja de alcanzar.

### 4.2 Pipeline de chat

```text
requireSession
→ requireGuardianConsent
→ rateLimit
→ validate
→ deterministicCrisisPrecheck
→ moderateInput
→ buildAgeBoundedContext
→ generateWithTimeoutAndFallback
→ moderateOutput
→ deterministicPrecedence
→ persistAtomically
→ recordTelemetry
→ reconcileAlerts
```

Invariantes:

- La plantilla crítica no pasa por el LLM.
- Un fallo del log o email no rompe la respuesta al menor.
- La persistencia del mensaje y su evento de seguridad es transaccional.
- La salida no moderada no llega al usuario como respuesta normal.
- El historial se recorta por presupuesto de tokens y franja etaria.
- Ningún documento no revisado entra en el contexto productivo.

### 4.3 Datos

| Dato | Finalidad | Contenido permitido | Retención objetivo |
|---|---|---|---|
| Cuenta/tutela | autenticación y consentimiento | email del tutor, año de nacimiento, vínculo, evidencia de consentimiento | mientras la cuenta esté activa; supresión/cascade al cerrar |
| Conversación | continuidad del servicio | mensajes y resumen | configurable por contrato; default actual 365 días |
| Memoria | personalización mínima | hechos/preferencias sin PII intencional | default actual 90 días |
| SafetyEvent | auditoría y alerta | categoría, capa, timestamps; nunca texto | default actual 730 días |
| InteractionLog | SLO/costo/evaluación | IDs, latencia, tokens, modelo, ruta; nunca texto | default actual 180 días |
| MoodEntry | check-in del menor | valor, contexto, nota opcional | **a definir antes del piloto; hoy no tiene TTL propio** |
| Dataset de entrenamiento | I+D separado | sintético por defecto; real solo con consentimiento separado | política propia por dataset/version |

Los plazos son defaults técnicos, no una conclusión jurídica. La provincia, el responsable de datos y la revisión legal deben aprobar finalidad y retención antes del piloto.

## 5. Seguridad infantil

### 5.1 Defensa multicapa

1. **Capa determinística**: regex/fixtures T1–T7; crisis y abuso sustituyen la respuesta.
2. **Moderación de entrada**: servicio especializado cuando está contratado; fallback a clasificador secundario.
3. **Generación acotada**: persona, edad, longitud y prohibiciones explícitas.
4. **Moderación de salida**: toda salida libre se evalúa antes de entregarse.
5. **Precedencia determinística**: código puro decide entre plantilla, reemplazo o respuesta normal.
6. **Alerta/reconciliación**: evento persistente, dedupe, retry y barrido de pendientes.
7. **Revisión humana**: fixtures, templates, recursos y releases de modelos requieren owner distinto del autor.

### 5.2 Controles concretos

- Plantillas críticas versionadas con teléfonos y recursos verificados antes de cada release.
- Suite de crisis bloqueante: 100% de los fixtures críticos deben tomar el path determinístico correcto.
- Pruebas adversariales en rioplatense, faltas, eufemismos, emojis, role-play y prompt injection.
- Prompts y documentos tratados como entrada no confiable; sin herramientas con efectos laterales accesibles al LLM.
- No incluir secretos, datos de otros usuarios ni texto de eventos en el contexto.
- Límites de tamaño, turnos, frecuencia y duración de sesión.
- Kill switch por proveedor/modelo y rollback a la última versión aprobada.
- Recursos públicos con `source`, jurisdicción, fecha de revisión y owner editorial.

### 5.3 Alertas

La ruta mínima no necesita un bus nuevo. Se usa Postgres como outbox:

- `SafetyEvent` se persiste antes de responder.
- Todo evento alertable con `notifiedAt = null` queda pendiente, aunque `after()` nunca haya corrido.
- Un cron toma pendientes con lock, envía, marca éxito/fallo y reintenta con backoff.
- Dedupe por menor/categoría/ventana.
- Métrica: antigüedad del evento pendiente más viejo.

Escalar a Vercel Queues u otra cola durable solamente si el outbox incumple el SLO o el volumen genera contención medible.

### 5.4 Threat model mínimo

| Amenaza | Frontera atacada | Control obligatorio | Evidencia |
|---|---|---|---|
| Prompt injection directa/indirecta | input, historial, fichas | delimitadores, roles server-side, sin tools con efectos, output guardrail | suite adversarial |
| Filtración de PII/secrets | prompt, logs, proveedor | minimización, redacción, no secretos en contexto, vendor DPA/retención | fixtures + inspección de logs |
| Respuesta peligrosa o alucinada | proveedor/modelo | plantillas determinísticas, moderación de salida, fuentes revisadas, fallback | crisis/retrieval suites |
| Acceso cruzado tutor/menor | auth/API/DB | ownership en cada query, deny-by-default, tests IDOR | auth/guardian suites |
| DoS y abuso de costo | endpoints/LLM | rate limit compartido, topes de input/turnos/tokens, circuit breaker | load/limit tests |
| Alerta perdida | callback/email | outbox persistente, retry, lock, métrica de pendientes | chaos test de callback/email |
| Poisoning o recurso vencido | dataset/RAG | provenance, hash, revisión, expiración, separación train/eval | dataset card + content audit |
| Supply chain/model swap | npm, pesos, API | lockfile, hashes, SBOM, model ID/version, canary y rollback | release receipt |
| Exfiltración interna | consolas/proveedores | MFA, mínimo privilegio, cuentas nominadas, auditoría | access review |

## 6. Privacidad, gobernanza y contratación de proveedores

### 6.1 Gates previos al piloto

- Responsable y encargado de cada tratamiento identificados contractualmente.
- Registro/inventario de bases y finalidades revisado con la AAIP/asesoría correspondiente.
- Evaluación de impacto de privacidad e IA documentada.
- Consentimiento de uso del producto separado del consentimiento de entrenamiento; registrar versión/finalidad y ofrecer al menor una explicación y mecanismo de oposición adecuados a su edad.
- Flujo verificable de acceso, rectificación, exportación, oposición/revocación y supresión.
- Lista de subprocesadores, países/regiones de procesamiento y transferencias internacionales.
- Runbook de incidentes con responsables, preservación de evidencia y comunicación.
- Prueba de restauración y política RPO/RTO acordadas.
- Revisión profesional de templates, taxonomía y recursos.

### 6.2 Gate de proveedor LLM

El gateway actual puede servir para desarrollo, pero no es elegible como primario institucional hasta acreditar:

- contrato/DPA y finalidad del tratamiento;
- no uso de prompts/respuestas para entrenamiento salvo opt-in;
- retención declarada y opción equivalente a zero-data-retention cuando corresponda;
- subprocesadores y regiones;
- cifrado, control de acceso y notificación de incidentes;
- SLA, soporte y procedimiento de cambio/deprecación de modelo;
- identificador de versión estable y capacidad de rollback;
- costo y límites verificables bajo carga.

El contrato no debe nombrar un modelo como dependencia permanente. Debe exigir un **perfil de servicio** que cualquier proveedor aprobado pueda cumplir.

### 6.3 Acceso interno

- Menor privilegio y MFA para Vercel, Neon, email y registro de modelos.
- Cuentas personales nominadas; no compartir credenciales.
- Secretos fuera de Git, con permisos locales restrictivos o keychain/secret manager; nunca archivos legibles por otros usuarios del host.
- Producción separada de preview/desarrollo.
- Datos productivos fuera de entornos de prueba.
- Logs de acceso y cambios administrativos retenidos según política.
- Rotación/revocación de secretos y escaneo de repositorios.

## 7. Confiabilidad y operación

### 7.1 SLO propuestos

| Indicador | Piloto controlado | Producción provincial |
|---|---:|---:|
| Disponibilidad mensual del núcleo autenticado | ≥99,5% | ≥99,9% después de 3 meses de baseline |
| Fixtures críticos por path correcto | 100% | 100% |
| Respuestas libres con guardrail de salida concluyente | ≥99,9% | ≥99,99% |
| Alertas críticas reconciliadas | 99% <5 min | 99,9% <5 min |
| P95 de respuesta normal | medir primero; objetivo ≤6 s | objetivo acordado con proveedor |
| Éxito de purga programada | 100% diario | 100% diario |
| Restauración verificada | trimestral | mensual/trimestral según contrato |

El `100%` de fixtures significa **100% dentro de la suite versionada**, no una garantía de detectar toda expresión real. La suite actual de 72 casos es un baseline de regresión; antes del piloto debe ampliarse con variantes indirectas, jerga, negación, role-play, errores ortográficos y muestras revisadas profesionalmente, con cobertura reportada por edad/categoría.

Los objetivos de latencia y disponibilidad se contractualizan solo después de un piloto con telemetría real.

### 7.2 Observabilidad mínima

- `requestId`, versión de aplicación, proveedor/modelo y `responsePath`.
- Latencia total/generación, tokens, cache y errores por capa.
- Conteos agregados de categorías; nunca texto en métricas.
- Estado de verificación email, alertas pendientes, purga y fallbacks.
- Dashboard diario/semanal y alertas solo para condiciones accionables.
- Synthetic smoke autenticado con usuario de QA aislado y limpieza posterior.

### 7.3 Backup y recuperación

- PITR/snapshots de Neon según plan contratado.
- Restore drill a una rama aislada: migraciones, integridad referencial y smoke.
- Backup de configuración, migraciones y fichas públicas versionadas en Git.
- Datasets/pesos del lab con hash, versionado y copia fría.
- No afirmar RPO/RTO hasta verificar el plan real contratado y ejecutar el restore drill.

## 8. Escalabilidad sin sobrearquitectura

### Etapa A — piloto

- Un proyecto Vercel.
- Un Postgres Neon pooled.
- Un proveedor primario y un fallback probado.
- Postgres outbox para alertas.
- Selección léxica de fichas.

### Etapa B — 10k MAU

Agregar solamente si las métricas lo justifican:

- Upstash para descargar rate limits/hot counters de Postgres.
- Cola administrada si el outbox incumple latencia o genera contención.
- `pgvector` si cae la precisión de retrieval con el corpus real.
- Réplica de lectura si los queries read-heavy presionan el primario.

### Etapa C — 100k MAU/multijurisdicción

- Aislamiento lógico por tenant/jurisdicción.
- Cuotas, feature flags y políticas de retención por contrato.
- Runbooks 24×7 y on-call formal.
- Pruebas de carga, capacidad y recuperación por región.
- Evaluar residencia/hosting dedicado si el comprador lo exige.

No se parte el monolito por cantidad de usuarios. Se parte únicamente cuando ownership, despliegue o aislamiento lo requieran y una métrica demuestre el problema.

## 9. Laboratorio Maat: compromiso y escalera go/no-go

### 9.1 Compromiso externo realista

1. Harness reproducible.
2. Taxonomía y corpus de seguridad en español.
3. Dataset sintético/revisado con provenance y licencias.
4. `maat-guard` como clasificador/ruteador.
5. Reporte contra baseline comercial.

### 9.2 I+D interna condicionada

- `maat-nano` (~150M): experimento de fallback universal.
- `maat-micro` (~250M): candidato principal on-device.
- `maat-mini` (~400M): candidato de mayor calidad local.
- `maat-1b`: solo si los modelos menores no alcanzan el umbral y existe caso server-side.

### 9.3 Gates por etapa

| Etapa | Gate de promoción | Salida si falla |
|---|---|---|
| E0 Harness | determinismo, datasets versionados, crisis 100%, evaluator distinto del writer | no entrenar; corregir evaluación |
| E1 `maat-guard` | recall crítico no inferior al baseline; FPR dentro del presupuesto; calibración por edad/dialecto | mantener reglas + moderador externo |
| E2 modelo base abierto destilado | seguridad no regresa; calidad/latencia/RAM alcanzan el target del caso limitado | detener modelo generativo; conservar guard/harness |
| E3 pretraining propio | solo si E2 demuestra límite atribuible al modelo base y existe dataset/licencia suficientes | no ejecutar; evitar gasto hundido |
| E4 browser/on-device | matriz real de dispositivos, descarga, memoria, tok/s, batería y fallback WASM | modo server; no bloquear la app |
| E5 producción | canary, kill switch, fallback contratado y revisión humana | rollback automático |

Regla binaria: costo o velocidad nunca compensan una regresión en seguridad.

### 9.4 Datos del laboratorio

- Sintéticos por defecto.
- Datos reales de menores: prohibidos hasta tener `trainingConsentAt`, versión del consentimiento, finalidad, revocación y exclusión efectiva en export.
- Conversaciones con crisis/abuso: excluidas del dataset generativo.
- Split por conversación/persona, deduplicación y decontaminación contra eval.
- Dataset card con fuente, licencia, transformación, PII, población y limitaciones.
- Model card con arquitectura, tokenizer, hardware, métricas, riesgos y usos prohibidos.
- Repositorios privados y tokens con alcance mínimo; publicación solo de activos aprobados.

### 9.5 Gates de cartera para evitar I+D infinita

- **Semana 4 — baseline congelado:** no entrenar si todavía no existe evaluación reproducible del proveedor comercial y una muestra humana estratificada.
- **Mes 2 — `maat-guard`:** si no alcanza recall crítico y calibración acordados, concentrar el lab en dataset/eval; no abrir el frente generativo.
- **Mes 4 — destilado sobre base abierta:** si no pasa seguridad y no demuestra valor medible en calidad/latencia/RAM, detener la línea generativa. Harness y guard siguen siendo entregables válidos.
- **Pretraining desde cero:** solo se autoriza si el destilado demuestra un techo atribuible al modelo base, el dataset/licencias están cerrados y hay presupuesto/owner explícitos.
- **Revisión humana obligatoria:** toda promoción usa una muestra ciega por edad, riesgo y dialecto revisada por personas distintas de quienes entrenaron el candidato.
- **Bus factor:** cada etapa debe poder reproducirse desde runbook, config, seed y hashes por una segunda persona; si no, no se promueve.

## 10. Roadmap de entrega

### Fase 0 — readiness institucional (0–6 semanas)

- Cerrar los gaps P0 del §11.
- Evaluación de impacto, vendor review y política de datos.
- Outbox/reconciliación de alertas.
- Restore drill y smoke productivo.
- Baseline de SLO y costo.

**Gate:** no iniciar piloto con datos reales sin consentimiento separado, proveedor aprobado, alertas reconciliables y restauración probada.

### Fase 1 — piloto controlado (6–12 semanas)

- Cohorte y jurisdicción acotadas.
- Recursos locales revisados.
- Dashboard de seguridad/operación.
- Evaluación de UX, cobertura y falsos positivos; no eficacia clínica.
- Harness español v1.

**Gate:** comité de revisión acepta incidentes, métricas y cambios antes de ampliar cohorte.

### Fase 2 — operación provincial (3–6 meses)

- SLO contractual basado en evidencia del piloto.
- Segundo proveedor probado.
- `maat-guard` candidato en shadow mode; no decide solo.
- Auditoría de accesos, retención y derechos.

**Gate:** expansión solo sin regresión de seguridad y con soporte operativo financiado.

### Fase 3 — soberanía/on-device (6–12+ meses)

- Maat generativo únicamente en alcance de bajo riesgo.
- Browser/device benchmark y fallback server.
- Evaluación independiente y publicación selectiva de activos.

## 11. Gaps actuales que la propuesta no oculta

### P0 — antes del piloto institucional

1. **Consentimiento de entrenamiento ausente**: el schema actual tiene `Guardian.consentAt`, pero no `trainingConsentAt` ni versión/finalidad separada. El export no puede usar datos reales hasta cerrarlo.
2. **Rate limit del chat sin backend DB**: better-auth puede usar Postgres, pero `src/lib/rate-limit.ts` todavía degrada a memoria sin Upstash y el preflight puede considerar suficiente `DATABASE_URL` aunque este módulo no la use. La documentación y el env check no deben afirmar que todo el rate limit ya es compartido.
3. **Alerta perdida antes del callback**: reconciliar todo evento alertable con `notifiedAt = null`, no solamente fallos que alcanzaron a marcar `alertFailedAt`.
4. **`MoodEntry` sin TTL**: definir finalidad, visibilidad y retención; la nota puede contener datos sensibles.
5. **Proveedor primario no institucionalizado**: falta evidencia contractual de SLA, retención, no-training, subprocesadores y respuesta a incidentes; tampoco está demostrada una sonda operativa ni un fallback secundario configurado y ejercitado.
6. **Restore drill no documentado**: PITR disponible no equivale a recuperación probada.
7. **Canal real de alertas no cerrado**: verificar dominio/remitente de Resend y entrega a direcciones externas; `onboarding@resend.dev` solo sirve para desarrollo y no cumple el caso tutor.

### P1 — durante el piloto

1. Request/trace ID y correlación operativa end-to-end.
2. Revisión/expiración explícita de fichas y recursos por owner.
3. Shadow evaluation del segundo proveedor y rollback ejercitado.
4. Presupuestos de falsos positivos/negativos por categoría y franja etaria.
5. Política de publicación/licencias del lab y threat model de supply chain.
6. Matriz de tests en dispositivos reales y accesibilidad con menores/tutores.
7. CSP y allowlists de red derivadas de endpoints aprobados, sin amplitud innecesaria.
8. Verificación/rotación de archivos locales de secretos y permisos restrictivos.

## 12. Criterios de aceptación contractual

La entrega técnica se acepta con evidencia, no con una demo:

- Gate de código completo verde y artefacto reproducible.
- Crisis suite crítica 100% y reporte adversarial firmado.
- Consentimiento/revocación/supresión verificados end-to-end.
- Proveedor y subprocesadores aprobados.
- Outbox de alertas probado simulando caída de email y callback perdido.
- Purga verificada con fixtures vencidos de cada tabla.
- Restore drill desde snapshot/PITR a entorno aislado.
- Smoke autenticado de producción y limpieza del usuario QA.
- Cost report con tráfico medido, no estimaciones solamente.
- Runbooks de incidentes, rollback y cambio de proveedor ejercitados.
- Informe de gaps residuales y riesgos aceptados por owner identificado.

## 13. Fuentes primarias

### Argentina

- AAIP, guía de transparencia y protección de datos para IA responsable: <https://www.argentina.gob.ar/aaip/documentos-de-inteligencia-artificial>
- Ley 25.326, texto actualizado: <https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion>
- Obligaciones de responsables de bases de datos: <https://www.argentina.gob.ar/aaip/datospersonales/responsables/obligaciones>
- Ley 26.061, protección integral de niñas, niños y adolescentes: <https://www.argentina.gob.ar/normativa/nacional/ley-26061-110778/actualizacion>
- Ley 26.657, salud mental: <https://www.argentina.gob.ar/normativa/nacional/ley-26657-175977/texto>
- Ley provincial 2302, protección integral de la niñez y adolescencia de Neuquén: <https://boficial.neuquen.gov.ar/LeyesDecretosDetalle?id=211259>

### Gestión de riesgo y seguridad

- NIST AI RMF: <https://www.nist.gov/itl/ai-risk-management-framework>
- NIST AI 600-1, perfil de IA generativa: <https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf>
- UNICEF, Guidance on AI and Children: <https://www.unicef.org/innocenti/reports/policy-guidance-ai-children>
- OWASP Top 10 for LLM Applications 2025: <https://genai.owasp.org/llm-top-10/>

### Plataforma y laboratorio

- Vercel Queues: <https://vercel.com/docs/queues>
- Neon backups/PITR: <https://neon.com/docs/manage/backups>
- TRL Generalized Knowledge Distillation: <https://huggingface.co/docs/trl/gkd_trainer>
- Transformers.js: <https://huggingface.co/docs/transformers.js/index>
- ONNX Runtime Web: <https://onnxruntime.ai/docs/tutorials/web/>
- lm-evaluation-harness: <https://github.com/EleutherAI/lm-evaluation-harness>
- Hugging Face audit logs: <https://huggingface.co/docs/hub/audit-logs>

## 14. Decisión recomendada

Aprobar una propuesta en dos contratos o partidas claramente separadas:

1. **Plataforma + operación**: financiar readiness, piloto y SLO provincial.
2. **Laboratorio**: financiar harness, dataset y `maat-guard`; mantener el LLM generativo propio como I+D por gates.

Esto preserva la ambición de soberanía sin hacer depender el servicio para menores de un modelo todavía no probado. Es la opción de menor complejidad, menor riesgo y mayor evidencia transferible.
