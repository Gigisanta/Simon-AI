#!/usr/bin/env python3
"""generate.py — generación sintética persona-driven del dataset generativo.

Genera conversaciones multi-turno en rioplatense contra un profesor
OpenAI-compatible (data/README §4.2). NO decide seguridad: la exclusión de
crisis y toda la curación las hace curate.py aguas abajo. Acá se generan
conversaciones benignas + la mezcla de seguridad (rechazos cálidos, derivación
liviana) que la PERSONA de producción refleja.

FRONTERA DE GASTO (precision): `--budget-usd` es un TECHO DURO. Antes de cada
llamada se proyecta el peor caso (prompt + max_tokens de completion) y si
superaría el techo, se PARA. La API key sale de env (AI_API_KEY), nunca del
código ni de argv. Sin poder contabilizar el costo => se para (fail-closed).

TOS: el profesor debe permitir distillation (ver recipe 00 item 4). DeepSeek
directo lo permite; en OpenRouter usar --distillable (agrega
provider.enforce_distillable_text al body). NO usar OpenAI.

Endpoint inyectable => la lógica (cap, personas, esquema) se testea offline sin
gastar. Self-check: python3 generate.py --selftest

Uso real (tras configurar el endpoint del profesor por env):
    AI_BASE_URL=... AI_API_KEY=... AI_MODEL=... \
    python3 generate.py --n 500 --budget-usd 3.0 \
        --price-in 0.14 --price-out 0.28 --out crudo.jsonl --seed 7
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass

# --------------------------------------------------------------------------
# Personas sintéticas (data/README §1). Set acotado, NADIE real. El registro
# etario y el contexto emocional guían el estilo; Simón acompaña sin terapizar.
# --------------------------------------------------------------------------
CHILD_PERSONAS = [
    {"edad": 7, "franja": "niñez", "contexto": "extraña a un abuelo que se mudó", "registro": "simple, frases cortas"},
    {"edad": 9, "franja": "niñez", "contexto": "se peleó con su mejor amigo en el recreo", "registro": "concreto, ejemplos del cole"},
    {"edad": 11, "franja": "pubertad", "contexto": "le va mal en matemática y se frustra", "registro": "más elaborado, algo de vergüenza"},
    {"edad": 13, "franja": "adolescencia", "contexto": "se siente excluido de un grupo del colegio", "registro": "reservado, prueba límites"},
    {"edad": 15, "franja": "adolescencia", "contexto": "discute con los padres por los horarios", "registro": "irónico, jerga adolescente AR"},
    {"edad": 10, "franja": "niñez", "contexto": "tiene TDAH y le cuesta concentrarse en la tarea", "registro": "disperso, entusiasta"},
]
# Categorías benignas de conversación (lo que el modelo SÍ aprende a manejar).
TOPICS = [
    "contar cómo le fue el día",
    "pedir ayuda con una tarea sin que se la resuelvan",
    "hablar de un juego o serie que le gusta",
    "una frustración cotidiana (no de crisis)",
    "aburrimiento un domingo a la tarde",
    "nervios antes de una prueba",
]
# Mezcla de seguridad LIVIANA (no crisis): rechazos cálidos y derivación
# proporcional. Las categorías de crisis/abuso NO se generan (las excluye curate).
SAFETY_MIX = [
    "pide que le guarde un secreto que no debería guardar (límite cálido)",
    "quiere saltearse una regla de casa (validar el sentimiento, sostener el límite)",
    "pregunta si Simón es una persona real (identidad IA honesta)",
]

SYSTEM_PROFESOR = (
    "Sos Simón, un compañero conversacional para chicos y adolescentes de Argentina. "
    "Hablás SIEMPRE en rioplatense natural: voseo (tenés, querés, podés, vos), che, "
    "nada de tuteo (nada de tú/tienes/quieres) ni español neutro. Sos cálido y ponés "
    "límites sanos; no sos terapeuta ni reemplazás a un adulto. Generá un diálogo "
    "multi-turno realista entre un CHICO y SIMÓN."
)


def build_seed_prompt(persona: dict, topic: str, turns: int) -> list[dict]:
    """Instrucción Magpie/persona-driven para que el profesor genere el diálogo."""
    user = (
        f"Generá una conversación de {turns} turnos (alternando child/assistant, "
        f"empieza el child) para esta situación.\n"
        f"CHICO: {persona['edad']} años, {persona['franja']}, {persona['contexto']}. "
        f"Registro: {persona['registro']}.\n"
        f"TEMA: {topic}.\n"
        f"Devolvé SOLO un JSON: {{\"messages\": [{{\"role\":\"child\"|\"assistant\", \"content\":\"...\"}}]}}. "
        f"Rioplatense estricto, sin tuteo."
    )
    return [{"role": "system", "content": SYSTEM_PROFESOR}, {"role": "user", "content": user}]


# --------------------------------------------------------------------------
# Contabilidad de gasto (techo duro).
# --------------------------------------------------------------------------
@dataclass
class Budget:
    ceiling_usd: float
    price_in_per_m: float   # USD por 1M tokens de entrada
    price_out_per_m: float  # USD por 1M tokens de salida
    spent_usd: float = 0.0

    def cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        return (prompt_tokens * self.price_in_per_m + completion_tokens * self.price_out_per_m) / 1_000_000

    def would_exceed(self, prompt_tokens_est: int, max_completion_tokens: int) -> bool:
        """Proyección de PEOR caso antes de llamar. True => no llamar."""
        projected = self.spent_usd + self.cost(prompt_tokens_est, max_completion_tokens)
        return projected > self.ceiling_usd

    def charge(self, prompt_tokens: int, completion_tokens: int) -> None:
        self.spent_usd += self.cost(prompt_tokens, completion_tokens)


def est_tokens(text: str) -> int:
    """Estimación sin tokenizer (≈4 chars/token). Solo para la proyección
    pre-llamada; el cobro real usa el usage devuelto por la API."""
    return max(1, len(text) // 4)


# --------------------------------------------------------------------------
# Endpoint OpenAI-compatible (stdlib, sin deps). Inyectable para tests.
# --------------------------------------------------------------------------
class TeacherError(Exception):
    pass


def http_teacher(messages: list[dict], *, max_tokens: int, extra_body: dict | None = None) -> dict:
    """Llama chat/completions. Devuelve {'text', 'prompt_tokens', 'completion_tokens'}.
    Lee endpoint/key/modelo de env (AI_BASE_URL/AI_API_KEY/AI_MODEL). Nunca de argv."""
    base = os.environ.get("AI_BASE_URL", "https://api.deepseek.com").rstrip("/")
    key = os.environ.get("AI_API_KEY")
    model = os.environ.get("AI_MODEL", "deepseek-chat")
    if not key:
        raise TeacherError("AI_API_KEY no está en el entorno (no se hardcodea)")
    body = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": 0.9}
    if extra_body:
        body.update(extra_body)
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode())
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise TeacherError(f"llamada al profesor falló: {e}") from e
    try:
        text = payload["choices"][0]["message"]["content"]
        usage = payload.get("usage", {})
        pt = int(usage.get("prompt_tokens", 0))
        ct = int(usage.get("completion_tokens", 0))
    except (KeyError, IndexError, TypeError) as e:
        raise TeacherError(f"respuesta del profesor con forma inesperada: {e}") from e
    # Fail-closed sobre el usage: si la API no lo da, estimamos por chars para
    # que el cap NUNCA se quede ciego (mejor sobreestimar el gasto que pasarse).
    if pt <= 0:
        pt = est_tokens("".join(m["content"] for m in messages))
    if ct <= 0:
        ct = est_tokens(text)
    return {"text": text, "prompt_tokens": pt, "completion_tokens": ct}


# --------------------------------------------------------------------------
# Validación de esquema del ejemplo generado (item 5: validar antes del push).
# --------------------------------------------------------------------------
def parse_and_validate(text: str, min_turns: int) -> dict | None:
    """El profesor devuelve un JSON {messages:[{role,content}]}. Se normaliza a
    formato chat-completions (role assistant/user) y se valida. None si inválido."""
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        # a veces el modelo envuelve en ```json ... ```
        s = text.strip()
        if s.startswith("```"):
            s = s.split("```", 2)[1]
            s = s[4:] if s.lower().startswith("json") else s
            try:
                obj = json.loads(s)
            except json.JSONDecodeError:
                return None
        else:
            return None
    msgs = obj.get("messages") if isinstance(obj, dict) else None
    if not isinstance(msgs, list) or len(msgs) < min_turns:
        return None
    norm = []
    for m in msgs:
        if not isinstance(m, dict):
            return None
        role, content = m.get("role"), m.get("content")
        if not isinstance(content, str) or not content.strip():
            return None
        # child -> user (formato chat-completions estándar).
        r = "user" if role in ("child", "user") else "assistant" if role == "assistant" else None
        if r is None:
            return None
        norm.append({"role": r, "content": content.strip()})
    # Debe abrir en user y cerrar en assistant (mismo contrato que training-export).
    if norm[0]["role"] != "user" or norm[-1]["role"] != "assistant":
        return None
    return {"messages": norm}


def generate(n: int, budget: Budget, teacher, *, seed: int, turns: int, max_tokens: int,
             extra_body: dict | None = None, log=print) -> tuple[list[dict], dict]:
    """Genera hasta n ejemplos o hasta agotar el presupuesto. teacher(messages,
    max_tokens=..., extra_body=...) -> {'text','prompt_tokens','completion_tokens'}."""
    import random
    rng = random.Random(seed)
    combos = [(p, t) for p in CHILD_PERSONAS for t in (TOPICS + SAFETY_MIX)]
    rng.shuffle(combos)

    out: list[dict] = []
    stats = {"requested": n, "generated": 0, "invalid": 0, "stopped_reason": "n_alcanzado", "calls": 0}
    for i in range(n):
        persona, topic = combos[i % len(combos)]
        messages = build_seed_prompt(persona, topic, turns)
        prompt_est = est_tokens("".join(m["content"] for m in messages))
        if budget.would_exceed(prompt_est, max_tokens):
            stats["stopped_reason"] = "budget_agotado"
            log(f"[generate] STOP: el próximo call superaría el techo (USD {budget.ceiling_usd}); "
                f"gastado ~USD {budget.spent_usd:.4f}")
            break
        try:
            resp = teacher(messages, max_tokens=max_tokens, extra_body=extra_body)
        except TeacherError as e:
            stats["stopped_reason"] = f"error_profesor: {e}"
            log(f"[generate] STOP: {e}")
            break
        stats["calls"] += 1
        budget.charge(resp["prompt_tokens"], resp["completion_tokens"])
        example = parse_and_validate(resp["text"], min_turns=turns)
        if example is None:
            stats["invalid"] += 1
            continue
        out.append(example)
        stats["generated"] += 1
    stats["spent_usd"] = round(budget.spent_usd, 6)
    return out, stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Generación sintética persona-driven (con cap de gasto)")
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--budget-usd", type=float, help="TECHO DURO de gasto (obligatorio en modo real)")
    ap.add_argument("--price-in", type=float, help="USD por 1M tokens de entrada")
    ap.add_argument("--price-out", type=float, help="USD por 1M tokens de salida")
    ap.add_argument("--turns", type=int, default=6)
    ap.add_argument("--max-tokens", type=int, default=1024)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--out", default="crudo.jsonl")
    ap.add_argument("--distillable", action="store_true", help="OpenRouter: exige modelos distilables")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args(argv)

    if args.selftest:
        _selftest()
        print("generate.py selftest OK")
        return 0

    # Precision: sin techo explícito no se gasta. Nada de default silencioso.
    if args.budget_usd is None or args.price_in is None or args.price_out is None:
        print("ERROR: --budget-usd, --price-in y --price-out son obligatorios (frontera de gasto)", file=sys.stderr)
        return 1
    if args.budget_usd <= 0:
        print("ERROR: --budget-usd debe ser > 0", file=sys.stderr)
        return 1

    budget = Budget(args.budget_usd, args.price_in, args.price_out)
    extra_body = {"provider": {"enforce_distillable_text": True}} if args.distillable else None

    examples, stats = generate(
        args.n, budget, http_teacher, seed=args.seed, turns=args.turns,
        max_tokens=args.max_tokens, extra_body=extra_body,
    )
    with open(args.out, "w", encoding="utf-8") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"[generate] {len(examples)} ejemplos crudos -> {args.out} "
          f"(gastado ~USD {stats['spent_usd']}). Pasar por curate.py antes de usar.")
    return 0


def _selftest() -> None:
    # Profesor falso determinístico: no gasta, no toca la red.
    def fake_teacher(messages, *, max_tokens, extra_body=None):
        convo = {"messages": [
            {"role": "child", "content": "hola, hoy me fue mal en la prueba"},
            {"role": "assistant", "content": "Uh, contame qué pasó. ¿Tenés ganas de charlarlo?"},
            {"role": "child", "content": "me puse re nervioso y me quedé en blanco"},
            {"role": "assistant", "content": "Te entiendo, che. Los nervios juegan feo. ¿Qué probaste?"},
        ]}
        return {"text": json.dumps(convo, ensure_ascii=False), "prompt_tokens": 120, "completion_tokens": 80}

    # 1) genera n válidos y contabiliza gasto.
    b = Budget(ceiling_usd=1.0, price_in_per_m=0.14, price_out_per_m=0.28)
    ex, st = generate(5, b, fake_teacher, seed=1, turns=4, max_tokens=256, log=lambda *_: None)
    assert st["generated"] == 5, st
    assert st["invalid"] == 0, st
    assert b.spent_usd > 0, "no contabilizó gasto"
    assert all(e["messages"][0]["role"] == "user" and e["messages"][-1]["role"] == "assistant" for e in ex)

    # 2) el techo duro PARA antes de pasarse.
    tiny = Budget(ceiling_usd=0.00005, price_in_per_m=0.14, price_out_per_m=0.28)
    ex2, st2 = generate(100, tiny, fake_teacher, seed=1, turns=4, max_tokens=1024, log=lambda *_: None)
    assert st2["stopped_reason"] == "budget_agotado", st2
    assert tiny.spent_usd <= tiny.ceiling_usd or st2["calls"] == 0, st2  # nunca se pasa del techo

    # 3) error del profesor => para (fail-closed), no crashea.
    def boom(messages, *, max_tokens, extra_body=None):
        raise TeacherError("500 del gateway")
    ex3, st3 = generate(10, Budget(1.0, 0.1, 0.1), boom, seed=1, turns=4, max_tokens=64, log=lambda *_: None)
    assert st3["generated"] == 0 and st3["stopped_reason"].startswith("error_profesor"), st3

    # 4) validación de esquema: descarta lo malformado.
    def bad_teacher(messages, *, max_tokens, extra_body=None):
        return {"text": "esto no es json", "prompt_tokens": 10, "completion_tokens": 5}
    ex4, st4 = generate(3, Budget(1.0, 0.1, 0.1), bad_teacher, seed=1, turns=4, max_tokens=64, log=lambda *_: None)
    assert st4["generated"] == 0 and st4["invalid"] == 3, st4

    # 5) validación directa: tuteo NO se filtra acá (eso es curate), pero el
    #    contrato user-first/assistant-last sí.
    assert parse_and_validate('{"messages":[{"role":"assistant","content":"hola"}]}', 1) is None  # abre en assistant
    assert parse_and_validate('{"messages":[{"role":"child","content":"a"},{"role":"assistant","content":"b"}]}', 2) is not None


if __name__ == "__main__":
    raise SystemExit(main())
