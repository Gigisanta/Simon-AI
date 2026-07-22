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

### 4. Teacher API con TOS verificados (≈30 min, decisión)
- [ ] Verificar términos de uso del profesor elegido respecto de **generar datos de entrenamiento** (no asumir): DeepSeek directo (sin batch API; off-peak 50–75% en 16:30–00:30 UTC ≈ 13:30–21:30 AR + context caching) vs. OpenRouter (elegir modelo con licencia de salida permisiva).
- [ ] Decidir y anotar el profesor del tick 1 en el run log de la recipe 01.

### 5. Data engine ejecutable (días — hoy es README)
Implementar [`data/README.md`](../data/README.md) como scripts en `lab/scripts/`:
- [ ] `generate.py`: generación sintética persona-driven (Magpie/PersonaHub) contra el profesor, con cap de gasto por corrida.
- [ ] `curate.py`: filtro voseo → dedup exacto + minhash → cascada de moderación de prod como filtro → decontaminación n-gram 8–13 contra TODO el harness → safety-mix por batch.
- [ ] Salida: JSONL versionado + dataset card (hash, git SHA del pipeline, config de filtros, conteos por tema/franja) + push a HF Hub.
- [ ] Validación de esquema JSONL antes del push (batch inválido se descarta y loguea).

### 6. Eval harness ejecutable (días — hoy es README; **sin esto no hay gate**)
Implementar como mínimo las capas 1, 4, 6 y 7 de [`eval/README.md`](../eval/README.md), todas con **exit codes**:
- [ ] Capa 1: `lm-eval-harness` con SpanishBench instalado y corriendo contra un endpoint OpenAI-compatible.
- [ ] Capa 4: rúbrica de voseo (regex + LLM-judge).
- [ ] Capa 6: crisis fixtures T1–T7 ejecutables desde los fixtures de `simon/` (100% o exit 1).
- [ ] Capa 7: `conversation-eval` con umbrales duros y exit 1 (gap G6 de `docs/mejoras-arquitectura-2026-07.md`).
- [ ] Gate S4 como función pura sobre los scores (sin LLM decidiendo) — los umbrales en un archivo versionado con CODEOWNERS humano.

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
- [ ] `tick.sh` idempotente con `--dry-run` (dataset chico + ~100 steps + capas baratas; no promueve, no toca prod, no sube tags).
- [ ] `agent.json` con `autonomy_level: L1` + `stop_condition` (ver AUTOLOOP §5); lint: `scripts/standardize.py manifest`.
- [ ] Kill-switches: tope por tick (USD 30 train+eval / USD 20 generación), barrido de pods huérfanos, detector de doom-loop.
- [ ] Runner de eval separado del de training: job `model-gate` en `ci.yml` (capa 8) + Mac/pod aparte para el resto — writer ≠ checker por infraestructura desde el tick 1.

## Definición de "listo para el tick 1"

Todo lo anterior tildado **y** un `tick.sh --dry-run` completo en verde: dataset chico generado y curado con card, ~100 steps entrenados en spot con resume probado (matar el pod a mano a mitad de corrida y verificar que reanuda desde B2), capas baratas del harness corridas con exit 0, teardown verificado, costo real del dry-run anotado en el run log. Recién ahí se corre el primer tick real (L1: humano aprueba cada transición).
