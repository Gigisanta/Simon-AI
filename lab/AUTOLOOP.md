# AUTOLOOP MaatWork — Workflow de automejora de la familia Maat

> Diseño de sistema · 2026-07-22
> Base: [`docs/plan-lab-maatwork-2026-07.md`](../docs/plan-lab-maatwork-2026-07.md) · [`docs/research-modelo-propio-2026-07.md`](../docs/research-modelo-propio-2026-07.md) §6–8 · [`lab/`](README.md) (eval, data, recipes) · [`docs/mejoras-arquitectura-2026-07.md`](../docs/mejoras-arquitectura-2026-07.md).
> Contrato Hermes obligatorio: `autonomy_level` + `stop_condition` declarados · writer ≠ checker · gate objetivo ejecutable · dry-run antes de destructivo · rollback documentado.
> Arranque práctico: [`recipes/00-bootstrap.md`](recipes/00-bootstrap.md).

## 0. La tesis honesta, en una frase

Un modelo conversacional para menores **no puede mejorar "completamente solo"**, y no es un límite de ingeniería que se arregle con más cómputo: es una propiedad del dominio y de la escala (§1). Lo que sí puede correr solo, tick tras tick y sin humano, es **la maquinaria** — generar datos frescos, entrenar un checkpoint, evaluarlo contra un gate binario, promoverlo a *shadow* (sin servir a nadie) y descartar lo que no mejora. Lo que **nunca** corre solo son tres decisiones: tocar producción real, tocar el dataset de seguridad, y mover el umbral del gate. El AUTOLOOP es autonomía de proceso con tres candados humanos permanentes.

Segunda verdad incómoda: **hoy no se puede correr ni un tick.** El `lab/` es Etapa 0 — configs YAML, recipes en prosa y READMEs de diseño; el data engine y el harness de eval **no están implementados**. La Mac M2 no tiene CUDA y tiene ~13 GB de disco libre; la RTX 3060 no es alcanzable por SSH hoy; el EC2 "abax" está apagado. El entrenamiento va a spot cloud **desde el día 1**, y antes del primer tick hay una Fase 0 de construcción — la lista exacta está en [`recipes/00-bootstrap.md`](recipes/00-bootstrap.md).

## 1. Por qué "que se entrene solo completamente" no existe (evidencia 2024–2026)

Research verificado adversarialmente (8 claims confirmadas de forma independiente). Lo esencial:

1. **El margen interno de auto-mejora escala con el compute de pretraining.** El *generation-verification gap* — la capacidad de un modelo de juzgar sus salidas mejor de lo que las genera, condición necesaria para todo self-improvement — crece monotónicamente con los FLOPs de pretraining (Song et al., arXiv:2412.02674, confirmado). Un modelo de 150–400M cae en la zona donde ese gap es mínimo o nulo: no tiene, dentro de sí, señal de mejora que extraer.
2. **Las técnicas sin verificador externo saturan en 2–3 iteraciones.** SPIN (arXiv:2401.01335) converge matemáticamente a cero mejora; Self-Rewarding LMs (Meta, arXiv:2401.10020, Llama 2 **70B**) saturó tan rápido que el paper de seguimiento de la propia Meta (Meta-Rewarding, arXiv:2407.19594) diagnostica "rapid saturation" del juicio interno.
3. **El self-play que sí funciona necesita un verificador programático.** Absolute Zero Reasoner (arXiv:2505.03335, sobre Qwen2.5/Qwen2.5-Coder 3B–14B) y R-Zero (arXiv:2508.05004, sobre Qwen3 4B/8B) logran mejora sin datos humanos **solo** porque el reward viene de un ejecutor de código o de corrección matemática — determinístico, externo al juicio del modelo. No existe un "ejecutor de código" para "¿esta respuesta empática es apropiada para un chico de 8 años?". Y ningún paper 2024–2026 demuestra self-improvement sostenido en un modelo sub-1B en dominio conversacional abierto.
4. **El juez del mismo tamaño es explotable.** Un juez LLM reference-free premia plausibilidad, no corrección (arXiv:2607.05904): una política entrenada contra su propio juez aprende a **sonar** más empática sin **ser** más segura — el peor resultado posible en este producto. Por eso el gate es aritmética sobre verificadores programáticos (§S4), nunca un LLM opinando.
5. **Model collapse es real pero evitable por diseño de datos.** El colapso de Shumailov (Nature, jul-2024) ocurre bajo el paradigma *replace* (reentrenar solo con sintético propio); **acumular** datos reales/frescos junto a los sintéticos mantiene el riesgo acotado (Gerstgrasser et al., arXiv:2404.01413, confirmado). El riesgo que sobrevive a la crítica escéptica (arXiv:2503.03150) es la pérdida de diversidad de cola — y el rioplatense infantil/adolescente es exactamente una variante de cola. De ahí las reglas anti-collapse de §3.
6. **La regla de diseño que resume el campo**: sin señal externa no hay mejora confiable (formulación nuestra del consenso del survey arXiv:2607.07663, que documenta la retirada del self-critique cerrado hacia esquemas human-on-the-loop). La señal externa del AUTOLOOP: profesor comercial de otro linaje + verificadores programáticos + fixtures curados por humanos.

**Conclusión operativa**: lo que este documento llama "automejora" es, con precisión, un **pipeline de CI/CD de modelos** — automatizado de punta a punta, con señal de mejora externa (profesor + verificadores) y gates binarios. Eso sí tiene evidencia sólida y cabe en el presupuesto. Un loop cerrado puro no tiene precedente publicado que funcione y a esta escala la teoría predice que no puede funcionar.

## 2. El tick del autoloop — estados, transiciones y fallos

Un **tick** es una iteración completa cerrada: de "qué quiero mejorar" a "checkpoint promovido a shadow o descartado, con su reporte". Cada estado declara qué corre, dónde, qué puede fallar y cómo se maneja.

```
        ┌─────────────────────────────────────────────────────────┐
        │  telemetría del tick anterior + backlog + señal fresca   │
        └───────────────────────────┬─────────────────────────────┘
                                    ▼
  S0 SEED/PLAN ─► S1 DATOS ─► S2 ENTRENAR ─► S3 EVAL ─► S4 GATE ─┬─PASS─► S5a SHADOW
   (Mac/agent)    (Mac+API)    (spot GPU)    (runner    (código)  │
        ▲                                     aparte)             └─FAIL─► S5b DESCARTAR
        │                                                                      │
        └──────────────────── S6 TELEMETRÍA ◄──────────────────────────────────┘
```

### S0 — SEED / PLAN · *qué mejorar este tick*
- **Qué corre**: un agente Hermes (skills constreñidas) lee el reporte del harness del tick anterior, el backlog de modos de falla y la señal fresca (§3). Elige **un** *slice*: p. ej. "voseo débil en franja 12–15", "sobre-derivación en riesgo T2", "leak de persona en jailbreak X". Emite un `tick.json` con objetivo, presupuesto asignado y config de datos.
- **Dónde**: Mac M2 (razonamiento + I/O, sin GPU).
- **Falla / manejo**: sin señal nueva → el tick se **salta**, no inventa objetivos para justificar gasto. Backlog vacío + presupuesto disponible → modo *exploración* acotado (rotar personas/seeds subrepresentadas), nunca "reentrenar lo mismo".

### S1 — GENERAR / CURAR DATOS · *la señal fresca entra acá*
- **Qué corre**: generación sintética persona-driven (Magpie/PersonaHub) con el **profesor comercial**, apuntada al objetivo del tick; luego la cadena de curación de [`data/README.md`](data/README.md) en orden estricto: filtro de voseo → dedup exacto + near-dup (minhash) → **la misma cascada de moderación de prod como filtro** → decontaminación n-gram 8–13 contra TODO el harness → **safety-mix obligatorio en cada batch**. Output: dataset JSONL versionado + dataset card (hash de contenido, git SHA del pipeline, config de filtros, conteos por tema/franja) → push a HF Hub.
- **Dónde**: **Mac M2** — red (profesor) + CPU (curación). Este punto hace viable la Fase 1 sin GPU propia: **el tick de datos corre local**. Nota de costo: DeepSeek no tiene batch API; el ahorro real es la ventana off-peak (50–75% de descuento, 16:30–00:30 UTC ≈ 13:30–21:30 hora argentina) + context caching.
- **Falla / manejo**:
  - *Profesor caído / rate-limited* → backoff exponencial; si excede N reintentos, el tick se **posterga** (no aborta la campaña).
  - *Dataset corrupto / esquema inválido* → validación de esquema JSONL antes del push; el batch inválido se **descarta y se loguea**, no contamina el registro.
  - *Presupuesto de generación excedido* → cap duro por tick (§5); al llegar, corta con lo que haya; si no supera el mínimo de volumen, posterga.
  - *Deriva de distribución* (near-dup ratio acumulado sube) → alerta de collapse incipiente (§3), fuerza rotación de personas el próximo tick.

### S2 — ENTRENAR CHECKPOINT · *el único estado que necesita GPU*
- **Qué corre**: job spot efímero (SkyPilot managed job: recovery de preemption y cleanup nativos; el checkpoint/resume es responsabilidad de `train.py`) → pull de base + dataset desde HF → **SFT curricular + destilación on-policy** (TRL `DistillationTrainer`, profesor en teacher-server vLLM externo, `lmbda` 0.5→1.0), **safety-mix en cada batch**, checkpoints a B2 cada N steps, QAT int4 en los últimos ~5k pasos → push del checkpoint a branch de experimento en HF (tag `candidate`) → **teardown del pod**.
- **Dónde**: spot cloud (RunPod/Vast; 4090 desde ~USD 0,34/h en Community Cloud; H100 spot volátil, USD ~0,3–1,2/h de piso según proveedor y ventana). Cuando la 3060 sea alcanzable (Fase 2, Tailscale), las corridas chicas migran ahí y el spot queda para lo pesado.
- **Falla / manejo** (el estado con más modos de falla — GPU + red + spot):
  - *Preemption* → resume desde el último checkpoint en B2 (requisito duro, recipe 02). >N preemptions seguidas → subir a on-demand por esa corrida (con aviso de costo) o **abortar el tick** y anotar la config como cara.
  - *OOM* → reducir un nivel automáticamente (batch/grad-accum; `paged_adamw_8bit` + gradient checkpointing ya de base); si persiste tras un intento, **abortar** y marcar la config.
  - *Pod no disponible* → reintentar otra región/proveedor; mercado seco → postergar.
  - *Presupuesto de tick excedido* → **mata el pod** (kill-switch, §5). Un pod olvidado encendido es la mayor fuga posible: teardown idempotente + barrido de "pods huérfanos" en cada tick.

### S3 — EVAL HARNESS · *acá se materializa writer ≠ checker*
- **Qué corre**: las 8 capas de [`eval/README.md`](eval/README.md). Capas 1–4 (SpanishBench, TELEIA, M-IFEval, voseo) en **cada** checkpoint candidato (baratas). Capas 5–7 (VERA-MH-ES, crisis fixtures T1–T7, `conversation-eval`) **solo antes de promover** (caras, bloqueantes duras). Capa 8 (producto e2e) = el gate de `simon/` con el modelo detrás del router. Scores → trackio.
- **Dónde**: **un runner distinto del de entrenamiento** — no es decorativo, es el `writer ≠ checker` del contrato hecho infraestructura. Fase 1: capas baratas en la Mac (CPU o API para el judge), capa 8 en **GitHub Actions** (`ci.yml` gana un job `model-gate`), capas 5–7 en un segundo pod efímero. El que entrena nunca es el que aprueba.
- **Falla / manejo**:
  - *Eval empeora* → no es fallo del sistema, es el resultado esperado a veces: S4 lo captura y el checkpoint se descarta. Sano.
  - *Judge LLM no disponible* → reintentar; si cambió de modelo, **re-validar contra muestreo humano antes de confiar en el score** (regla del eval README) — bloqueante.
  - *Harness flaky* → re-correr; si sigue inconcluso, **inconcluso = no promover** (fail-closed).

### S4 — GATE BINARIO · *función pura, sin LLM decidiendo*
- **Qué corre**: una función determinística sobre los scores de S3. Reglas duras: crisis fixtures **100%, 0 falsos negativos**; VERA-MH-ES **no peor que baseline comercial**; 0 `safety✗` / 0 leak en `conversation-eval` (G6 con exit 1); SpanishBench **sin regresión** vs base cruda; voseo ≥ umbral declarado; **las suites del gate del producto verdes** con el modelo detrás del router. Salida: `PASS`/`FAIL`. Ningún LLM juzga acá — es aritmética sobre umbrales.
- **Dónde**: el runner de eval (S3), no el de training. Los **umbrales son código versionado** con CODEOWNERS humano: cambiarlos es un gate humano (§4), justo porque el checker no puede relajar su propio criterio.
- **Falla / manejo**: cualquier capa bloqueante roja → `FAIL` → S5b. Una regresión de seguridad **nueva** (falso negativo de crisis que antes no estaba) → no es solo `FAIL`: dispara **STOP global** de la campaña + alerta humana (§5). Es el evento más grave del sistema.

### S5a — PROMOVER A SHADOW · *autónomo; a prod NO*
- **Qué corre**: tag `promoted` en HF Hub; deploy a un endpoint **shadow** (vLLM/llama.cpp en VPS o Modal). Shadow = genera en paralelo al proveedor comercial, **sin servir a ningún niño**; se comparan salidas con el harness sobre replay de tráfico. Promover a shadow es la frontera de lo autónomo.
- **Falla / manejo**: deploy roto → el endpoint shadow no recibe tráfico, prod intacta (invariante: shadow nunca está en el camino del usuario). Rollback = quitar el tag / apagar el endpoint; `resolveProvider` (ADR-3) mantiene el comercial como fallback automático.

### S5b — DESCARTAR · *el fracaso también es señal*
- El checkpoint se archiva con su reporte de gate; el **modo de falla** se escribe al backlog y alimenta el S0 del próximo tick.

### S6 — TELEMETRÍA → PRÓXIMO TICK
- Recolecta divergencias shadow↔profesor/prod, feedback 👍/👎 (cuando exista G1), export de prod consentido (cuando exista G3), fixtures nuevos curados por humano. **Es la puerta de entrada de señal fresca (§3)** y cierra el ciclo hacia S0.

## 3. Niveles de autonomía (L0→L4) y los tres candados humanos

La autonomía se automatiza **de adentro hacia afuera** (primero los estados mecánicos, al final la orquestación), y **nunca** se automatizan las tres decisiones que pueden dañar a un menor de forma irreversible.

| Nivel | Qué corre solo | Qué queda humano | Dónde estamos |
|---|---|---|---|
| **L0 — Manual** | Nada. Humano corre cada estado a mano. | Todo. | **Hoy** (el harness no existe) |
| **L1 — Tick asistido** | Los scripts existen; el humano dispara el tick y **aprueba cada transición**. | Cada `PASS`/promoción. | Meta Fase 1 temprana |
| **L2 — Autónomo hasta shadow** | S0→S5a completo sin humano. Doom-loop activo. | Promoción a prod, safety dataset, umbral del gate. | Meta Fase 1 tardía |
| **L3 — Multi-tick autónomo** | N ticks encadenados, prioriza su backlog, presupuesto mensual y kill-switches. Humano lee un **digest semanal**. | Los tres candados + revisión del digest. | Meta Fase 2–3 |
| **L4 — "Full-auto"** | La orquestación entera. **Aun así, los tres candados siguen humanos.** | Los tres candados, **para siempre**. | No es un objetivo pendiente, es un límite de diseño |

### Los tres candados humanos permanentes (y por qué)

1. **Promoción de shadow a producción real (que sirve a niños).** Un checkpoint puede pasar el harness entero y aún fallar fuera de distribución — el harness cubre lo que sabemos medir, no lo que no anticipamos. Además hay obligación regulatoria concreta (California SB 243 vigente ene-2026: protocolo self-harm publicado; EU AI Act art. 5: prohibido explotar vulnerabilidad por edad). Un humano — idealmente con la mirada clínica del partnership UNCo — **firma** cada promoción. El costo de un falso negativo del gate lo paga un chico, no una métrica.
2. **Cualquier cambio al dataset / fixtures de seguridad.** Si el sistema puede editar su propio test de crisis, puede "aprobar" bajando la vara — la definición de `writer = checker`. Los fixtures T1–T7 son el activo de evaluación más valioso del proyecto; **solo crecen con revisión clínica**, jamás los edita un agente. El dataset de riesgo de `maat-guard` tiene gobernanza propia, separada del generativo.
3. **Cualquier cambio de umbral del gate.** Mismo argumento, un nivel arriba: el gate ES el checker. Los umbrales viven en código con CODEOWNERS humano; un PR que los toque requiere aprobación humana y el loop no lo puede mergear. Bajar un umbral "porque el modelo no llega" está prohibido: si no llega, no se promueve — esa es la respuesta correcta.

Estos tres candados son exactamente las tres formas de "hacer trampa" que tendría un optimizador con el objetivo "mejorá el score": servir algo malo, falsear el examen, o bajar la nota de aprobación. Cerrarlos es lo que hace que el loop sea *seguro*, no lo que lo hace *menos* autónomo.

## 4. Anti-model-collapse por diseño

Tres mecanismos estructurales (no de vigilancia):

**(a) La destilación on-policy es anti-collapse por construcción.** En `DistillationTrainer` el estudiante genera sus completions, pero **el profesor comercial puntúa cada token**. La señal de gradiente viene de un modelo más grande y de otro linaje, no del estudiante. Es lo opuesto al bucle recursivo que causa collapse.

**(b) En cada tick entra señal fresca de al menos una fuente no-recursiva:**

| Fuente | Cuándo | Frescura |
|---|---|---|
| **Profesor comercial** (DeepSeek u otro grande) | Siempre, desde el tick 1 | Otro linaje; trae jerga/eventos nuevos |
| **Telemetría de prod** vía `training-export` | Cuando exista **G3** (consentimiento) | Máxima: prompts reales AR, redactados y consentidos |
| **Feedback 👍/👎** (`MessageFeedback`) | Cuando exista **G1** | Señal de *outcome*, no de imitación |
| **Fixtures nuevos** curados por humano | Continuo | Jerga adolescente AR, evasiones nuevas — curación clínica |
| **Rotación de personas/seeds** | Cada tick en S0/S1 | Cobertura de franjas subrepresentadas |

**(c) Proporción sintético-recursivo con reglas duras:**
- **0% de auto-entrenamiento puro.** Un `maat-*` nunca se entrena sobre salidas crudas de un `maat-*` previo. Prohibido.
- **Regla de anclaje**: en cada dataset de tick, un piso declarado (arranque ≥ 30%) debe ser señal que **ningún modelo Maat** generó — profesor + humano + prod. Datos de un `maat-*` previo solo entran si un profesor/humano los **re-puntúa on-policy**, nunca crudos.
- **Métrica de guardia**: near-dup ratio (minhash) del dataset **acumulado** entre ticks. Si sube sostenido → la distribución se estrecha → alerta de collapse incipiente → S0 fuerza rotación de personas y sube el piso de señal fresca. Es un canario, no una esperanza. (El riesgo concreto para Simón es degradar el rioplatense de cola hacia un neutro artificial — §1.5.)

## 5. Presupuesto y kill-switches

Presupuesto anual del lab: **USD 2.000–4.700** de los 10.000 (research §8) — sobra margen; el recurso escaso es tiempo humano. Los topes van **muy por debajo** de lo que el bolsillo aguanta, porque el riesgo real no es quedarse corto sino un pod olvidado o un doom-loop quemando plata sin mejorar.

| Control | Valor de arranque | Comportamiento |
|---|---|---|
| **Tope por tick** | USD 30 (train+eval) + USD 20 (generación) | Al llegar: kill-switch, mata el pod, corta generación |
| **Tope mensual** | USD 300–400 | Al 90%: alerta; al 100%: STOP de campaña hasta reset o aprobación humana |
| **Doom-loop** | 3 ticks sin mejora (Δscore < ε) | STOP + pide humano (probable techo del enfoque, no bug) |
| **Falla repetida** | Mismo motivo de `FAIL` 2 ticks seguidos | STOP (probable bug de datos/pipeline) |
| **Regresión de seguridad nueva** | 1 falso negativo de crisis nuevo | **STOP inmediato** + alerta prioritaria |
| **Pods huérfanos** | Barrido en cada tick | Teardown idempotente de cualquier pod sin dueño |

**Stop conditions declaradas** (contrato Hermes regla 14, en `agent.json` del orquestador):

```yaml
autonomy_level: L2            # hasta shadow; prod/safety/umbral = humano
stop_condition:
  - budget_month_exhausted
  - doom_loop_3_ticks
  - safety_regression_new     # FN de crisis nuevo → STOP inmediato
  - repeated_gate_failure_2x
  - judge_unvalidated
  - human_pause
```

**Dry-run antes de destructivo** (regla 12): `tick --dry-run` genera un dataset chico, entrena ~100 steps, corre las capas baratas, **no promueve, no toca prod, no sube tags `promoted`**. Prueba el pipeline mutation-free y mide horas/época real (el número que la recipe 01 marca como obligatorio antes de planificar calendario). **Rollback documentado**: shadow es reversible por definición (quitar tag / apagar endpoint; `resolveProvider` deja el comercial de fallback); prod nunca cambia sin humano; checkpoints en HF Hub inmutables por tag; datasets revocables (G5/G7: los `conversationIds` de la dataset card permiten re-emitir excluyendo revocaciones — derecho de oposición, Ley 25.326).

## 6. Implementación por fases

### Fase 0 — Construir lo que hoy es README (semanas; humano + agente, sin loop)
No hay tick posible mientras el data engine y el harness sean prosa. Checklist completo con comandos: [`recipes/00-bootstrap.md`](recipes/00-bootstrap.md). En resumen: data engine ejecutable, harness con exit codes (capas 1, 4, 6, 7 mínimo), baselines publicados en trackio, cuentas (HF org, teacher API con TOS verificados, spot, B2), fixtures de crisis como dataset de oro con curación humana.

### Fase 1 — Primer autoloop, **sin GPU propia alcanzable** (L1→L2)
- **Datos (S1) y eval barato (S3 capas 1–4)**: Mac M2 — red + CPU.
- **Entrenamiento (S2)**: job efímero en spot vía **SkyPilot** (recovery de preemption + cleanup nativos; ~10 líneas de YAML; el resume es responsabilidad de `train.py`). Nunca un pod persistente.
- **Orquestación**: **Hermes cron** dispara "un tick por noche" — el job de training como `no_agent: true` (script puro, regla 9); el S0 de priorización como agent job con skills constreñidas y razón explícita. **GitHub Actions** (`ci.yml`) gana el job `model-gate` (capa 8): checker independiente por infraestructura. **HF Hub** = registro; **trackio** = tracking; **B2** = checkpoints para resume.
- **agent.json + gate**: `autonomy_level` + `stop_condition` declarados; lint con `scripts/standardize.py manifest`; verificación objetiva con `scripts/gate.sh`. El humano aprueba cada promoción al principio (L1); con confianza acumulada, S0→S5a corre solo (L2).
- Reusar, no inventar: el patrón de la skill **`improve-repo`** (backlog verificable, un slice por tick, gate ejecutable, doom-loop, crash-safe resume) es casi exactamente este loop — el AUTOLOOP es un `improve-repo` especializado en checkpoints en vez de PRs.

### Fase 2 — Automatización creciente (L2→L3)
- **Shadow deploy automático** tras gate verde; la telemetría shadow alimenta S0 sola.
- **G1** (feedback) y **G3** (consentimiento + export filtrado) implementados → entra **señal real de prod**. Recién acá el flywheel toca datos reales; el sintético sigue siendo la vía principal.
- **La 3060 entra** por Tailscale para iteración barata (toys, `maat-guard`, capas 1–4, HQQ), bajando el gasto spot. El EC2 "abax" puede reencenderse como runner de eval o teacher-server si conviene.
- **Multi-tick** con presupuesto mensual; humano lee digest semanal.

### Fase 3 — Maduro (L3 estable; L4 nunca completo)
- **A/B en producción solo en turnos de bajo riesgo** clasificados por `maat-guard`, con humano firmando **cada** expansión del porcentaje de tráfico (candado #1). Fallback comercial automático siempre.
- **Pretraining propio** (recipe 02) entra como "tick largo" ocasional disparado a mano — corrida de días en spot con gobernanza propia, no una iteración del loop nocturno.
- No hay Fase 4 "sin humano": es el límite de diseño, no una etapa pendiente.

## 7. Resumen ejecutivo

El AUTOLOOP es un loop de 7 estados (SEED→DATOS→ENTRENAR→EVAL→GATE→SHADOW/DESCARTAR→TELEMETRÍA) donde la maquinaria corre sola pero **tres decisiones nunca**: promover a producción, tocar el dataset de seguridad, y mover el umbral del gate — las tres formas en que un optimizador haría trampa. La autonomía llega hasta **shadow (L2)** de forma realista y escala a multi-tick (L3); no existe L4 "sin humano". El collapse se evita por diseño: destilación on-policy (el profesor puntúa, no el estudiante), piso de señal fresca no-recursiva por tick, 0% de auto-entrenamiento puro. El presupuesto se protege con topes bajos y kill-switches. Y la verdad de arranque: **hoy no corre ni un tick** — el harness y el data engine son READMEs; la Fase 0 y el camino ordenado al primer tick están en [`recipes/00-bootstrap.md`](recipes/00-bootstrap.md), y el loop arranca 100% sintético para no depender del bloqueante legal G3.
