/**
 * Suite determinística del eval de conversación (sin framework — tsx, SIN red).
 *
 *   pnpm eval-suite
 *
 * Corre la rúbrica programática (scripts/eval-rubric.ts) sobre los transcripts
 * fixture de scripts/fixtures/eval-transcripts/*.json — el equivalente
 * determinístico de `tsx scripts/conversation-eval.ts --dry-run`. Es el gate de
 * regresión de la rúbrica: si un cambio en safety.ts/system-prompt.ts rompe un
 * check esperado sobre un transcript "dorado", esta suite lo detecta sin
 * necesidad de llamar al LLM real.
 *
 * Sale con código 1 si algún check o el score mínimo por escenario falla.
 */
import { createChecker } from "./suite-helpers";
import { contextFromFixture, loadFixtures, scoreReply } from "./eval-rubric";

const MIN_SCORE = 0.8;

const { check, done } = createChecker("Eval suite (dry-run)");

const fixtures = loadFixtures();
if (fixtures.length === 0) {
  throw new Error("[eval-suite] no se encontraron fixtures en scripts/fixtures/eval-transcripts");
}

for (const fx of fixtures) {
  const ctx = contextFromFixture(fx);
  const result = scoreReply(fx.id, ctx, fx.checks);
  for (const c of result.checks) {
    check(c.pass, `${fx.id} · check "${c.name}"`);
  }
  check(result.score >= MIN_SCORE, `${fx.id} · score ${result.score.toFixed(2)} ≥ ${MIN_SCORE}`);
}

done();
