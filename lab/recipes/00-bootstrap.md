# Recipe 00 — Bootstrap: qué falta HOY para el primer tick

> Estado relevado 2026-07-22 en la Mac M2. Objetivo: dejar todo listo para correr **un tick manual completo (L0→L1)** del [`AUTOLOOP`](../AUTOLOOP.md). Orden = orden de dependencia. Los ítems 1–4 son cuentas/accesos (horas); 5–8 son construcción (el grueso); 9–10 cierran el loop.
> Regla de arranque: el primer tick es **100% sintético** — G3 (consentimiento) habilita la Fase 2, no bloquea el arranque.

## Inventario real (por qué esta lista y no otra)

| Recurso | Estado 2026-07-22 | Implicación |
|---|---|---|
| Mac M2 | Sin CUDA, ~13 GB libres en disco | Solo S0/S1/S3-barato; **nada de training local**; cuidar disco (datasets a HF, no acumular local) |
| RTX 3060 | No alcanzable por SSH | Fase 2 (Tailscale); no contar con ella para el tick 1 |
| EC2 "abax" | Apagado / inaccesible (IAM `mac` sin `ec2:Describe*`) | Fuera del plan de arranque |
| `hf` CLI local | Rota (ImportError en `huggingface_hub`) | Ítem 2: reinstalar limpia con `uv` |
| Token HF | No existe | Ítem 1 |
| Cuentas spot (RunPod/Vast) | No existen | Ítem 3 |
| Teacher APIs | `OPENCODE_GO_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY` en `~/.hermes/.env` | **Ya disponible** — verificar TOS (ítem 4) |
| `gh` | Autenticado | Actions listo para el job `model-gate` |

## Checklist ordenado

### 1. Registro de modelos/datasets — HF org (≈30 min)
- [ ] Crear org privada `maatwork-lab` en huggingface.co + plan PRO (USD 9/mes).
- [ ] Token con scope write, guardado en `~/.hermes/.env` como `HF_TOKEN` (nunca en el repo).

### 2. Arreglar el tooling local (≈15 min)
```sh
uv tool install "huggingface_hub[cli]"   # reemplaza la instalación rota
hf auth login --token "$HF_TOKEN"
hf auth whoami                            # verificación: debe responder maatwork-lab
uv tool install "skypilot[runpod]"        # orquestador spot (recovery+cleanup nativos)
```

### 3. Cómputo spot + storage de checkpoints (≈1 h)
- [ ] Cuenta RunPod (y/o Vast) con crédito inicial chico (USD 25–50). API key → `~/.hermes/.env` (`RUNPOD_API_KEY`).
- [ ] `sky check` debe mostrar el proveedor habilitado.
- [ ] Bucket Backblaze B2 `maatwork-lab-checkpoints` + application key → `~/.hermes/.env`. Es el resume ante preemption (requisito duro, recipe 02).
- [ ] Script `lab/scripts/pod-sweep.sh`: lista y apaga pods huérfanos (teardown idempotente). Correrlo manual primero; después va en cada tick.

### 4. Teacher API con TOS verificados — ✅ RESUELTO (verificado 2026-07-22, fuente primaria)

**Profesor recomendado: DeepSeek** (directo) o **OpenRouter con filtro distilable**. NO OpenAI.

- **DeepSeek** — [TOS de la API](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html), §4.2(3): *"You may apply the Inputs and Outputs of the Services to a wide range of use cases, including ... training other models (such as model distillation)"*, y §4.2(2) te asigna la propiedad de los outputs. **Cero cláusula anti-distillation.** Vía preferida. (Sin batch API; off-peak 50–75% en 16:30–00:30 UTC ≈ 13:30–21:30 AR + context caching.)
- **OpenRouter** — la `OPENROUTER_API_KEY` ya está en `~/.hermes/.env`. Compliant sólo con el filtro: `enforce_distillable_text: true` en el body (o `?distillable=true` en la web). Un modelo DeepSeek ahí es distilable.
- **OpenAI** — sus TOS **prohíben** usar outputs para entrenar modelos competidores. **NO usar `OPENAI_API_KEY` para generar datos de entrenamiento.**
- **Caveat del gateway**: el gateway OpenCode Go (el que usa producción) tiene términos propios y **no hereda** automáticamente la cláusula permisiva de DeepSeek. Para ampararse en ella, pegarle a DeepSeek directo o a OpenRouter-distilable, **no** al gateway.

- [ ] Acción restante: anotar el profesor y modelo exactos del tick 1 en el run log de la recipe 01 al generar el primer batch.

### 5. Data engine ejecutable — mitad de curación ✅ HECHA (`lab/data/scripts/`)
- [ ] `generate.py`: generación sintética persona-driven (Magpie/PersonaHub) contra el profesor, con cap de gasto por corrida. **Pendiente** (necesita endpoint distilable — ver ítem 4).
- [x] `curate.py`: voseo → dedup exacto + minhash (LSH) → **exclusión de crisis** (reúsa `detectSafetyFlag` de prod vía `exclude-flagged.ts`) → decontaminación n-gram 8–13 contra el harness → dataset card. Fail-closed: sin etapa de crisis, aborta. Self-check verde.
- [x] Salida: JSONL + dataset card (hash sha256, git SHA, conteos por etapa). Push a HF Hub pendiente del token (ítem 1).
- [~] Validación: `curate.py` descarta y cuenta líneas malformadas; safety-mix por batch queda para `generate.py`.

### 6. Eval harness ejecutable — spine determinístico ✅ HECHO (`lab/eval/`, **el gate ya existe**)
- [ ] Capa 1: `lm-eval-harness` con SpanishBench contra endpoint OpenAI-compatible. **Pendiente** (necesita endpoint).
- [x] Capa 4 (determinística): `voseo.py` — detección de tuteo, alta precisión, self-check verde. (El LLM-judge de naturalidad queda pendiente del endpoint.)
- [x] Capa 6: crisis fixtures ejecutables — `run.py` reúsa `pnpm crisis-suite` (72/72). 100% o el gate rechaza.
- [ ] Capa 7: `conversation-eval` con exit codes (gap G6). **Pendiente** (necesita endpoint + G6).
- [x] Gate S4 como función pura fail-closed (`gate.py`) — sin LLM decidiendo; umbrales en `thresholds.json` protegido por **CODEOWNERS** (candado #3). Job `model-gate` en CI. Self-check cubre cada modo de falla.

### 7. Baselines publicados (1 día de corridas; sin baseline, "mejora" no significa nada)
- [ ] Correr el harness contra: DeepSeek (proveedor actual) + Qwen3-0.6B, SmolLM2-360M y Granite 4.0 Nano 350M crudos (vía endpoint temporal en spot o API).
- [ ] Publicar scores en trackio; ese es el punto de comparación de todo checkpoint futuro.

### 8. Fixtures de crisis como dataset de oro (curación humana — candado #2)
- [ ] Versionar los fixtures T1–T7 como dataset inmutable en HF (solo crece con revisión clínica; jamás lo edita un agente).
- [ ] Ampliar con jerga adolescente AR y evasiones nuevas — revisión humana/clínica previa (partnership UNCo cuando exista).

### 9. Juez LLM decidido y validado
- [ ] Elegir juez de **familia distinta** al profesor y al estudiante (regla anti-sesgo circular).
- [ ] Validarlo contra un muestreo humano rioplatense antes de confiar en su score para promover (regla del eval README). Juez sin validar = `judge_unvalidated` = stop condition.

### 10. Orquestador del tick (cierra el loop L0→L1)
- [x] `tick.sh --dry-run` (`lab/tick.sh`): encadena S1 generación fake (offline) → curación → S3 eval → S4 gate, fail-closed. **No entrena** (S2 es stub hasta tener GPU), no promueve, no sube tags, no toca prod. Verde end-to-end sin cuentas.
- [x] `agent.json` (`lab/agent.json`): `autonomy_level: L1` + `stop_condition` + `loop_contract`. **Pasa el lint** `standardize.py manifest` (verificado con `lint_manifest`).
- [~] Kill-switches: cap de gasto por tick ya en `generate.py` (`--budget-usd`, techo duro) y en `agent.json` (`max_cost_usd`, `max_consecutive_failures: 2`). Barrido de pods huérfanos (`pod-sweep.sh`) y doom-loop quedan para el tick real con GPU.
- [x] Runner de eval separado del de training: job `model-gate` en `ci.yml` + tick S2/S3 en procesos distintos — writer ≠ checker por infraestructura desde el dry-run.

## Definición de "listo para el tick 1"

Todo lo anterior tildado **y** un `tick.sh --dry-run` completo en verde: dataset chico generado y curado con card, ~100 steps entrenados en spot con resume probado (matar el pod a mano a mitad de corrida y verificar que reanuda desde B2), capas baratas del harness corridas con exit 0, teardown verificado, costo real del dry-run anotado en el run log. Recién ahí se corre el primer tick real (L1: humano aprueba cada transición).
