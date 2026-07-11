/**
 * Suite de la fecha relativa (components/relative-time.ts) — función pura.
 *
 *   pnpm tsx scripts/relative-time-suite.ts   (o vía `pnpm test relative-time`)
 *
 * Foco: el clamp a no-futuro. `relativeTime` mezcla timestamps del servidor con
 * el reloj del cliente vía `now`; con el cliente adelantado un evento recién
 * persistido caería "en el futuro" y mostraría "en 3 segundos" en vez de un
 * pasado inmediato. Se inyecta `now` (segundo parámetro, default Date.now()) para
 * fijar el borde y validar diffs negativos chicos y grandes.
 */
import { createChecker } from "./suite-helpers";
import { relativeTime } from "../src/components/relative-time";

const { check, done } = createChecker("Relative-time suite");

const NOW = new Date("2026-07-10T12:00:00.000Z").getTime();
const at = (deltaSec: number) => new Date(NOW + deltaSec * 1000).toISOString();

// ---------- 1. Clamp a no-futuro (el bug: reloj de cliente adelantado) ----------
{
  // Desfasaje chico hacia el futuro (evento persistido "en 3 segundos"): clamp a
  // 0 → "ahora", nunca prefijo futuro "en ".
  const small = relativeTime(at(3), NOW);
  check(small === "ahora", `futuro chico (+3s) → "ahora" (fue "${small}")`);
  check(!small.startsWith("en "), "futuro chico no usa prefijo futuro 'en '");

  // Desfasaje grande hacia el futuro: igual se clampa (los persistidos jamás son
  // futuros), no debe escalar a "en 2 horas" ni similar.
  const big = relativeTime(at(3600), NOW);
  check(big === "ahora", `futuro grande (+1h) → "ahora" (fue "${big}")`);
  check(!big.startsWith("en "), "futuro grande no usa prefijo futuro 'en '");

  // El borde exacto now === eventTime → "ahora".
  check(relativeTime(at(0), NOW) === "ahora", "diff 0 → 'ahora'");
}

// ---------- 2. Pasado: comportamiento intacto por bucket ----------
{
  check(relativeTime(at(-3), NOW) === "hace 3 segundos", "-3s → 'hace 3 segundos'");
  check(relativeTime(at(-120), NOW) === "hace 2 minutos", "-2min → 'hace 2 minutos'");
  check(relativeTime(at(-7200), NOW) === "hace 2 horas", "-2h → 'hace 2 horas'");
  check(relativeTime(at(-86400), NOW) === "ayer", "-1día → 'ayer'");
  check(relativeTime(at(-5184000), NOW) === "hace 2 meses", "-2meses → 'hace 2 meses'");
}

done();
