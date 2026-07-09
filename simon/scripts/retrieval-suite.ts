/**
 * Suite determinística del retrieval de fichas (RAG liviano).
 *
 *   pnpm retrieval-suite   (o: tsx scripts/retrieval-suite.ts)
 *
 * NO llama al LLM ni a la DB: corre selectRelevantCards() sobre el corpus real
 * (prisma/knowledge-data.ts) con preguntas de dominio y verifica que la ficha
 * esperada aparezca en el top-N. Mide precisión@1 y presencia@4.
 *
 * Por qué importa: si una pregunta de dominio ("¿cómo tramito el CUD?") no trae
 * su ficha, el LLM responde sin la fuente correcta. Este es el gate de calidad
 * del retrieval y protege contra regresiones al tocar el tokenizador o el scoring.
 *
 * Sale con código 1 si algún caso "hard" (presencia@4) falla.
 */
import { KNOWLEDGE_CARDS, type Card } from "../prisma/knowledge-data";
import { selectRelevantCards } from "../src/lib/ai/system-prompt";
import type { KnowledgeCard } from "../src/generated/prisma/client";

// selectRelevantCards sólo lee title/body/source; el resto del shape de
// KnowledgeCard se completa con placeholders para satisfacer el tipo.
function asKnowledgeCard(c: Card): KnowledgeCard {
  return {
    id: c.slug,
    slug: c.slug,
    category: c.category,
    title: c.title,
    body: c.body,
    source: c.source ?? null,
    reviewed: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

const CARDS = KNOWLEDGE_CARDS.map(asKnowledgeCard);

type Case = { query: string; expect: string };

// Preguntas realistas de una familia → slug de la ficha que DEBERÍA traer.
const CASES: Case[] = [
  { query: "¿Qué es el CUD y para qué sirve?", expect: "como-tramitar-cud" },
  { query: "cómo tramito el certificado único de discapacidad", expect: "como-tramitar-cud" },
  { query: "mi hijo tiene autismo, qué apoyos hay", expect: "tea" },
  { query: "me dijeron que es TEA", expect: "tea" },
  { query: "tengo tdah y me cuesta concentrarme en la escuela", expect: "tdah" },
  { query: "síndrome de down cobertura", expect: "down" },
  { query: "la obra social me rechazó una prestación, qué hago", expect: "rechazo-obra-social" },
  { query: "no escucha bien, necesita audífonos", expect: "auditiva" },
  { query: "problemas para ver, baja visión y braille", expect: "visual" },
  { query: "parálisis cerebral y silla postural", expect: "pc" },
  { query: "espina bífida y sondas", expect: "espina" },
  { query: "distrofia muscular de Duchenne", expect: "distrofia" },
  { query: "síndrome de Rett en niñas", expect: "rett" },
  { query: "Prader-Willi y el apetito", expect: "pw" },
  { query: "duplicación del cromosoma 15 y epilepsia", expect: "dup15q" },
  { query: "recién nos dieron el diagnóstico, por dónde empezamos", expect: "primeros-pasos-diagnostico" },
  { query: "trastorno del lenguaje, fonoaudiología", expect: "tel" },
  { query: "discapacidad intelectual y pensión", expect: "di" },
  { query: "síndrome x frágil hereditario", expect: "xfragil" },
  { query: "sordoceguera comunicación táctil", expect: "sordoceguera" },
];

let top1 = 0;
let top4 = 0;
const failures: string[] = [];

console.log(`Retrieval suite — ${CASES.length} casos sobre ${CARDS.length} fichas\n`);

for (const { query, expect } of CASES) {
  const ranked = selectRelevantCards(CARDS, query, 4);
  const slugs = ranked.map((c) => c.slug);
  const rank = slugs.indexOf(expect); // -1 = no aparece en top-4
  const inTop1 = rank === 0;
  const inTop4 = rank >= 0;
  if (inTop1) top1++;
  if (inTop4) top4++;
  const badge = inTop1 ? "①✓" : inTop4 ? `④#${rank + 1}` : "✗MISS";
  console.log(`${inTop4 ? "  " : "❌"} ${badge}  "${query}"  → [${slugs.join(", ") || "∅"}]`);
  if (!inTop4) failures.push(`${expect} no aparece para "${query}" (top-4: ${slugs.join(", ") || "∅"})`);
}

const p1 = ((top1 / CASES.length) * 100).toFixed(0);
const p4 = ((top4 / CASES.length) * 100).toFixed(0);
console.log(`\n========== RESUMEN ==========`);
console.log(`Precisión@1: ${top1}/${CASES.length} (${p1}%)`);
console.log(`Presencia@4: ${top4}/${CASES.length} (${p4}%)`);

if (failures.length > 0) {
  console.log(`\nFallos (presencia@4 — la ficha esperada NO se inyecta):`);
  for (const f of failures) console.log(`  ⚠️  ${f}`);
  console.log(`\nRetrieval suite: FALLÓ (${failures.length} caso/s hard).`);
  process.exit(1);
}
console.log(`\nRetrieval suite: ${CASES.length}/${CASES.length} presencia@4 OK.`);
