/**
 * Suite del Puente (lib/bridge.ts): lógica PURA de derivación asistida.
 * Determinística (inyecta `now`); sin DB ni LLM. Fija las reglas de:
 *  - summarizeSituation: prioridad severa > patrón, umbral y ventana.
 *  - resolveBridgeState: suggestion / in_progress / none (ya manejado).
 *  - buildBridgeCard: arma o suprime la tarjeta.
 */
import { createChecker } from "./suite-helpers";
import {
  summarizeSituation,
  resolveBridgeState,
  buildBridgeCard,
} from "../src/lib/bridge";

const c = createChecker("bridge");

const NOW = new Date("2026-07-11T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 24 * 3600 * 1000);

// ---------- summarizeSituation ----------
c.check(summarizeSituation([], NOW) === null, "sin eventos → null");
c.check(
  summarizeSituation([{ category: "riesgo", createdAt: day(100) }], NOW) === null,
  "evento fuera de ventana → null",
);

const crisis = summarizeSituation([{ category: "crisis", createdAt: day(1) }], NOW);
c.check(crisis?.reason === "crisis" && crisis.severity === "alta", "crisis → alta");

const abuso = summarizeSituation([{ category: "abuso", createdAt: day(1) }], NOW);
c.check(abuso?.reason === "abuso", "abuso → abuso");

const mod = summarizeSituation([{ category: "sexual/minors", createdAt: day(1) }], NOW);
c.check(mod?.reason === "abuso", "categoría cruda de moderación (sexual) → abuso");

const mixed = summarizeSituation(
  [
    { category: "crisis", createdAt: day(1) },
    { category: "riesgo", createdAt: day(2) },
    { category: "riesgo", createdAt: day(3) },
  ],
  NOW,
);
c.check(mixed?.reason === "crisis", "señal severa tiene prioridad sobre patrón");

c.check(
  summarizeSituation([{ category: "riesgo", createdAt: day(1) }], NOW) === null,
  "1 riesgo (< umbral) → null",
);
const twoRiesgo = summarizeSituation(
  [
    { category: "riesgo", createdAt: day(1) },
    { category: "riesgo", createdAt: day(2) },
  ],
  NOW,
);
c.check(twoRiesgo?.reason === "riesgo" && twoRiesgo.count === 2, "2 riesgo → patrón riesgo");

const alim = summarizeSituation(
  [
    { category: "alimentario", createdAt: day(1) },
    { category: "alimentario", createdAt: day(2) },
  ],
  NOW,
);
c.check(alim?.reason === "alimentario", "2 alimentario → patrón alimentario");

c.check(
  summarizeSituation(
    [
      { category: "riesgo", createdAt: day(1) },
      { category: "riesgo", createdAt: day(20) },
    ],
    NOW,
  ) === null,
  "riesgos separados por más que la ventana no acumulan",
);

// ---------- resolveBridgeState ----------
const sit = summarizeSituation([{ category: "crisis", createdAt: day(2) }], NOW)!;
c.check(resolveBridgeState(null, null) === "none", "sin situación → none");
c.check(resolveBridgeState(sit, null) === "suggestion", "situación sin followup → suggestion");
c.check(
  resolveBridgeState(sit, { status: "dismissed", updatedAt: day(1) }) === "none",
  "dismissed después del último evento → none",
);
c.check(
  resolveBridgeState(sit, { status: "dismissed", updatedAt: day(3) }) === "suggestion",
  "dismissed ANTES de un evento nuevo → vuelve a suggestion",
);
c.check(
  resolveBridgeState(sit, { status: "resolved", updatedAt: day(1) }) === "none",
  "resolved después → none",
);
c.check(
  resolveBridgeState(sit, { status: "contacted", updatedAt: day(1) }) === "in_progress",
  "contacted al día con los eventos → in_progress",
);
c.check(
  resolveBridgeState(sit, { status: "contacted", updatedAt: day(3) }) === "suggestion",
  "contacted pero hay evento nuevo posterior → suggestion",
);

// ---------- buildBridgeCard ----------
const card = buildBridgeCard(
  { id: "c1", name: "Sofi" },
  [{ category: "crisis", createdAt: day(1) }],
  null,
  NOW,
);
c.check(
  card !== null &&
    card.childId === "c1" &&
    card.state === "suggestion" &&
    card.recommendation.script.length > 0,
  "buildBridgeCard arma la tarjeta con recomendación",
);
c.check(
  buildBridgeCard({ id: "c1", name: "Sofi" }, [], null, NOW) === null,
  "sin situación → sin tarjeta",
);

c.done();
