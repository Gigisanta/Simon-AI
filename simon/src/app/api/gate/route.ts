import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  GATE_COOKIE,
  GATE_TOKEN_TTL_MS,
  signGateToken,
} from "@/lib/site-lock";

export const runtime = "nodejs";

/**
 * Puerta del candado de sitio: valida `SITE_LOCK_KEY` y emite la cookie
 * firmada que el proxy exige en todo el sitio (ver src/lib/site-lock.ts).
 *
 * - Anti fuerza bruta por IP: 5/min y 20/hora (Upstash si está, si no memoria).
 * - Comparación en tiempo constante sobre digests SHA-256 (longitud fija).
 * - Fail-closed: sin `SITE_LOCK_KEY` responde 503 (coherente con el proxy).
 * - Respuesta de error genérica (401) — no distingue clave corta/larga/mal
 *   formada para no dar señal al que prueba.
 */
export async function POST(req: Request) {
  const ip =
    (req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0]!.trim() ||
    "unknown";

  for (const [suffix, max, windowMs] of [
    ["m", 5, 60_000],
    ["h", 20, 3_600_000],
  ] as const) {
    const rl = await checkRateLimit(`gate:${suffix}:${ip}`, max, windowMs);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Demasiados intentos. Esperá un momento." },
        {
          status: 429,
          headers: { "retry-after": String(rl.retryAfterSeconds) },
        },
      );
    }
  }

  const secret = process.env.SITE_LOCK_KEY;
  if (!secret) {
    console.error(
      "[gate] SITE_LOCK_KEY ausente: la puerta no puede validar claves (fail-closed).",
    );
    return NextResponse.json({ error: "No disponible." }, { status: 503 });
  }

  const body: unknown = await req.json().catch(() => null);
  const raw = (body as { key?: unknown } | null)?.key;
  const key = typeof raw === "string" ? raw : "";
  if (key.length === 0 || key.length > 256) {
    return NextResponse.json({ error: "Clave incorrecta." }, { status: 401 });
  }

  const ok = timingSafeEqual(
    createHash("sha256").update(key, "utf8").digest(),
    createHash("sha256").update(secret, "utf8").digest(),
  );
  if (!ok) {
    console.warn(`[gate] intento fallido desde ${ip}`);
    return NextResponse.json({ error: "Clave incorrecta." }, { status: 401 });
  }

  const token = await signGateToken(secret, Date.now() + GATE_TOKEN_TTL_MS);
  const res = new NextResponse(null, { status: 204 });
  res.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(GATE_TOKEN_TTL_MS / 1000),
  });
  return res;
}
