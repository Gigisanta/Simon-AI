import { after } from "next/server";
import { requireSession } from "@/lib/require-session";
import { sameOriginOk } from "@/lib/env-check";
import { CHAT_ROUTE_MAX_DURATION_S } from "@/lib/ai/limits";
import { runChatPipeline } from "@/lib/chat-pipeline/run";
import {
  fixedTextResponse,
  GENERATION_FALLBACK_REPLY,
} from "@/lib/chat-pipeline/respond";

// Adaptador fino (ADR-1): el cuerpo del chat vive en src/lib/chat-pipeline/
// (stages explícitos, testeables sin runtime de Next). Acá quedan SOLO las
// responsabilidades atadas al runtime: segment config (maxDuration), CSRF,
// sesión, el catch de infraestructura y la inyección de after() como `defer`.

// Holgura para: generateText completo (respuesta corta ≤1000 tokens) + hasta
// dos llamadas a la Moderation API (entrada y salida, timeout 3s c/u).
// Peor caso teórico con withTransientRetry (generación ~25s ×2 + fallback ~8s ×2
// + moderación) ronda 65-70s, por lo que 60 quedaba justo: 90 da margen real
// sin cambiar el timeout interno de cada llamada (ver lib/ai/retry.ts).
// No streameamos: generamos completo, moderamos y mostramos
// (decisión de diseño — ver docs/research-ux.md §2).
// Next exige que los segment config exports sean literales estáticamente
// analizables (no referencias importadas), así que el valor va inline.
// Debe coincidir con CHAT_ROUTE_MAX_DURATION_S (lib/ai/limits.ts, fuente única
// para retry.ts/provider.ts); el assert de abajo los mantiene sincronizados.
export const maxDuration: number = 90;
if (maxDuration !== CHAT_ROUTE_MAX_DURATION_S) {
  throw new Error(
    "maxDuration desincronizado de CHAT_ROUTE_MAX_DURATION_S (lib/ai/limits.ts)",
  );
}

export async function POST(req: Request) {
  // Telemetría (B4): momento de entrada para medir la latencia total del request.
  const requestStartedAt = Date.now();

  // Defensa CSRF en profundidad (M3): si el navegador manda Origin y no es el
  // nuestro, se corta acá (la cookie SameSite=Lax es la defensa principal).
  if (!sameOriginOk(req)) {
    return Response.json({ error: "Origen no permitido" }, { status: 403 });
  }

  const { session, response } = await requireSession(req);
  if (!session) return response;

  // --- Lote 1 (ciclo 15): catch de infraestructura ---
  // Todo el cuerpo (desde el gate de consentimiento) va en un try/catch: un fallo
  // transitorio de Postgres/Neon (P1001/P2024, pool agotado) en canUserChat, la
  // carga/creación de conversación, loadKnowledgeCards o el Promise.all de contexto
  // lanzaría un 500 crudo que ROMPE el contrato de streaming del cliente. Acá se
  // captura y se devuelve el MISMO texto amable de la rama fallback-error, logueando
  // el detalle server-side (nunca al menor). Los `return` tempranos legítimos (guards
  // 400/401/403, crisis/derivación, límite de sesión) NO se ven afectados: el catch
  // solo intercepta EXCEPCIONES, no returns; el orden de guards y los paths fijos de
  // seguridad (invariante M1) conservan su semántica.
  try {
    return await runChatPipeline({
      req,
      user: session.user,
      requestStartedAt,
      // after() (next/server, estable en Next 16) corre DESPUÉS de enviada la
      // respuesta — en serverless mantiene viva la función (equivalente a
      // waitUntil). Se inyecta como `defer` para que nada bajo lib/ importe
      // next/server (los stages corren bajo tsx sin runtime de Next).
      defer: (task) => after(task),
    });
  } catch (err) {
    // Fallo de infraestructura no controlado: nunca exponer detalles ni un 500 crudo
    // (rompería el stream del cliente). Se loguea server-side y se devuelve el texto
    // amable de reintento, con el mismo formato de UI message stream.
    console.error("[chat] error de infraestructura no controlado en POST:", err);
    return fixedTextResponse(GENERATION_FALLBACK_REPLY, { "cache-control": "no-store" });
  }
}
