/**
 * Construcción de la Content-Security-Policy con nonce por request.
 *
 * Fuente única de verdad de la CSP: este helper, consumido por `src/proxy.ts`
 * (el Proxy — antes "middleware" — de Next 16). El resto de headers de seguridad
 * estáticos (X-Frame-Options, HSTS, etc.) siguen en `next.config.ts`; la CSP se
 * saca de ahí para no emitir dos cabeceras `Content-Security-Policy` en
 * conflicto (cuando hay dos, el navegador aplica la intersección más estricta).
 *
 * Por qué nonce y no `'unsafe-inline'`: con `'unsafe-inline'` en `script-src`
 * cualquier `<script>` inyectado (XSS) se ejecuta. El nonce es un valor único e
 * impredecible por request; solo los scripts que lo llevan corren. App de chat
 * para menores → la protección anti-XSS no es negociable.
 *
 * `'strict-dynamic'`: los navegadores modernos que lo soportan ignoran `'self'`
 * y allowlists de host en `script-src` y confían solo en scripts propagados por
 * el nonce. El bootstrap de Next lleva el nonce y carga sus chunks por esa
 * cadena de confianza, así que sigue funcionando sin listar cada chunk. Es el
 * patrón oficial de Next 16 (docs/01-app/02-guides/content-security-policy.md).
 *
 * Función PURA: no toca `process.env`, no genera el nonce ni lee headers. El
 * caller pasa `nonce` e `isDev`. Así es testeable de forma determinística.
 */

export interface BuildCspOptions {
  /** Nonce ya generado (base64) para este request. */
  nonce: string;
  /**
   * Dev habilita `'unsafe-eval'`: React usa `eval()` en desarrollo para
   * reconstruir stacks de error del server en el browser. En prod NO se usa
   * ("React will never use eval() in production mode").
   */
  isDev: boolean;
}

/**
 * Devuelve el valor de la cabecera `Content-Security-Policy` en una sola línea.
 *
 * Se preservan EXACTAMENTE las directivas previas de `next.config.ts`; lo único
 * que cambia respecto a la CSP estática es `script-src`, que pasa de
 * `'self' 'unsafe-inline'` a `'self' 'nonce-…' 'strict-dynamic'`.
 */
export function buildCsp({ nonce, isDev }: BuildCspOptions): string {
  const scriptSrc = [
    "script-src 'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // 'unsafe-eval' SOLO en dev (ver arriba); en prod queda fuera.
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    scriptSrc,
    // style-src conserva 'unsafe-inline': Tailwind v4 y next/font inyectan
    // estilos inline; no se noncea para no romperlos (igual que la CSP previa).
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
