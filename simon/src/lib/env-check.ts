/**
 * Chequeos de entorno y de origen (B2 + M3).
 *
 * - `assertProdEnv()`: valida la configuración mínima de producción al primer
 *   import server-side (lib/auth.ts la invoca a nivel de módulo).
 * - `sameOriginOk(req)` / `originAllowed(...)`: defensa CSRF en profundidad
 *   para los handlers de estado (POST/DELETE/PATCH) fuera de better-auth.
 *   La cookie de sesión con SameSite=Lax sigue siendo la defensa principal;
 *   esto corta además cualquier request cross-site que un navegador etiquete
 *   con su header `Origin`.
 */

let prodEnvChecked = false;

/** Snapshot de las envs relevantes para el chequeo de producción. */
export interface ProdEnvSnapshot {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  RESEND_API_KEY?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  AI_API_KEY?: string;
  /** "production" | "preview" | "development" en Vercel; undefined self-hosted. */
  VERCEL_ENV?: string;
}

export interface ProdEnvReport {
  /** Config de seguridad ausente/incorrecta → hard-fail (la app no arranca). */
  missing: string[];
  /** Config de features ausente → warn (la app arranca degradada pero SEGURA). */
  warnings: string[];
}

/**
 * Núcleo puro y testeable del chequeo (scripts/env-check-suite.ts): decide qué
 * es hard-fail vs warn a partir de un snapshot de env, sin tocar process.env,
 * sin lanzar y sin loguear.
 *
 * Criterio (el mismo que aplica assertProdEnv):
 *  - HARD-FAIL la config de SEGURIDAD del arranque: `BETTER_AUTH_SECRET` y
 *    `BETTER_AUTH_URL` (que además debe ser https en prod). Sin eso la app no
 *    puede correr de forma segura.
 *  - HARD-FAIL Upstash SOLO en `VERCEL_ENV=production` (ADR-6): serverless
 *    multi-instancia con rate-limit/secondary-storage in-memory POR instancia
 *    es un bypass real del rate limiting (producto para menores — inaceptable).
 *    En dev/preview/self-hosted la degradación sigue permitida (warn).
 *  - WARN la config de FEATURES cuya ausencia deja la app funcional y SEGURA:
 *      · RESEND_API_KEY → sin emails (verificación de tutores, alertas).
 *      · Upstash (fuera de VERCEL_ENV=production) → rate limiting en memoria.
 *      · AI_API_KEY → chat (núcleo del producto) sin proveedor: la ruta
 *        /api/chat responde un mensaje amable y las capas de seguridad siguen
 *        fail-closed. El resto (auth, panel del tutor/a, alta de menores) sigue
 *        andando, así que tumbar el arranque sería desproporcionado; se advierte
 *        fuerte para que un deploy mal configurado se vea en los logs.
 */
export function evaluateProdEnv(env: ProdEnvSnapshot): ProdEnvReport {
  const missing: string[] = [];
  if (!env.BETTER_AUTH_SECRET) missing.push("BETTER_AUTH_SECRET");
  if (!env.BETTER_AUTH_URL) {
    missing.push("BETTER_AUTH_URL");
  } else if (!env.BETTER_AUTH_URL.startsWith("https://")) {
    missing.push("BETTER_AUTH_URL (en producción debe ser https)");
  }

  const warnings: string[] = [];
  if (!env.RESEND_API_KEY) {
    warnings.push(
      "[env] RESEND_API_KEY no configurada — no van a salir emails " +
        "(verificación de tutores ni alertas de crisis).",
    );
  }
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    if (env.VERCEL_ENV === "production") {
      // ADR-6: en Vercel production el rate limiting in-memory por instancia
      // equivale a NO tener rate limiting (cada instancia cuenta de cero).
      missing.push(
        "UPSTASH_REDIS_REST_URL/TOKEN (obligatorios en VERCEL_ENV=production: " +
          "rate limiting in-memory por instancia = bypass real multi-instancia)",
      );
    } else {
      warnings.push(
        "[env] Upstash no configurado — el rate limiting queda en memoria POR " +
          "INSTANCIA: insuficiente en serverless con múltiples instancias.",
      );
    }
  }
  if (!env.AI_API_KEY) {
    warnings.push(
      "[env] AI_API_KEY no configurada — el chat (núcleo del producto) no va a " +
        "generar respuestas: cada mensaje del menor recibe el aviso de proveedor " +
        "sin configurar. Configurá el proveedor de IA para habilitar el chat.",
    );
  }
  return { missing, warnings };
}

/**
 * En producción exige `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL` (https) — sin
 * eso la app no debe arrancar (lanza Error). En `VERCEL_ENV=production` exige
 * además Upstash (ADR-6). Si faltan `RESEND_API_KEY`, `AI_API_KEY` o Upstash
 * fuera de Vercel production, solo advierte por console.error (la app funciona
 * degradada pero segura: sin emails / rate limiting por instancia / chat sin
 * proveedor con mensaje amable). Ver `evaluateProdEnv`.
 *
 * NO corre durante `next build` (NEXT_PHASE=phase-production-build): el build
 * no tiene por qué conocer los secretos de runtime.
 */
export function assertProdEnv(): void {
  if (prodEnvChecked) return;
  prodEnvChecked = true;

  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { missing, warnings } = evaluateProdEnv({
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    AI_API_KEY: process.env.AI_API_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
  if (missing.length > 0) {
    throw new Error(
      `[env] Configuración de producción incompleta: ${missing.join(", ")}. ` +
        "La app no puede arrancar de forma segura sin esto.",
    );
  }
  for (const w of warnings) console.error(w);
}

/**
 * Núcleo puro y testeable del chequeo de origen (scripts/guardian-suite.ts).
 *
 * Política:
 * - Sin header `Origin` (curl, server-to-server, misma-origen en algunos
 *   navegadores) → permitir: la cookie SameSite=Lax sigue siendo la defensa.
 * - `Origin: null` (iframes sandboxed, redirects opacos) → rechazar.
 * - Con `baseUrl` (BETTER_AUTH_URL): el origin debe coincidir exactamente
 *   (scheme + host + puerto).
 * - Sin `baseUrl` (dev): el host del origin debe coincidir con el Host del
 *   request.
 */
export function originAllowed(
  origin: string | null,
  opts: { baseUrl?: string | null; requestHost?: string | null },
): boolean {
  if (!origin) return true;
  if (origin === "null") return false;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false; // Origin malformado: rechazar.
  }

  if (opts.baseUrl) {
    try {
      return originUrl.origin === new URL(opts.baseUrl).origin;
    } catch {
      // baseUrl malformada: caer al chequeo por Host (mejor que abrir todo).
    }
  }
  if (opts.requestHost) return originUrl.host === opts.requestHost;
  return false;
}

/** Chequeo de origen sobre el Request real (usa BETTER_AUTH_URL si existe). */
export function sameOriginOk(req: Request): boolean {
  return originAllowed(req.headers.get("origin"), {
    baseUrl: process.env.BETTER_AUTH_URL,
    requestHost: req.headers.get("host"),
  });
}
