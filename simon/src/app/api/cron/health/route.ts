import { generateText } from "ai";
import { prisma } from "@/lib/prisma";
import { isAuthorizedCron } from "@/lib/retention";
import {
  buildClient,
  parseProviderList,
  type ProviderConfig,
} from "@/lib/ai/provider";
import {
  aggregateHealth,
  type ComponentResult,
  type HealthComponents,
} from "@/lib/health-check";

/**
 * Health-check sintético — cron cada 10 min, INDEPENDIENTE del tráfico.
 *
 * Chequea, en paralelo:
 *   - DB: `SELECT 1` vía el cliente prisma existente, timeout corto.
 *   - Upstash REST `PING` (solo si UPSTASH_REDIS_REST_URL/TOKEN están, si no
 *     "skip" — igual que el fallback in-memory de rate-limit.ts trata la
 *     ausencia de Upstash como config opcional, no como fallo).
 *   - Proveedor LLM primario y fallback (ADR-3): una generación MÍNIMA (prompt
 *     de 1 palabra, ≤5 tokens de salida, timeout ≤8s) usando `buildClient`
 *     DIRECTO (no `resolveProvider`): acá se quiere el estado de CADA
 *     proveedor por separado, no "el primero que responda" con
 *     failover/circuit-breaker. Sin pasar por el pipeline de chat: no toca
 *     Conversation/Message ni ninguna tabla de conversaciones.
 *
 * Agregación (crítico → 503) en lib/health-check.ts (función pura, testeada
 * con fakes en scripts/health-suite.ts).
 *
 * SEGURIDAD: mismo patrón EXACTO que /api/cron/purge — CRON_SECRET fail-closed
 * (sin secret → 503, nunca abierto) + comparación timing-safe.
 */
export const dynamic = "force-dynamic";
// DB + Redis + 2 proveedores corren en paralelo (Promise.all): el techo real es
// el probe más lento (proveedor LLM, ≤8s). Margen para el overhead del handler.
export const maxDuration = 15;

const NO_STORE = { "cache-control": "no-store" };

const DB_HEALTH_TIMEOUT_MS = 3_000;
const REDIS_HEALTH_TIMEOUT_MS = 2_000;
const PROVIDER_HEALTH_TIMEOUT_MS = 8_000;
const PROVIDER_HEALTH_MAX_TOKENS = 5;

/** Timeout genérico: rechaza a los `ms` si `promise` no resolvió antes. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout tras ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function checkDb(): Promise<ComponentResult> {
  const start = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DB_HEALTH_TIMEOUT_MS);
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    console.error("[cron/health] DB falló:", err instanceof Error ? err.message : err);
    return { status: "fail", latencyMs: Date.now() - start };
  }
}

async function checkRedis(): Promise<ComponentResult> {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!restUrl || !restToken) return { status: "skip", latencyMs: 0 };

  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REDIS_HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${restUrl.replace(/\/$/, "")}/ping`, {
      headers: { authorization: `Bearer ${restToken}` },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Upstash respondió ${res.status}`);
    const data = (await res.json()) as { result?: string };
    if (data?.result !== "PONG") throw new Error("PING sin PONG en la respuesta");
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    console.error("[cron/health] Redis PING falló:", err instanceof Error ? err.message : err);
    return { status: "fail", latencyMs: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

async function checkProvider(config: ProviderConfig | undefined): Promise<ComponentResult> {
  if (!config) return { status: "skip", latencyMs: 0 };
  const start = Date.now();
  try {
    // tier "small": es el modelo barato pensado para tareas auxiliares — el
    // health-check no necesita el modelo grande de conversación.
    const client = buildClient(config, "small");
    await generateText({
      model: client.model,
      prompt: "hola",
      maxOutputTokens: PROVIDER_HEALTH_MAX_TOKENS,
      abortSignal: AbortSignal.timeout(PROVIDER_HEALTH_TIMEOUT_MS),
    });
    return { status: "ok", latencyMs: Date.now() - start };
  } catch (err) {
    console.error(
      `[cron/health] proveedor "${config.name}" falló:`,
      err instanceof Error ? err.message : err,
    );
    return { status: "fail", latencyMs: Date.now() - start };
  }
}

async function handleHealth(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  // Fail-closed: sin secret configurado no se ejecuta NUNCA (mismo criterio que purge).
  if (!secret) {
    console.error(
      "[cron/health] CRON_SECRET no configurado — 503 (el health-check no corre; nunca abierto)",
    );
    return Response.json(
      { error: "Cron no configurado" },
      { status: 503, headers: NO_STORE },
    );
  }
  if (!isAuthorizedCron(req.headers.get("authorization"), secret)) {
    return Response.json(
      { error: "No autorizado" },
      { status: 401, headers: NO_STORE },
    );
  }

  const providers = parseProviderList(process.env);
  const [db, redis, providerPrimary, providerFallback] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkProvider(providers[0]),
    checkProvider(providers[1]),
  ]);

  const components: HealthComponents = { db, redis, providerPrimary, providerFallback };
  const { ok, httpStatus } = aggregateHealth(components);

  return Response.json({ ok, components }, { status: httpStatus, headers: NO_STORE });
}

// Vercel Cron dispara con GET + Authorization: Bearer $CRON_SECRET.
export async function GET(req: Request) {
  return handleHealth(req);
}
