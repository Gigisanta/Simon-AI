/**
 * Gate objetivo unificado: corre TODAS las suites determinísticas en procesos
 * aislados y agrega el resultado. Un solo comando, un solo exit code.
 *
 *   pnpm test            (todas)
 *   pnpm test crisis     (subconjunto por nombre)
 *
 * Por qué subprocesos y no imports: algunas suites mutan process.env a propósito
 * (p.ej. moderation-suite borra OPENAI_API_KEY/AI_API_KEY para forzar el branch
 * "sin ninguna capa"). Aislarlas en su propio proceso evita que esa mutación
 * contamine a las demás. Cada suite ya sale con código 1 si falla; acá se
 * capturan esos códigos y se agregan.
 *
 * NO incluye conversation-eval (llama al LLM real, no es determinística): esa es
 * exploratoria, este runner es el gate de CI.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUITES = [
  "crisis",
  "moderation",
  "memory",
  "guardian",
  "guardian-auth",
  "guardian-children",
  "guardian-account",
  "guardian-export",
  "password",
  "email",
  "safety-events",
  "auth-storage",
  "env-check",
  "alerts",
  "rate-limit",
  "claim-once",
  "retrieval",
  "knowledge-cache",
  "training-export",
  "safety-docs",
  "retention",
  "purge",
  "resend-verification",
  "retry",
  "chat-precedence",
  "chat-idempotency",
  "csp",
  "migrate",
  "relative-time",
] as const;

const here = dirname(fileURLToPath(import.meta.url));
const tsx = join(here, "..", "node_modules", ".bin", "tsx");

const filterArgs = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const suites = filterArgs.length
  ? SUITES.filter((s) => filterArgs.some((f) => s.includes(f)))
  : [...SUITES];

if (suites.length === 0) {
  console.error(`Sin suites que matcheen ${JSON.stringify(filterArgs)}. Disponibles: ${SUITES.join(", ")}`);
  process.exit(2);
}

// Extrae "N/M casos OK" del stdout de una suite para el resumen agregado.
function parseCounts(out: string): { passed: number; total: number } | null {
  const m = out.match(/(\d+)\s*\/\s*(\d+)\s+casos/i);
  return m ? { passed: Number(m[1]), total: Number(m[2]) } : null;
}

console.log(`\n🧪 Gate — ${suites.length} suite(s) determinística(s)\n`);

const rows: Array<{ name: string; ok: boolean; passed: number; total: number; ms: number }> = [];
let anyFail = false;

for (const name of suites) {
  const started = process.hrtime.bigint();
  const res = spawnSync(tsx, [join(here, `${name}-suite.ts`)], {
    encoding: "utf8",
    // Env limpio de las claves que las suites esperan ausentes lo maneja cada
    // suite; acá heredamos el env tal cual.
  });
  const ms = Math.round(Number(process.hrtime.bigint() - started) / 1e6);
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const ok = res.status === 0;
  const counts = parseCounts(out);
  rows.push({ name, ok, passed: counts?.passed ?? 0, total: counts?.total ?? 0, ms });
  if (!ok) {
    anyFail = true;
    console.log(`❌ ${name}\n${out.trim()}\n`);
  } else {
    console.log(`✅ ${name.padEnd(12)} ${counts ? `${counts.passed}/${counts.total}` : "OK"}  ·  ${ms}ms`);
  }
}

const totalPassed = rows.reduce((s, r) => s + r.passed, 0);
const totalCases = rows.reduce((s, r) => s + r.total, 0);
const failed = rows.filter((r) => !r.ok);

console.log(`\n========== GATE ==========`);
console.log(`Suites: ${rows.length - failed.length}/${rows.length} verdes · Casos: ${totalPassed}/${totalCases}`);
if (anyFail) {
  console.log(`\n❌ FALLÓ: ${failed.map((r) => r.name).join(", ")}`);
  process.exit(1);
}
console.log(`\n✅ GATE VERDE — todas las suites pasaron.`);
