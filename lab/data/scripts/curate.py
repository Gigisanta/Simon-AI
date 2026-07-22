#!/usr/bin/env python3
"""curate.py — curación determinística del dataset generativo (data/README §4).

Pipeline, en orden (cada etapa es pura y testeable salvo la de crisis, que
REÚSA el detector de producción vía exclude-flagged.ts):

  1. filtro de voseo     — descarta muestras con tuteo (reúsa voseo.py)
  2. dedup exacto        — por texto normalizado
  3. near-dup (minhash)  — LSH por bandas + verificación de similitud
  4. exclusión de crisis — subprocess a exclude-flagged.ts (única fuente de verdad)
  5. decontaminación     — descarta muestras que comparten un n-grama 8–13 con
                           CUALQUIER texto del harness de eval (anti-leakage)
  6. dataset card        — conteos por etapa, hash del output, git SHA

Fail-closed en lo que importa: si la etapa de crisis (subprocess) no corre, se
ABORTA (no se emite un dataset "limpio" sin haber filtrado seguridad). El resto
de las etapas, ante una muestra malformada, la descartan y la cuentan.

Uso:
    python3 curate.py --in crudo.jsonl --out limpio.jsonl \\
        --harness-texts harness_texts.txt [--skip-crisis-filter]

Self-check: python3 curate.py --selftest
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "eval"))
import voseo  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]
EXCLUDE_FLAGGED_TS = REPO_ROOT / "lab" / "data" / "scripts" / "exclude-flagged.ts"
SIMON_DIR = REPO_ROOT / "simon"

_WS = re.compile(r"\s+")


def normalize(text: str) -> str:
    return _WS.sub(" ", text.strip().lower())


def extract_text(obj) -> str | None:
    if isinstance(obj, str):
        return obj
    if not isinstance(obj, dict):
        return None
    for k in ("output", "content", "text", "response"):
        v = obj.get(k)
        if isinstance(v, str):
            return v
    msgs = obj.get("messages")
    if isinstance(msgs, list):
        for m in reversed(msgs):
            if isinstance(m, dict) and m.get("role") == "assistant" and isinstance(m.get("content"), str):
                return m["content"]
    return None


# --------------------------- etapa 1: voseo ---------------------------
def filter_voseo(records: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """records = [(raw_line, text)]. Descarta las que tienen tuteo."""
    return [(raw, t) for (raw, t) in records if not voseo.find_tuteo(t)]


# ------------------------- etapa 2: dedup exacto ----------------------
def dedup_exact(records: list[tuple[str, str]]) -> list[tuple[str, str]]:
    seen: set[str] = set()
    out = []
    for raw, t in records:
        key = normalize(t)
        if key in seen:
            continue
        seen.add(key)
        out.append((raw, t))
    return out


# ----------------------- etapa 3: near-dup minhash --------------------
def _shingles(text: str, k: int = 3) -> set[str]:
    words = normalize(text).split()
    if len(words) < k:
        return {" ".join(words)} if words else set()
    return {" ".join(words[i : i + k]) for i in range(len(words) - k + 1)}


def _minhash(shingles: set[str], num_perm: int = 64) -> tuple[int, ...]:
    if not shingles:
        return tuple([0] * num_perm)
    sig = [min(int.from_bytes(hashlib.blake2b(s.encode(), digest_size=8, salt=p.to_bytes(2, "big")).digest(), "big")
               for s in shingles)
           for p in range(num_perm)]
    return tuple(sig)


def dedup_near(records: list[tuple[str, str]], num_perm: int = 128, bands: int = 32, threshold: float = 0.7):
    """LSH por bandas: candidatos por colisión de banda, verificados por
    similitud estimada de firma. Descarta el segundo de cada par similar."""
    rows = int(num_perm / bands)
    sigs = [_minhash(_shingles(t), num_perm) for (_, t) in records]
    buckets: dict[tuple, list[int]] = {}
    dropped: set[int] = set()
    for i, sig in enumerate(sigs):
        if i in dropped:
            continue
        is_dup = False
        for b in range(bands):
            band = (b,) + sig[b * rows : (b + 1) * rows]
            for j in buckets.get(band, []):
                if j in dropped:
                    continue
                sim = sum(1 for a, c in zip(sig, sigs[j]) if a == c) / num_perm
                if sim >= threshold:
                    is_dup = True
                    break
            if is_dup:
                break
        if is_dup:
            dropped.add(i)
            continue
        for b in range(bands):
            band = (b,) + sig[b * rows : (b + 1) * rows]
            buckets.setdefault(band, []).append(i)
    return [rec for i, rec in enumerate(records) if i not in dropped]


# --------------------- etapa 4: exclusión de crisis -------------------
def filter_crisis(records: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """REÚSA exclude-flagged.ts (detector de prod). Aborta si no corre —
    no se emite dataset sin haber filtrado seguridad (fail-closed)."""
    payload = "".join(raw + "\n" for (raw, _) in records)
    try:
        proc = subprocess.run(
            ["npx", "tsx", str(EXCLUDE_FLAGGED_TS)],
            cwd=SIMON_DIR, input=payload, capture_output=True, text=True, timeout=300,
        )
    except (OSError, subprocess.SubprocessError) as e:
        raise RuntimeError(f"exclude-flagged.ts no pudo ejecutarse: {e}") from e
    if proc.returncode != 0:
        raise RuntimeError(f"exclude-flagged.ts falló (exit {proc.returncode}): {proc.stderr[-500:]}")
    kept_lines = {ln for ln in proc.stdout.splitlines() if ln.strip()}
    return [(raw, t) for (raw, t) in records if raw in kept_lines]


# --------------------- etapa 5: decontaminación -----------------------
def build_contam_ngrams(harness_texts: list[str], nmin: int = 8, nmax: int = 13) -> set[str]:
    grams: set[str] = set()
    for txt in harness_texts:
        words = normalize(txt).split()
        for n in range(nmin, nmax + 1):
            for i in range(len(words) - n + 1):
                grams.add(" ".join(words[i : i + n]))
    return grams


def filter_decontam(records, contam: set[str], nmin: int = 8, nmax: int = 13):
    if not contam:
        return records, 0
    out = []
    dropped = 0
    for raw, t in records:
        words = normalize(t).split()
        hit = False
        for n in range(nmin, nmax + 1):
            if hit:
                break
            for i in range(len(words) - n + 1):
                if " ".join(words[i : i + n]) in contam:
                    hit = True
                    break
        if hit:
            dropped += 1
        else:
            out.append((raw, t))
    return out, dropped


# ------------------------------- driver -------------------------------
def load_records(path: str) -> tuple[list[tuple[str, str]], int]:
    records, malformed = [], 0
    with open(path, encoding="utf-8") as f:
        for ln in f:
            s = ln.rstrip("\n")
            if not s.strip():
                continue
            try:
                obj = json.loads(s)
            except json.JSONDecodeError:
                malformed += 1
                continue
            t = extract_text(obj)
            if t is None:
                malformed += 1
                continue
            records.append((s, t))
    return records, malformed


def curate(records, contam, run_crisis=True):
    card = {"input": len(records)}
    records = filter_voseo(records);   card["after_voseo"] = len(records)
    records = dedup_exact(records);    card["after_dedup_exact"] = len(records)
    records = dedup_near(records);     card["after_dedup_near"] = len(records)
    if run_crisis:
        records = filter_crisis(records); card["after_crisis"] = len(records)
    records, dec = filter_decontam(records, contam)
    card["decontam_dropped"] = dec
    card["output"] = len(records)
    return records, card


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Curación determinística del dataset generativo")
    ap.add_argument("--in", dest="inp")
    ap.add_argument("--out")
    ap.add_argument("--harness-texts", help="archivo con un texto del harness por línea (decontaminación)")
    ap.add_argument("--skip-crisis-filter", action="store_true", help="omitir la etapa de crisis (SOLO debug — inseguro para un dataset real)")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)

    if args.selftest:
        _selftest()
        print("curate.py selftest OK")
        return 0

    if not args.inp or not args.out:
        print("ERROR: --in y --out obligatorios (o --selftest)", file=sys.stderr)
        return 1

    records, malformed = load_records(args.inp)
    contam = set()
    if args.harness_texts:
        contam = build_contam_ngrams([l.rstrip("\n") for l in open(args.harness_texts, encoding="utf-8") if l.strip()])

    try:
        records, card = curate(records, contam, run_crisis=not args.skip_crisis_filter)
    except RuntimeError as e:
        print(f"ABORTADO (fail-closed): {e}", file=sys.stderr)
        return 1

    out_lines = [raw for (raw, _) in records]
    Path(args.out).write_text("".join(l + "\n" for l in out_lines), encoding="utf-8")

    card["malformed_input"] = malformed
    card["skip_crisis_filter"] = bool(args.skip_crisis_filter)
    card["output_sha256"] = hashlib.sha256("\n".join(out_lines).encode()).hexdigest()[:16]
    card_path = Path(str(args.out) + ".card.json")
    card_path.write_text(json.dumps(card, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(card, ensure_ascii=False, indent=2))
    return 0


def _selftest() -> None:
    def rec(text):
        raw = json.dumps({"output": text}, ensure_ascii=False)
        return (raw, text)

    base = [
        rec("Dale, contame qué te pasó hoy en la escuela así lo charlamos tranqui."),
        rec("¿Tú quieres que hablemos?"),                       # tuteo -> fuera
        rec("Dale, contame qué te pasó hoy en la escuela así lo charlamos tranqui."),  # dup exacto
        rec("Dale, contame qué te pasó hoy en la escuela así lo charlamos re tranqui."),  # near-dup
        rec("Che, ¿tenés ganas de jugar a algo después de comer?"),
    ]
    # etapas puras (sin crisis subprocess)
    recs, card = curate(list(base), contam=set(), run_crisis=False)
    assert card["after_voseo"] == 4, card         # cae el tuteo
    assert card["after_dedup_exact"] == 3, card   # cae el dup exacto
    assert card["after_dedup_near"] == 2, card    # cae el near-dup
    assert card["output"] == 2, card

    # decontaminación: una muestra que copia un 8-grama del harness se cae.
    harness = ["quiero jugar a matar zombies en un juego de la compu de mi primo"]
    contam = build_contam_ngrams(harness)
    leaky = [rec("quiero jugar a matar zombies en un juego de la compu del vecino"),
             rec("Che, ¿tenés ganas de tomar la leche?")]
    recs2, card2 = curate(leaky, contam=contam, run_crisis=False)
    assert card2["decontam_dropped"] == 1, card2
    assert card2["output"] == 1, card2


if __name__ == "__main__":
    raise SystemExit(main())
