/**
 * Suite de session-limit.ts (M-S7, M-F1) — límite de uso continuo del menor.
 *
 *   pnpm session-limit-suite
 *
 * Testea SOLO lógica pura y determinística (sin DB, sin red): a quién aplica el
 * límite, la detección del primer mensaje de sesión (disclosure de IA), la
 * máquina de estados ok/warn/over por duración de racha, y la forma de la query
 * de ventana (anti-regresión del bug `take:60` que dejaba eludir el corte de 45').
 *
 * Camino crítico de seguridad (research-safety §2.1): un menor no debe poder
 * chatear indefinidamente; el corte a 45' depende de traer TODA la racha. Sale
 * con código 1 si algún caso falla (gate de CI).
 */
import { createChecker } from "./suite-helpers";
import {
  sessionLimitApplies,
  isFirstOfSession,
  sessionState,
  sessionWindowQuery,
  SESSION_GAP_MS,
  SESSION_WARN_MS,
  SESSION_OVER_MS,
  SESSION_WARN_DEDUP_TTL_MS,
} from "../src/lib/session-limit";

const { check, done } = createChecker("Session-limit suite");

const NOW = new Date("2026-01-01T12:00:00Z");
const nowMs = NOW.getTime();
// Timestamp a `min` minutos ANTES de NOW.
const minsAgo = (min: number) => new Date(nowMs - min * 60_000);

// ---------- 0. Invariantes de constantes ----------
{
  check(SESSION_GAP_MS === 30 * 60_000, "SESSION_GAP_MS = 30 min");
  check(SESSION_WARN_MS === 30 * 60_000, "SESSION_WARN_MS = 30 min");
  check(SESSION_OVER_MS === 45 * 60_000, "SESSION_OVER_MS = 45 min");
  check(
    SESSION_WARN_DEDUP_TTL_MS === SESSION_OVER_MS - SESSION_WARN_MS,
    "SESSION_WARN_DEDUP_TTL_MS = OVER - WARN (15 min)",
  );
  check(SESSION_WARN_DEDUP_TTL_MS === 15 * 60_000, "SESSION_WARN_DEDUP_TTL_MS = 15 min");
}

// ---------- 1. sessionLimitApplies: solo menores ----------
{
  check(sessionLimitApplies("child") === true, "child → aplica el límite");
  check(sessionLimitApplies("guardian") === false, "guardian → NO aplica");
  check(sessionLimitApplies(null) === false, "null → NO aplica");
  check(sessionLimitApplies(undefined) === false, "undefined → NO aplica");
  check(sessionLimitApplies("admin") === false, "otro rol → NO aplica");
}

// ---------- 2. isFirstOfSession: ¿abre sesión nueva? ----------
{
  // Sin timestamps de assistant → primer mensaje de sesión.
  check(isFirstOfSession([], NOW) === true, "sin respuestas previas → primer mensaje");

  // Respuesta reciente (dentro del gap) → NO es el primero.
  check(isFirstOfSession([minsAgo(5)], NOW) === false, "respuesta hace 5 min → NO es el primero");

  // Última respuesta hace ≥30 min → sesión nueva.
  check(isFirstOfSession([minsAgo(31)], NOW) === true, "última respuesta hace 31 min → primer mensaje");

  // Borde exacto: gap == 30 min NO es < gap → cuenta como sesión nueva.
  check(isFirstOfSession([minsAgo(30)], NOW) === true, "gap exactamente 30 min → primer mensaje (borde)");

  // Justo por debajo del gap → NO es el primero.
  check(
    isFirstOfSession([new Date(nowMs - (SESSION_GAP_MS - 1000))], NOW) === false,
    "gap 29m59s → NO es el primero",
  );

  // Timestamps futuros se ignoran; sin ninguno válido reciente → primer mensaje.
  check(
    isFirstOfSession([new Date(nowMs + 60_000)], NOW) === true,
    "timestamp futuro se ignora → primer mensaje",
  );

  // Mezcla: uno viejo y uno reciente → NO es el primero (basta uno dentro del gap).
  check(
    isFirstOfSession([minsAgo(90), minsAgo(3)], NOW) === false,
    "hay una respuesta reciente entre varias → NO es el primero",
  );
}

// ---------- 3. sessionState: ok / warn / over por duración de racha ----------
{
  // Sin mensajes → ok (duración 0).
  check(sessionState([], NOW) === "ok", "sin mensajes → ok");

  // Un solo mensaje reciente → ok (racha ~0).
  check(sessionState([minsAgo(1)], NOW) === "ok", "un mensaje hace 1 min → ok");

  // Racha contigua de 20 min (gaps de 10 < 30) → ok (< 30 min).
  check(
    sessionState([minsAgo(0), minsAgo(10), minsAgo(20)], NOW) === "ok",
    "racha de 20 min → ok",
  );

  // Racha contigua que arranca hace 35 min → warn (30 ≤ dur < 45).
  check(
    sessionState([minsAgo(5), minsAgo(20), minsAgo(35)], NOW) === "warn",
    "racha de 35 min → warn",
  );

  // Borde exacto: racha CONTIGUA de 30 min → warn. (Los gaps intermedios deben
  // ser < 30 min: un gap == 30 min cortaría la racha, por eso el paso a 20 min.)
  check(
    sessionState([minsAgo(0), minsAgo(20), minsAgo(30)], NOW) === "warn",
    "racha contigua de 30 min exacta → warn (borde)",
  );

  // Racha de 50 min contigua → over (≥ 45).
  check(
    sessionState([minsAgo(0), minsAgo(15), minsAgo(30), minsAgo(45), minsAgo(50)], NOW) === "over",
    "racha de 50 min → over",
  );

  // Borde exacto: racha de 45 min → over.
  check(sessionState([minsAgo(0), minsAgo(20), minsAgo(45)], NOW) === "over", "racha de 45 min exacta → over (borde)");

  // Un gap ≥30 min corta la racha: mensajes viejos NO cuentan.
  // Reciente (racha 5 min) + bloque viejo separado por 40 min → ok.
  check(
    sessionState([minsAgo(0), minsAgo(5), minsAgo(45), minsAgo(50)], NOW) === "ok",
    "gap de 40 min corta la racha: solo cuenta el bloque reciente → ok",
  );

  // Timestamps futuros se descartan (no adelantan `now`).
  check(
    sessionState([new Date(nowMs + 600_000), minsAgo(1)], NOW) === "ok",
    "timestamp futuro descartado → ok",
  );
}

// ---------- 4. sessionWindowQuery: forma de la query (anti-regresión take:60) ----------
{
  const q = sessionWindowQuery("user-123", NOW);
  check(
    (q.where?.conversation as { userId?: string } | undefined)?.userId === "user-123",
    "filtra por conversation.userId (cross-conversation)",
  );
  const gte = (q.where?.createdAt as { gte?: Date } | undefined)?.gte;
  check(
    gte instanceof Date && gte.getTime() === nowMs - (SESSION_OVER_MS + SESSION_GAP_MS),
    "createdAt.gte = now - (OVER + GAP) = 75 min (trae toda la racha)",
  );
  check(!("take" in q), "SIN `take`/limit — reintroducirlo permitiría eludir el corte de 45'");
  check((q.orderBy as { createdAt?: string } | undefined)?.createdAt === "desc", "orderBy createdAt desc");
  check(
    q.select?.createdAt === true && q.select?.role === true && q.select?.safetyFlag === true,
    "select createdAt/role/safetyFlag",
  );
}

done();
