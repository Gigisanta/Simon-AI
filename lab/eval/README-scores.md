# Contrato de `scores.json` (harness → gate)

El runner ([`run.py`](run.py)) produce este objeto; el gate ([`gate.py`](gate.py))
lo consume. Contrato estable: agregar capas es aditivo, renombrar una capa es
un cambio que toca `thresholds.json` (CODEOWNERS).

```json
{
  "meta": { "model": "maat-micro-tickNN", "git_sha": "abc1234", "profile": "dryrun" },
  "layers": {
    "crisis_deterministic": { "passed": 72, "total": 72 },
    "voseo":                 { "tuteo_violations": 0, "voseo_score": 0.93, "samples": 200, "offenders": [] },
    "conversation":          { "safety_violations": 0, "leaks": 0, "warmth": 4.1 },
    "vera_mh_es":            { "safety_score": 0.88 },
    "spanish_bench":         { "belebele_spa_Latn": 0.61, "xnli_es": 0.44, "xquad_es": 0.55 }
  }
}
```

## Regla fail-closed

El gate evalúa **sólo las capas requeridas en el perfil** (`dryrun` | `promotion`,
declarado en [`thresholds.json`](thresholds.json) por capa en `required_in`).
Una capa requerida que **falte** en `layers` hace **fallar** el gate — no correr
la eval nunca cuenta como aprobar. Un valor malformado (no numérico, `total<=0`)
también falla. La única forma de exit 0 es que todo lo requerido chequee.

## Qué capa produce qué (estado)

| Capa | Campos | Quién la llena hoy |
|---|---|---|
| `crisis_deterministic` | `passed`, `total` | `run.py` → `pnpm crisis-suite` (corre, sin cuenta) |
| `voseo` | `tuteo_violations`, `voseo_score` | `run.py` → `voseo.py` sobre un JSONL de salidas (corre, sin cuenta) |
| `conversation` | `safety_violations`, `leaks`, `warmth` | pendiente: `conversation-eval.ts` con exit codes (gap G6) |
| `vera_mh_es` | `safety_score` | pendiente: adaptación VERA-MH-ES (necesita endpoint + judge) |
| `spanish_bench` | métricas por sub-tarea | pendiente: `lm-eval-harness` contra endpoint OpenAI-compatible |

Las pendientes necesitan un endpoint servido (baseline DeepSeek o un checkpoint
maat-* detrás de llama.cpp/vLLM). Hasta entonces sólo el perfil `dryrun` (crisis
+ voseo) puede dar verde; `promotion` fail-closea a propósito.

## Baseline

Los checks de no-regresión (`vera_mh_es`, `spanish_bench`) comparan contra un
segundo `scores.json` pasado con `--baseline`. Se genera corriendo el harness
contra el modelo de referencia (DeepSeek actual) y se versiona como
`baseline-<modelo>.json`.
