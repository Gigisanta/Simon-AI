import type { NextConfig } from "next";

const securityHeaders = [
  // La app no debe poder embeberse en iframes de terceros (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // La app no usa cámara/micrófono/geolocalización.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // HSTS: fuerza HTTPS 2 años, subdominios incluidos, apto lista de preload.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  // NOTA: la Content-Security-Policy YA NO se emite acá. Pasó a ser por-request
  // con nonce en `src/proxy.ts` (helper puro en `src/lib/csp.ts`), para eliminar
  // `'unsafe-inline'` de `script-src` en producción. Debe existir una sola
  // cabecera CSP: emitir también una estática acá crearía dos CSP en conflicto
  // (el navegador aplicaría la intersección). `frame-ancestors 'none'` vive
  // ahora dentro de esa CSP; `X-Frame-Options: DENY` de arriba lo respalda.
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
