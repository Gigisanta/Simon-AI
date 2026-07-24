import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import {
  GATE_COOKIE,
  GATE_PAGE_PATH,
  decideSiteLock,
} from "@/lib/site-lock";

/**
 * Proxy de Next 16 (el archivo antes llamado `middleware.ts`; en Next 16 la
 * convención es `proxy.ts` — ver node_modules/next/dist/docs/.../proxy.md).
 *
 * Responsabilidades, en orden:
 *
 *  1. Registro oculto (flag `NEXT_PUBLIC_SIGNUP_DISABLED=1`): el endpoint
 *     público de alta responde 403 SIEMPRE (aún con la cookie del candado).
 *     El alta server-side de menores no pasa por HTTP, así que sigue andando.
 *     No se elimina código: es un flag reversible.
 *
 *  2. Candado de sitio (fase privada, src/lib/site-lock.ts): TODA ruta salvo
 *     las exentas exige la cookie firmada `__Host-simon-gate`. Sin cookie:
 *     HTML → redirect a /gate; API → 401. FAIL-CLOSED: producción sin
 *     `SITE_LOCK_KEY` responde 503 a todo.
 *
 *  3. CSP con nonce por request (solo rutas HTML): Next parsea la cabecera
 *     `Content-Security-Policy` del request, extrae el `'nonce-…'` y lo aplica
 *     a sus propios scripts; además va en `x-nonce` para los `<script>` inline
 *     propios (ver src/app/layout.tsx). Implica render dinámico (intrínseco al
 *     enfoque de nonce, docs de Next).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1) Registro oculto por flag (la UI también lo esconde; esto es la barrera
  //    server-side para que nadie pueda registrarse "a mano" contra la API).
  if (
    process.env.NEXT_PUBLIC_SIGNUP_DISABLED === "1" &&
    pathname.startsWith("/api/auth/sign-up")
  ) {
    return NextResponse.json(
      { error: "El registro está deshabilitado por ahora." },
      { status: 403 },
    );
  }

  // 2) Candado de sitio — fail-closed en producción.
  const decision = await decideSiteLock({
    pathname,
    cookieValue: request.cookies.get(GATE_COOKIE)?.value,
    secret: process.env.SITE_LOCK_KEY,
    isProd: process.env.NODE_ENV === "production",
    nowMs: Date.now(),
  });
  if (decision === "unavailable") {
    return new NextResponse("Sitio en mantenimiento.", {
      status: 503,
      headers: { "retry-after": "600" },
    });
  }
  if (decision === "unauthorized") {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (decision === "redirect") {
    return NextResponse.redirect(new URL(GATE_PAGE_PATH, request.url));
  }

  // 3) CSP con nonce — solo para rutas que rinden HTML. Las API no la
  //    necesitan, y los prefetch de next/link no rinden HTML nuevo (antes los
  //    excluía el matcher, pero el candado SÍ tiene que verlos, así que la
  //    exclusión vive acá).
  if (pathname.startsWith("/api/")) return NextResponse.next();
  if (
    request.headers.has("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch"
  ) {
    return NextResponse.next();
  }

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
  // El candado necesita ver TODO (HTML, API y prefetches). Solo se excluye lo
  // que jamás debe bloquearse: chunks/assets compilados (sin ellos ni /gate
  // rinde), la optimización de imágenes y el favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
