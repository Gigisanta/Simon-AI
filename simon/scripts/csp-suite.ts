/**
 * Suite ejecutable del constructor de CSP (sin framework — tsx).
 *
 *   pnpm test csp
 *
 * Testea el núcleo puro `buildCsp` (no toca process.env, no genera nonce, no
 * lee headers): que inyecte el nonce, que `'unsafe-inline'` NO quede en
 * script-src, y que `'unsafe-eval'` aparezca solo en dev.
 *
 * Camino crítico de seguridad: la CSP es la barrera anti-XSS de una app de chat
 * para menores. Una regresión que reintroduzca `'unsafe-inline'` en script-src
 * neutraliza la protección sin romper nada visible — por eso se testea explícito.
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
import { buildCsp } from "../src/lib/csp";

let passed = 0;
const failures: string[] = [];

function check(cond: boolean, note: string) {
  if (cond) passed += 1;
  else failures.push(`  ✗ ${note}`);
}

/** Extrae la directiva `name` completa de una cadena CSP. */
function directive(csp: string, name: string): string | undefined {
  return csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

const NONCE = "abc123==";

// ---------- Inyección de nonce ----------
{
  const prod = buildCsp({ nonce: NONCE, isDev: false });
  const script = directive(prod, "script-src") ?? "";
  check(script.includes(`'nonce-${NONCE}'`), "prod: script-src incluye el nonce");
  check(script.includes("'strict-dynamic'"), "prod: script-src incluye 'strict-dynamic'");
  check(script.includes("'self'"), "prod: script-src incluye 'self'");

  // Un nonce distinto se refleja tal cual (no está hardcodeado).
  const other = buildCsp({ nonce: "OTRO/nonce+==", isDev: false });
  check(
    (directive(other, "script-src") ?? "").includes("'nonce-OTRO/nonce+=='"),
    "prod: el nonce del caller se refleja literal",
  );
}

// ---------- Anti-regresión: sin 'unsafe-inline' en script-src ----------
{
  const prod = buildCsp({ nonce: NONCE, isDev: false });
  const dev = buildCsp({ nonce: NONCE, isDev: true });
  check(!(directive(prod, "script-src") ?? "").includes("'unsafe-inline'"), "prod: script-src SIN 'unsafe-inline'");
  check(!(directive(dev, "script-src") ?? "").includes("'unsafe-inline'"), "dev: script-src SIN 'unsafe-inline'");
}

// ---------- 'unsafe-eval': solo en dev ----------
{
  const prod = buildCsp({ nonce: NONCE, isDev: false });
  const dev = buildCsp({ nonce: NONCE, isDev: true });
  check(!(directive(prod, "script-src") ?? "").includes("'unsafe-eval'"), "prod: script-src SIN 'unsafe-eval'");
  check((directive(dev, "script-src") ?? "").includes("'unsafe-eval'"), "dev: script-src CON 'unsafe-eval'");
}

// ---------- Directivas previas preservadas exactamente ----------
{
  const csp = buildCsp({ nonce: NONCE, isDev: false });
  const expected: Record<string, string> = {
    "default-src": "default-src 'self'",
    "style-src": "style-src 'self' 'unsafe-inline'",
    "img-src": "img-src 'self' data: blob:",
    "font-src": "font-src 'self'",
    "connect-src": "connect-src 'self'",
    "frame-ancestors": "frame-ancestors 'none'",
    "base-uri": "base-uri 'self'",
    "form-action": "form-action 'self'",
    "object-src": "object-src 'none'",
  };
  for (const [name, exact] of Object.entries(expected)) {
    check(directive(csp, name) === exact, `preserva exacto: ${exact}`);
  }
}

// ---------- Formato: una línea, separadores '; ', sin doble espacio ----------
{
  const csp = buildCsp({ nonce: NONCE, isDev: false });
  check(!csp.includes("\n"), "formato: sin saltos de línea");
  check(!csp.includes(";;") && !/;\s{2,}/.test(csp), "formato: separadores '; ' limpios");
  check(!/\s{2,}/.test(csp), "formato: sin dobles espacios");
}

const total = passed + failures.length;
console.log(`\nCSP suite: ${passed}/${total} casos OK`);
if (failures.length > 0) {
  console.error(`\n${failures.length} FALLO(S):\n${failures.join("\n")}\n`);
  process.exit(1);
}
console.log("Todos los casos pasaron.\n");
