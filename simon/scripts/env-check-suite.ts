/**
 * Suite ejecutable del chequeo de entorno de producción (sin framework — tsx).
 *
 *   pnpm env-check-suite
 *
 * Testea SOLO el núcleo puro `evaluateProdEnv` (sin tocar process.env, sin
 * lanzar, sin loguear): decide qué config es HARD-FAIL (arranque inseguro) vs
 * WARN (feature degradada pero app segura).
 *
 * Camino crítico de arranque: un error acá deja arrancar una app insegura
 * (auth mal configurada) o, al revés, tumba el arranque por una feature que
 * degrada de forma segura. Se cubre cada rama explícitamente.
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
import { createChecker } from "./suite-helpers";
import { evaluateProdEnv, type ProdEnvSnapshot } from "../src/lib/env-check";

const { check, done } = createChecker("Env-check suite");

// Snapshot "todo configurado": ninguna rama disparada.
const full: ProdEnvSnapshot = {
  BETTER_AUTH_SECRET: "s3cr3t",
  BETTER_AUTH_URL: "https://simon.example.com",
  RESEND_API_KEY: "re_xxx",
  UPSTASH_REDIS_REST_URL: "https://u.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "tok",
  AI_API_KEY: "ai_xxx",
};

function has(list: string[], needle: string): boolean {
  return list.some((s) => s.includes(needle));
}

// ---------- Config completa → sin fallos ni advertencias ----------
{
  const r = evaluateProdEnv(full);
  check(r.missing.length === 0, "full: sin hard-fail");
  check(r.warnings.length === 0, "full: sin warnings");
}

// ---------- HARD-FAIL: seguridad de arranque (auth) ----------
{
  const r = evaluateProdEnv({ ...full, BETTER_AUTH_SECRET: undefined });
  check(has(r.missing, "BETTER_AUTH_SECRET"), "hard-fail: falta BETTER_AUTH_SECRET");

  const r2 = evaluateProdEnv({ ...full, BETTER_AUTH_URL: undefined });
  check(has(r2.missing, "BETTER_AUTH_URL"), "hard-fail: falta BETTER_AUTH_URL");

  // http (no https) en prod → hard-fail.
  const r3 = evaluateProdEnv({ ...full, BETTER_AUTH_URL: "http://simon.example.com" });
  check(has(r3.missing, "BETTER_AUTH_URL"), "hard-fail: BETTER_AUTH_URL http (no https)");

  // https válida no dispara la rama de URL.
  const r4 = evaluateProdEnv({ ...full, BETTER_AUTH_URL: "https://x.y" });
  check(!has(r4.missing, "BETTER_AUTH_URL"), "ok: BETTER_AUTH_URL https no es hard-fail");
}

// ---------- WARN (no hard-fail): features que degradan de forma segura ----------
{
  // AI_API_KEY es la clave del cambio: núcleo del producto, PERO warn — el chat
  // degrada seguro (mensaje amable + capas fail-closed). NUNCA hard-fail.
  const r = evaluateProdEnv({ ...full, AI_API_KEY: undefined });
  check(r.missing.length === 0, "warn: falta AI_API_KEY NO es hard-fail (arranca)");
  check(has(r.warnings, "AI_API_KEY"), "warn: falta AI_API_KEY advierte");

  const r2 = evaluateProdEnv({ ...full, RESEND_API_KEY: undefined });
  check(r2.missing.length === 0, "warn: falta RESEND NO es hard-fail");
  check(has(r2.warnings, "RESEND_API_KEY"), "warn: falta RESEND advierte");

  // Upstash: falta cualquiera de las dos credenciales → warn.
  const r3 = evaluateProdEnv({ ...full, UPSTASH_REDIS_REST_URL: undefined });
  check(has(r3.warnings, "Upstash"), "warn: falta UPSTASH_URL advierte");
  const r4 = evaluateProdEnv({ ...full, UPSTASH_REDIS_REST_TOKEN: undefined });
  check(has(r4.warnings, "Upstash"), "warn: falta UPSTASH_TOKEN advierte");
}

// ---------- Combinado: hard-fail y warnings coexisten ----------
{
  const r = evaluateProdEnv({});
  check(has(r.missing, "BETTER_AUTH_SECRET") && has(r.missing, "BETTER_AUTH_URL"), "combo: ambos secretos de auth faltan");
  check(has(r.warnings, "AI_API_KEY"), "combo: warn AI presente aun con hard-fail");
  check(has(r.warnings, "RESEND_API_KEY"), "combo: warn RESEND presente");
  check(has(r.warnings, "Upstash"), "combo: warn Upstash presente");
}

done();
