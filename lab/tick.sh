#!/usr/bin/env bash
# tick.sh — orquestador de UN tick del AUTOLOOP (lab/AUTOLOOP.md).
#
# HOY sólo implementa --dry-run: ejercita el spine determinístico de punta a
# punta SIN cuentas, SIN GPU, SIN gasto y SIN tocar producción:
#
#   S1 DATOS    generate.py --dry-run (profesor fake)  ->  curate.py
#   S2 ENTRENAR [STUB]  (necesita GPU spot — ver recipe 02)
#   S3 EVAL     run.py (crisis reusada + voseo)  ->  scores.json
#   S4 GATE     gate.py --profile dryrun  (fail-closed; decide con exit code)
#
# El tick REAL (entrenar en spot, promover a shadow, tags de HF) se habilita
# cuando existan las cuentas y el checkpoint — este script NUNCA promueve, NUNCA
# sube tags, NUNCA sirve a un chico. Los tres candados humanos siguen intactos.
#
# Fail-closed: cualquier etapa que falle aborta el tick (set -euo pipefail).
set -euo pipefail

MODE="${1:-}"
if [[ "$MODE" != "--dry-run" ]]; then
  echo "Uso: tick.sh --dry-run" >&2
  echo "  (el tick real necesita cuentas + GPU; ver lab/recipes/00-bootstrap.md)" >&2
  exit 2
fi

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$LAB_DIR/runs/dryrun"
mkdir -p "$RUN_DIR"
RAW="$RUN_DIR/crudo.jsonl"
CLEAN="$RUN_DIR/limpio.jsonl"
SCORES="$RUN_DIR/scores.json"
HARNESS_TXT="$RUN_DIR/harness_texts.txt"

echo "== TICK --dry-run =="
echo "run dir: $RUN_DIR"

# --- S1 DATOS: generación (fake, offline) + curación (determinística) ---
echo "[S1] generación fake (sin red, sin gasto)"
python3 "$LAB_DIR/data/scripts/generate.py" --dry-run --n 12 --turns 4 \
  --budget-usd 0.01 --seed 7 --out "$RAW" >/dev/null

# Textos del harness para la decontaminación (los negativos-trampa de crisis
# sirven de fuente mínima; el harness real es más amplio).
grep -oE '"[^"]{20,}"' "$LAB_DIR/../simon/scripts/crisis-suite.ts" 2>/dev/null \
  | tr -d '"' | head -60 > "$HARNESS_TXT" || true

echo "[S1] curación determinística (voseo/dedup/near-dup/crisis/decontam)"
python3 "$LAB_DIR/data/scripts/curate.py" --in "$RAW" --out "$CLEAN" \
  --harness-texts "$HARNESS_TXT"

# --- S2 ENTRENAR: STUB (necesita GPU spot) ---
# ponytail: en dry-run no se entrena; el tick real invoca SkyPilot (recipe 02)
# con checkpoint/resume desde B2. Acá sólo se declara la frontera.
echo "[S2] ENTRENAR [STUB] — el tick real lanza SkyPilot spot; dry-run lo omite"

# --- S3 EVAL: harness determinístico sobre el dataset curado ---
echo "[S3] eval (crisis reusada + voseo) -> scores.json"
python3 "$LAB_DIR/eval/run.py" --profile dryrun --outputs "$CLEAN" \
  --model "dry-run-tick" -o "$SCORES" >/dev/null

# --- S4 GATE: función pura fail-closed decide con exit code ---
echo "[S4] gate (perfil dryrun, fail-closed)"
if python3 "$LAB_DIR/eval/gate.py" --scores "$SCORES" \
     --thresholds "$LAB_DIR/eval/thresholds.json" --profile dryrun; then
  echo "== TICK --dry-run OK (gate PASS). NO se promovió nada (es un dry-run). =="
  exit 0
else
  echo "== TICK --dry-run: gate RECHAZÓ el candidato (esperado si el dataset no chequea). ==" >&2
  exit 1
fi
