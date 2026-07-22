#!/usr/bin/env python3
"""Runner del harness — produce el scores.json que consume gate.py.

Corre las capas DETERMINÍSTICAS (no necesitan cuenta ni GPU) y arma el
scores.json. Las capas que necesitan endpoint (SpanishBench cap.1, judges de
cap.4/5, conversation cap.7) se agregan cuando haya un endpoint servido; hasta
entonces el gate en perfil `promotion` fail-closea sobre ellas — correcto: no
se promueve nada con evidencia parcial.

Capas que corren hoy:
  - crisis_deterministic (cap.6): reutiliza `pnpm crisis-suite` de simon/
    (el detector determinístico que envuelve al modelo). No se reimplementa.
  - voseo (cap.4 determinística): sobre un JSONL de salidas del modelo.

Uso:
    python3 run.py --profile dryrun -o scores.json                # solo crisis
    python3 run.py --profile dryrun --outputs muestras.jsonl -o scores.json

El JSONL de salidas: una por línea; se toma el texto de 'output' | 'content' |
'text', o el último turno assistant si viene en formato {'messages': [...]}.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

import voseo

REPO_ROOT = Path(__file__).resolve().parents[2]
SIMON_DIR = REPO_ROOT / "simon"


def _git_sha() -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT, capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):
        return "unknown"


def run_crisis_layer() -> dict | None:
    """Corre la crisis-suite de simon/ y devuelve {passed, total}, o None si falla.

    None => el gate fail-closea sobre la capa (no correrla != aprobarla).
    """
    try:
        proc = subprocess.run(
            ["pnpm", "crisis-suite"],
            cwd=SIMON_DIR, capture_output=True, text=True, timeout=180,
        )
    except (OSError, subprocess.SubprocessError) as e:
        print(f"[run] crisis-suite no pudo ejecutarse: {e}", file=sys.stderr)
        return None
    m = re.search(r"Crisis suite:\s*(\d+)\s*/\s*(\d+)", proc.stdout)
    if not m:
        print("[run] no se pudo parsear la salida de crisis-suite", file=sys.stderr)
        print(proc.stdout[-500:], file=sys.stderr)
        return None
    passed, total = int(m.group(1)), int(m.group(2))
    # El propio exit code de la suite es la verdad; si != 0 hubo fallo.
    if proc.returncode != 0 and passed >= total:
        # inconsistencia: la suite falló pero el parseo dice 100% => fail-closed
        print("[run] crisis-suite exit!=0 pese a parseo OK — se descarta", file=sys.stderr)
        return None
    return {"passed": passed, "total": total}


def _extract_output(obj) -> str | None:
    if isinstance(obj, str):
        return obj
    if not isinstance(obj, dict):
        return None
    for key in ("output", "content", "text", "response"):
        v = obj.get(key)
        if isinstance(v, str):
            return v
    msgs = obj.get("messages")
    if isinstance(msgs, list):
        for m in reversed(msgs):
            if isinstance(m, dict) and m.get("role") == "assistant" and isinstance(m.get("content"), str):
                return m["content"]
    return None


def run_voseo_layer(outputs_path: str) -> dict | None:
    texts: list[str] = []
    try:
        with open(outputs_path, encoding="utf-8") as f:
            for ln in f:
                ln = ln.strip()
                if not ln:
                    continue
                try:
                    obj = json.loads(ln)
                except json.JSONDecodeError:
                    continue
                t = _extract_output(obj)
                if t is not None:
                    texts.append(t)
    except OSError as e:
        print(f"[run] no se pudo leer outputs: {e}", file=sys.stderr)
        return None
    if not texts:
        print("[run] outputs sin ninguna salida parseable", file=sys.stderr)
        return None
    scored = voseo.score_batch(texts)
    # El gate sólo mira tuteo_violations y voseo_score; offenders queda para debug.
    return {
        "tuteo_violations": scored["tuteo_violations"],
        "voseo_score": scored["voseo_score"],
        "samples": scored["samples"],
        "offenders": scored["offenders"],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Runner del harness (capas determinísticas)")
    ap.add_argument("--profile", default="dryrun", choices=["dryrun", "promotion"])
    ap.add_argument("--outputs", help="JSONL de salidas del modelo para la capa de voseo")
    ap.add_argument("--model", default="unknown", help="id del checkpoint/modelo evaluado")
    ap.add_argument("-o", "--out", default="scores.json")
    ap.add_argument("--skip-crisis", action="store_true", help="omitir crisis-suite (debug)")
    args = ap.parse_args(argv)

    layers: dict[str, dict] = {}

    if not args.skip_crisis:
        crisis = run_crisis_layer()
        if crisis is not None:
            layers["crisis_deterministic"] = crisis

    if args.outputs:
        vos = run_voseo_layer(args.outputs)
        if vos is not None:
            layers["voseo"] = vos

    scores = {
        "meta": {"model": args.model, "git_sha": _git_sha(), "profile": args.profile},
        "layers": layers,
    }
    Path(args.out).write_text(json.dumps(scores, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[run] escrito {args.out} con capas: {list(layers) or '(ninguna)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
