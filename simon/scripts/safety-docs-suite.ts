/**
 * #34 — Anti-drift: plantillas de crisis (código) vs docs/research-safety.md §3.3.
 *
 *   pnpm safety-docs-suite
 *
 * safety.ts afirma en sus comentarios que las plantillas de respuesta de crisis
 * son "texto exacto de research-safety.md §3.3". Esta suite lo VERIFICA
 * automáticamente: extrae del markdown los bloques delimitados por marcadores
 * HTML-comment (<!-- TEMPLATE:xxx-start --> … <!-- TEMPLATE:xxx-end -->) y los
 * compara, carácter a carácter, con las constantes exportadas de safety.ts.
 *
 * El CÓDIGO es la verdad desplegada: si el doc y el código difieren, se ALINEA
 * el doc al código (nunca al revés). Esta suite es la red que impide que vuelvan
 * a divergir en silencio.
 *
 * Camino crítico: estas plantillas son lo que un menor en crisis ve; un drift
 * (un teléfono cambiado, una línea perdida) es un fallo de seguridad. Sale con
 * código 1 si algún bloque no coincide.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  ABUSE_TEMPLATE,
  CRITICAL_TEMPLATE,
  HIGH_TEMPLATE,
} from "../src/lib/safety";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ → simon/ → repo-root → docs/research-safety.md
const docPath = join(here, "..", "..", "docs", "research-safety.md");
const doc = readFileSync(docPath, "utf8");

/**
 * Extrae el contenido del bloque de código (``` … ```) que está entre los
 * marcadores <!-- TEMPLATE:{name}-start --> y <!-- TEMPLATE:{name}-end -->.
 * Devuelve null si falta algún marcador o el fence. Se recortan SOLO los saltos
 * de línea de los extremos que agrega el propio fence; el interior queda intacto.
 */
function extractTemplate(name: string): string | null {
  const start = `<!-- TEMPLATE:${name}-start -->`;
  const end = `<!-- TEMPLATE:${name}-end -->`;
  const s = doc.indexOf(start);
  const e = doc.indexOf(end);
  if (s === -1 || e === -1 || e < s) return null;
  const region = doc.slice(s + start.length, e);
  const fenceOpen = region.indexOf("```");
  if (fenceOpen === -1) return null;
  const afterOpen = region.indexOf("\n", fenceOpen);
  if (afterOpen === -1) return null;
  const fenceClose = region.indexOf("```", afterOpen);
  if (fenceClose === -1) return null;
  // Contenido entre la línea del fence de apertura y el fence de cierre.
  return region.slice(afterOpen + 1, fenceClose).replace(/\n+$/, "");
}

const cases: Array<{ name: string; constant: string }> = [
  { name: "critical", constant: CRITICAL_TEMPLATE },
  { name: "high", constant: HIGH_TEMPLATE },
  { name: "abuse", constant: ABUSE_TEMPLATE },
];

for (const { name, constant } of cases) {
  const fromDoc = extractTemplate(name);
  check(fromDoc !== null, `${name}: marcadores + fence presentes en el doc`);
  if (fromDoc === null) continue;
  const equal = fromDoc === constant;
  check(equal, `${name}: el bloque del doc coincide EXACTO con la constante de safety.ts`);
  if (!equal) {
    // Diagnóstico útil: primera línea que difiere.
    const a = constant.split("\n");
    const b = fromDoc.split("\n");
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) {
        failures.push(`      línea ${i + 1} difiere:`);
        failures.push(`        código: ${JSON.stringify(a[i])}`);
        failures.push(`        doc:    ${JSON.stringify(b[i])}`);
        break;
      }
    }
  }
}

// Guardas de contenido: los recursos oficiales clave siguen en cada plantilla
// (una red mínima por si alguien "alinea" ambos lados borrando un teléfono).
check(CRITICAL_TEMPLATE.includes("911") && CRITICAL_TEMPLATE.includes("135"),
  "critical: conserva 911 y 135");
check(ABUSE_TEMPLATE.includes("137") && ABUSE_TEMPLATE.includes("no es tu culpa"),
  "abuse: conserva Línea 137 y el mensaje 'no es tu culpa'");
check(HIGH_TEMPLATE.includes("102"),
  "high: conserva la Línea 102");

if (failures.length > 0) {
  console.error(`\nSAFETY-DOCS SUITE: ${failures.length} caso(s) fallando (${passed} ok)\n`);
  for (const f of failures) console.error(f);
  console.error(
    "\nRecordá: el CÓDIGO es la verdad desplegada. Alineá docs/research-safety.md §3.3 al código, nunca al revés.",
  );
  process.exit(1);
}
console.log(`SAFETY-DOCS SUITE: ${passed}/${passed + failures.length} casos OK`);
