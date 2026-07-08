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

/**
 * En producción exige `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL` (https) — sin
 * eso la app no debe arrancar (lanza Error). Si faltan `RESEND_API_KEY` o las
 * credenciales de Upstash solo advierte por console.error (la app funciona
 * degradada: sin emails / con rate limiting por instancia).
 *
 * NO corre durante `next build` (NEXT_PHASE=phase-production-build): el build
 * no tiene por qué conocer los secretos de runtime.
 */
export function assertProdEnv(): void {
  if (prodEnvChecked) return;
  prodEnvChecked = true;

  if (process.env.NODE_ENV !== "production") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const missing: string[] = [];
  if (!process.env.BETTER_AUTH_SECRET) missing.push("BETTER_AUTH_SECRET");
  const baseUrl = process.env.BETTER_AUTH_URL;
  if (!baseUrl) {
    missing.push("BETTER_AUTH_URL");
  } else if (!baseUrl.startsWith("https://")) {
    missing.push("BETTER_AUTH_URL (en producción debe ser https)");
  }
  if (missing.length > 0) {
    throw new Error(
      `[env] Configuración de producción incompleta: ${missing.join(", ")}. ` +
        "La app no puede arrancar de forma segura sin esto.",
    );
  }

  if (!process.env.RESEND_API_KEY) {
    console.error(
      "[env] RESEND_API_KEY no configurada — no van a salir emails " +
        "(verificación de tutores ni alertas de crisis).",
    );
  }
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    console.error(
      "[env] Upstash no configurado — el rate limiting queda en memoria POR " +
        "INSTANCIA: insuficiente en serverless con múltiples instancias.",
    );
  }
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
