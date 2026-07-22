#!/usr/bin/env python3
"""Capa 4 (parte determinística) — detección de tuteo en salidas del modelo.

Rioplatense usa voseo (tenés/querés/podés/sos/vení), nunca tuteo
(tienes/quieres/puedes/eres/ven). El LLM-judge evalúa naturalidad y registro
etario; esta capa hace lo que la regex SÍ puede hacer con alta precisión:
detectar tuteo inequívoco. Un solo marcador de tuteo debe hundir el checkpoint.

Precisión > recall a propósito: un falso positivo hundiría un checkpoint bueno,
así que sólo se marcan formas que en rioplatense correcto NUNCA aparecen. Las
sutilezas (naturalidad, muletillas, registro) las juzga el LLM-judge, no esto.

Uso como librería:
    from voseo import score_batch
    score_batch(["dale, contame qué te pasó", ...]) -> dict con voseo_score, tuteo_violations

Self-check: `python3 voseo.py --selftest`
"""
from __future__ import annotations

import re
import sys
import unicodedata

# Formas verbales de 2ª persona singular (presente/imperativo) que difieren
# entre tuteo y voseo. Sólo tuteo — el voseo correspondiente jamás matchea acá.
# (tienes/tenés, quieres/querés, puedes/podés, etc.)
_TUTEO_VERBS = [
    "tienes", "quieres", "puedes", "debes", "sabes", "haces", "dices",
    "vienes", "pones", "sales", "comes", "vives", "sientes", "piensas",
    "prefieres", "entiendes", "conoces", "recuerdas", "necesitas",
    "eres", "estas",  # estás sin acento igual es tuteo si aparece como "estas" tú-form; se filtra abajo
]
# Pronombres/clíticos inequívocos de tuteo. "tú" SIEMPRE lleva acento (el "tu"
# sin acento es posesivo y es válido en rioplatense: "tu casa"). Por eso se
# exige el acento en el pronombre.
_TUTEO_PRONOUNS = ["tú", "ti", "contigo", "tuyo", "tuya", "tuyos", "tuyas"]
# Imperativos tú vs vos (mira/mirá, escucha/escuchá, come/comé, dime/decime).
_TUTEO_IMPERATIVES = ["dime", "dile", "cuéntame", "cuentame", "escúchame", "escuchame", "mírame", "mirame"]

# "estas" es ambiguo (demostrativo "estas cosas"): sólo cuenta como tuteo con
# acento "estás"... pero "estás" también es voseo válido. Se saca de la lista.
_TUTEO_VERBS = [v for v in _TUTEO_VERBS if v != "estas"]

_ALL_TUTEO = _TUTEO_VERBS + _TUTEO_PRONOUNS + _TUTEO_IMPERATIVES
# Word-boundary, case-insensitive; se mantiene el acento donde importa (tú, ti no).
_TUTEO_RE = re.compile(r"(?<!\w)(" + "|".join(re.escape(w) for w in _ALL_TUTEO) + r")(?!\w)", re.IGNORECASE)

# Marcadores POSITIVOS de voseo — presencia sube el voseo_score (proxy de
# naturalidad regional; NO es el juicio final, ese es del LLM-judge).
# Sólo formas inequívocamente rioplatenses (voseo/regional). Se excluyen las
# ambiguas con el tuteo o el español neutro (p.ej. "mira" es tuteo, no voseo).
_VOSEO_MARKERS = [
    "vos", "tenés", "tenes", "querés", "queres", "podés", "podes", "sos",
    "vení", "mirá", "contame", "decime", "fijate", "dale",
    "che", "escuchá", "acá", "posta",
]
_VOSEO_RE = re.compile(r"(?<!\w)(" + "|".join(re.escape(w) for w in _VOSEO_MARKERS) + r")(?!\w)", re.IGNORECASE)


def find_tuteo(text: str) -> list[str]:
    """Devuelve los marcadores de tuteo hallados (para logging/offenders)."""
    if not isinstance(text, str):
        return []
    return [m.group(0).lower() for m in _TUTEO_RE.finditer(text)]


def find_voseo(text: str) -> list[str]:
    if not isinstance(text, str):
        return []
    return [m.group(0).lower().strip() for m in _VOSEO_RE.finditer(text)]


def score_batch(texts: list[str]) -> dict:
    """Puntúa una muestra de salidas del modelo.

    voseo_score = fracción de muestras con >=1 marca de voseo Y 0 tuteo.
    Es un proxy conservador: penaliza tuteo y premia presencia de voseo, pero
    no pretende medir naturalidad fina (eso lo hace el judge en la capa 4-judge).
    """
    if not isinstance(texts, list) or not texts:
        # Fail-closed: sin muestra no hay evidencia => score 0, no crashea el gate.
        return {"samples": 0, "tuteo_violations": 0, "voseo_score": 0.0, "offenders": []}

    tuteo_total = 0
    clean_voseo = 0
    offenders: list[dict] = []
    for i, t in enumerate(texts):
        tut = find_tuteo(t)
        vos = find_voseo(t)
        if tut:
            tuteo_total += len(tut)
            offenders.append({"i": i, "tuteo": tut, "text": (t or "")[:120]})
        elif vos:
            clean_voseo += 1
    n = len(texts)
    return {
        "samples": n,
        "tuteo_violations": tuteo_total,
        "voseo_score": round(clean_voseo / n, 4),
        "offenders": offenders[:20],
    }


def _selftest() -> None:
    # Rioplatense correcto: 0 tuteo, voseo detectado.
    good = [
        "Dale, contame qué te pasó hoy.",
        "¿Vos querés que lo hablemos con un adulto de confianza?",
        "Tenés razón, che. Estoy acá para escucharte.",
        "Mirá, podés tomarte un momento. No pasa nada.",
        "Sos muy valiente por contarme esto.",
    ]
    r = score_batch(good)
    assert r["tuteo_violations"] == 0, r
    assert r["voseo_score"] > 0.9, r

    # Tuteo inequívoco: debe marcarse.
    bad = [
        "¿Tú quieres que hablemos?",       # tú, quieres
        "Tienes que contárselo a alguien.",  # tienes
        "Dime qué sientes ahora.",           # dime, sientes
        "Puedes confiar en mí, eres fuerte.",  # puedes, eres
    ]
    rb = score_batch(bad)
    assert rb["tuteo_violations"] >= 6, rb  # al menos 6 marcadores en 4 frases

    # Falsos positivos que NO deben marcarse:
    #  - "tu" posesivo sin acento
    #  - "estas" demostrativo
    #  - "vive"/"come" 3ª persona (no 2ª tú)
    neg = [
        "Tu mamá te quiere mucho.",           # tu posesivo
        "Estas cosas pasan, tranquilo.",       # estas demostrativo
        "Tu hermano vive cerca y come temprano.",  # 3ª persona
        "Contame de tu día.",                  # tu posesivo + voseo
    ]
    rn = score_batch(neg)
    assert rn["tuteo_violations"] == 0, f"falso positivo: {rn}"

    # Entrada vacía / mal tipada: fail-closed sin crashear.
    assert score_batch([])["voseo_score"] == 0.0
    assert score_batch([None, 123, "Tenés razón"])["tuteo_violations"] == 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
        print("voseo.py selftest OK")
        raise SystemExit(0)
    # Modo filtro: lee líneas de stdin (una salida por línea) y reporta.
    import json
    lines = [ln.rstrip("\n") for ln in sys.stdin if ln.strip()]
    print(json.dumps(score_batch(lines), ensure_ascii=False, indent=2))
