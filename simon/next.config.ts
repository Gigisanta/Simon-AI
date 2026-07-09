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
  // CSP pragmática, sin nonce (el App Router usa inline scripts y hoy no
  // montamos middleware de nonce): todo self, sin orígenes externos. Fonts
  // self-hosted por next/font y SVGs/gradientes inline quedan cubiertos.
  // 'unsafe-eval' SOLO en dev: React lo usa para debugging en development
  // ("React will never use eval() in production mode"); en prod no va.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
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
