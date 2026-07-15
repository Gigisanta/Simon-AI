/**
 * Suite ejecutable de la primitiva de cascada de guardrails (ADR-2).
 *
 *   pnpm guardrail-cascade-suite
 *
 * Testea SOLO la primitiva pura `runGuardrailCascade` con checks stub
 * deterministas (sin red, sin LLM, sin keys). El comportamiento de las capas
 * reales (OpenAI/LLM) lo cubre moderation-suite; acá se verifica el CONTRATO del
 * runner que las orquesta:
 *   - orden cheapest-first y corte en el PRIMER veredicto concluyente
 *     (`available:true`) — los checks siguientes NO se ejecutan;
 *   - un veredicto no concluyente (`null` o `available:false`) cae a la
 *     siguiente capa;
 *   - FAIL-CLOSED: un check que lanza/agota timeout se trata como no
 *     concluyente (NUNCA como veredicto limpio) y la cascada no lanza;
 *   - sin veredicto concluyente → devuelve el inconcluso canónico;
 *   - `source` del veredicto = la capa que concluyó; el `signal` se propaga.
 *
 * Camino crítico de seguridad: si el runner "tragara" un throw como
 * `available:true, flagged:false`, un fallo de una capa se leería como "todo
 * limpio" y saltearía la política fail-closed del caller. Sale con código 1 si
 * algún caso falla (gate de CI).
 */
import {
  runGuardrailCascade,
  type GuardrailCheck,
  type GuardrailVerdict,
} from "../src/lib/guardrails/cascade";

type V = GuardrailVerdict;

/** Inconcluso canónico del dominio (equivale al source "none" de moderación). */
const INCONCLUSIVE: V = {
  available: false,
  flagged: false,
  mappedFlag: null,
  source: "none",
};

/** Veredicto concluyente de conveniencia. */
function conclusive(source: string, over: Partial<V> = {}): V {
  return { available: true, flagged: false, mappedFlag: null, source, ...over };
}

/** Check stub que registra su ejecución y devuelve un resultado fijo. */
function stub(
  source: string,
  result: V | null,
  calls: string[],
): GuardrailCheck<string, V> {
  return {
    source,
    async run() {
      calls.push(source);
      return result;
    },
  };
}

/** Check stub que lanza (simula error/timeout de la capa). */
function throwing(source: string, calls: string[]): GuardrailCheck<string, V> {
  return {
    source,
    async run() {
      calls.push(source);
      throw new Error(`boom:${source}`);
    },
  };
}

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = "") {
  if (cond) passed += 1;
  else failures.push(`  ✗ [${name}]${detail ? `\n      ${detail}` : ""}`);
}

function sameVerdict(got: V, want: V): boolean {
  return (
    got.available === want.available &&
    got.flagged === want.flagged &&
    got.mappedFlag === want.mappedFlag &&
    got.source === want.source &&
    got.topCategory === want.topCategory
  );
}

async function main() {
  // 1) Corta en el PRIMER concluyente; el resto NO corre (cheapest-first).
  {
    const calls: string[] = [];
    const got = await runGuardrailCascade(
      [
        stub("regex", conclusive("regex", { flagged: true, mappedFlag: "crisis" }), calls),
        stub("llm", conclusive("llm", { flagged: true, mappedFlag: "riesgo" }), calls),
      ],
      "x",
      INCONCLUSIVE,
    );
    check(
      "corte en el primer concluyente",
      got.source === "regex" && got.flagged === true && got.mappedFlag === "crisis",
      `obtenido: ${JSON.stringify(got)}`,
    );
    check(
      "capa posterior NO se ejecuta tras el corte",
      calls.length === 1 && calls[0] === "regex",
      `calls: ${JSON.stringify(calls)}`,
    );
  }

  // 2) `null` (no aplica) cae a la siguiente capa.
  {
    const calls: string[] = [];
    const got = await runGuardrailCascade(
      [stub("regex", null, calls), stub("classifier", conclusive("classifier"), calls)],
      "x",
      INCONCLUSIVE,
    );
    check(
      "null cae a la siguiente capa",
      got.source === "classifier" && got.available === true,
      `obtenido: ${JSON.stringify(got)}`,
    );
    check(
      "orden preservado en el fallthrough",
      JSON.stringify(calls) === JSON.stringify(["regex", "classifier"]),
      `calls: ${JSON.stringify(calls)}`,
    );
  }

  // 3) Un veredicto `available:false` NO corta la cascada (sigue a la próxima).
  {
    const calls: string[] = [];
    const got = await runGuardrailCascade(
      [
        stub("regex", { ...INCONCLUSIVE, source: "regex" }, calls),
        stub("llm", conclusive("llm", { flagged: true, mappedFlag: "riesgo" }), calls),
      ],
      "x",
      INCONCLUSIVE,
    );
    check(
      "available:false no corta",
      got.source === "llm" && got.flagged === true,
      `obtenido: ${JSON.stringify(got)}`,
    );
    check(
      "available:false continúa a la siguiente capa",
      JSON.stringify(calls) === JSON.stringify(["regex", "llm"]),
      `calls: ${JSON.stringify(calls)}`,
    );
  }

  // 4) Ningún concluyente → devuelve el inconcluso canónico.
  {
    const calls: string[] = [];
    const got = await runGuardrailCascade(
      [stub("regex", null, calls), stub("llm", { ...INCONCLUSIVE, source: "llm" }, calls)],
      "x",
      INCONCLUSIVE,
    );
    check(
      "sin concluyente → inconcluso canónico",
      sameVerdict(got, INCONCLUSIVE),
      `obtenido: ${JSON.stringify(got)}`,
    );
  }

  // 5) FAIL-CLOSED: un check que LANZA se trata como no concluyente y continúa.
  {
    const calls: string[] = [];
    const got = await runGuardrailCascade(
      [
        throwing("regex", calls),
        stub("llm", conclusive("llm", { flagged: true, mappedFlag: "riesgo" }), calls),
      ],
      "x",
      INCONCLUSIVE,
    );
    check(
      "throw se trata como no concluyente (continúa)",
      got.source === "llm" && got.flagged === true,
      `obtenido: ${JSON.stringify(got)}`,
    );
    check(
      "tras un throw sigue la siguiente capa",
      JSON.stringify(calls) === JSON.stringify(["regex", "llm"]),
      `calls: ${JSON.stringify(calls)}`,
    );
  }

  // 6) FAIL-CLOSED: todos lanzan → inconcluso (nunca un veredicto limpio).
  {
    const calls: string[] = [];
    let threw = false;
    let got: V | null = null;
    try {
      got = await runGuardrailCascade(
        [throwing("regex", calls), throwing("llm", calls)],
        "x",
        INCONCLUSIVE,
      );
    } catch {
      threw = true;
    }
    check("la cascada NO propaga el throw", !threw);
    check(
      "todos lanzan → inconcluso (no un available:true limpio)",
      got !== null && sameVerdict(got, INCONCLUSIVE),
      `obtenido: ${JSON.stringify(got)}`,
    );
  }

  // 7) FAIL-CLOSED: el ÚLTIMO check lanza → inconcluso (no fabrica "todo OK").
  {
    const calls: string[] = [];
    const got = await runGuardrailCascade(
      [stub("regex", null, calls), throwing("llm", calls)],
      "x",
      INCONCLUSIVE,
    );
    check(
      "último check que lanza → inconcluso",
      sameVerdict(got, INCONCLUSIVE),
      `obtenido: ${JSON.stringify(got)}`,
    );
    check(
      "se intentaron todas las capas",
      JSON.stringify(calls) === JSON.stringify(["regex", "llm"]),
      `calls: ${JSON.stringify(calls)}`,
    );
  }

  // 8) Lista de checks vacía → inconcluso, sin ejecutar nada.
  {
    const got = await runGuardrailCascade([], "x", INCONCLUSIVE);
    check("checks vacíos → inconcluso", sameVerdict(got, INCONCLUSIVE), `obtenido: ${JSON.stringify(got)}`);
  }

  // 9) El corte saltea TODAS las capas restantes (no solo la inmediata).
  {
    const calls: string[] = [];
    const got = await runGuardrailCascade(
      [
        stub("a", null, calls),
        stub("b", conclusive("b"), calls),
        stub("c", conclusive("c"), calls),
      ],
      "x",
      INCONCLUSIVE,
    );
    check("gana la primera concluyente (b)", got.source === "b");
    check(
      "las capas posteriores al corte no corren",
      JSON.stringify(calls) === JSON.stringify(["a", "b"]),
      `calls: ${JSON.stringify(calls)}`,
    );
  }

  // 10) El `signal` se propaga a cada check.
  {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const spy: GuardrailCheck<string, V> = {
      source: "spy",
      async run(_input, signal) {
        seen = signal;
        return conclusive("spy");
      },
    };
    await runGuardrailCascade([spy], "x", INCONCLUSIVE, controller.signal);
    check("el signal se propaga al check", seen === controller.signal);
  }

  // 11) `source` del veredicto = la capa que concluyó (tras capas caídas).
  {
    const calls: string[] = [];
    const got = await runGuardrailCascade(
      [
        stub("regex", { ...INCONCLUSIVE, source: "regex" }, calls),
        stub("classifier", { ...INCONCLUSIVE, source: "classifier" }, calls),
        stub("llm", conclusive("llm", { topCategory: "self-harm", flagged: true, mappedFlag: "crisis" }), calls),
      ],
      "x",
      INCONCLUSIVE,
    );
    check(
      "source expuesto por capa concluyente",
      got.source === "llm" && got.topCategory === "self-harm",
      `obtenido: ${JSON.stringify(got)}`,
    );
  }

  const total = passed + failures.length;
  console.log(`\nGuardrail-cascade suite: ${passed}/${total} casos OK`);
  if (failures.length > 0) {
    console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
    process.exit(1);
  }
  console.log("Todos los casos pasaron.\n");
}

main();
