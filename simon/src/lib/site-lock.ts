/**
 * Candado de sitio (fase privada) — solo quien conoce `SITE_LOCK_KEY` entra.
 *
 * Diseño:
 *  - `/gate` (página) + `/api/gate` (POST con la clave) emiten una cookie
 *    firmada `__Host-simon-gate` = `v1.<expMs>.<HMAC-SHA256(secret, "v1|expMs")>`.
 *  - El proxy verifica la cookie en TODAS las rutas (HTML y API) salvo las
 *    exentas: la propia puerta, los crons (tienen su propia auth por
 *    CRON_SECRET) y estáticos no sensibles (robots/sitemap/manifest/íconos).
 *  - FAIL-CLOSED: en producción sin `SITE_LOCK_KEY` se responde 503 a todo —
 *    un env faltante NUNCA deja el sitio abierto. En dev sin clave el candado
 *    queda inactivo (DX local).
 *  - Web Crypto puro (sin Buffer/node:crypto): corre igual en el proxy y en
 *    Node, y la lógica es determinística y testeable
 *    (scripts/site-lock-suite.ts).
 */

export const GATE_COOKIE = "__Host-simon-gate";
export const GATE_PAGE_PATH = "/gate";
export const GATE_API_PATH = "/api/gate";
/** 30 días: re-tipear la clave una vez por mes es aceptable para el dueño. */
export const GATE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_VERSION = "v1";

function utf8(s: string): Uint8Array<ArrayBuffer> {
  // El cast fija el generic a ArrayBuffer (TextEncoder tipa ArrayBufferLike,
  // pero siempre aloca un ArrayBuffer plano) — lo que exige BufferSource.
  return new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, utf8(payload));
  return b64url(new Uint8Array(sig));
}

/** Comparación sin cortocircuito (mismo tiempo para strings del mismo largo). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signGateToken(
  secret: string,
  expiresAtMs: number,
): Promise<string> {
  const exp = Math.floor(expiresAtMs);
  const sig = await hmacSha256(secret, `${TOKEN_VERSION}|${exp}`);
  return `${TOKEN_VERSION}.${exp}.${sig}`;
}

export async function verifyGateToken(
  secret: string,
  token: string,
  nowMs: number,
): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [version, expRaw, sig] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (!/^\d{1,15}$/.test(expRaw)) return false;
  const exp = Number(expRaw);
  if (!Number.isSafeInteger(exp) || exp <= nowMs) return false;
  const expected = await hmacSha256(secret, `${TOKEN_VERSION}|${exp}`);
  return timingSafeEqualStr(sig, expected);
}

/**
 * Rutas fuera del candado: la puerta misma, los crons (protegidos aparte por
 * CRON_SECRET, y Vercel Cron no puede mandar nuestra cookie) y estáticos que
 * no filtran nada (robots/sitemap/manifest/íconos, para que la página de la
 * puerta no se rinda rota).
 */
export function isLockExemptPath(pathname: string): boolean {
  return (
    pathname === GATE_PAGE_PATH ||
    pathname === GATE_API_PATH ||
    pathname.startsWith("/api/cron/") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/icon.svg" ||
    pathname === "/apple-icon.png"
  );
}

export type SiteLockDecision =
  | "allow"
  | "redirect"
  | "unauthorized"
  | "unavailable";

/** Núcleo puro de la decisión del proxy (testeable sin NextRequest). */
export async function decideSiteLock(opts: {
  pathname: string;
  cookieValue: string | undefined;
  secret: string | undefined;
  isProd: boolean;
  nowMs: number;
}): Promise<SiteLockDecision> {
  if (isLockExemptPath(opts.pathname)) return "allow";
  // Fail-closed: producción sin clave configurada = sitio cerrado (503).
  if (!opts.secret) return opts.isProd ? "unavailable" : "allow";
  if (
    opts.cookieValue &&
    (await verifyGateToken(opts.secret, opts.cookieValue, opts.nowMs))
  ) {
    return "allow";
  }
  return opts.pathname.startsWith("/api/") ? "unauthorized" : "redirect";
}
