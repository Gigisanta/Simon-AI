import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

/**
 * Proxy de Next 16 (el archivo antes llamado `middleware.ts`; en Next 16 la
 * convención es `proxy.ts` — ver node_modules/next/dist/docs/.../proxy.md).
 *
 * Única responsabilidad: generar un nonce por request y emitir la CSP con él.
 * Next parsea la cabecera `Content-Security-Policy` del request, extrae el
 * `'nonce-…'` y lo aplica automáticamente a sus propios scripts (runtime de
 * React/Next, chunks de la página y `<Script>`). Además exponemos el nonce por
 * `x-nonce` para los `<script>` inline propios (ver `src/app/layout.tsx`).
 *
 * Implica render dinámico: al llevar nonce por request, las páginas no pueden
 * prerenderarse estáticas. `aprender` y `tutor` ya eran `force-dynamic`; la
 * landing `/` pasa de shell estático a dinámico. Aceptable para una app de chat
 * detrás de auth y es intrínseco al enfoque de nonce (docs de Next).
 */
export function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  // Nonce impredecible por request (patrón oficial de Next): base64 de un UUID.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp({ nonce, isDev });

  // El nonce viaja a la app por un header de request (lo lee el layout).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Y la CSP efectiva va en la respuesta al navegador.
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Corre en todas las rutas HTML, excluyendo lo que no necesita CSP con nonce:
  // API routes, assets estáticos, optimización de imágenes y el favicon. Además
  // se saltan los prefetch de next/link (no rinden HTML nuevo).
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
