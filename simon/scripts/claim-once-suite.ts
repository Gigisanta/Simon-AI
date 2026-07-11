/**
 * Suite ejecutable de claimOnce (sin framework — se corre con tsx).
 *
 *   pnpm claim-once-suite
 *
 * Testea SOLO lógica pura y determinística, sin red ni Upstash:
 *   1. claimOnceMemory() — check-and-set atómico con TTL.
 *   2. claimOnce() en modo memoria — la PRIMERA gana; concurrentes pierden.
 *
 * Camino crítico (M-S7): sin contención atómica, dos pestañas cerca del minuto 30
 * anexan ambas el aviso de pausa. El caso concurrente fija que exactamente UNA
 * llamada gana el slot.
 *
 * Sale con código 1 si algún caso falla (sirve como gate en CI).
 */
// Sin credenciales de Upstash: claimOnce usa la implementación en memoria.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

import { createChecker } from "./suite-helpers";
import { claimOnce, claimOnceMemory, type Claim } from "../src/lib/claim-once";

const { check, done } = createChecker("Claim-once suite");

const TTL = 15 * 60_000;

// ---------- 1. claimOnceMemory: primera gana, segunda dentro del TTL pierde ----------
{
  const store = new Map<string, Claim>();
  const now = 1_000_000;
  const first = claimOnceMemory(store, "k", TTL, now);
  const second = claimOnceMemory(store, "k", TTL, now + 1_000);
  check(first === true, "claimOnceMemory: la primera llamada reclama el slot (true)");
  check(second === false, "claimOnceMemory: la segunda dentro del TTL no lo reclama (false)");
}

// ---------- 1b. claimOnceMemory: al vencer el TTL vuelve a ser reclamable ----------
{
  const store = new Map<string, Claim>();
  const now = 2_000_000;
  claimOnceMemory(store, "k", TTL, now);
  const beforeExpiry = claimOnceMemory(store, "k", TTL, now + TTL - 1);
  const afterExpiry = claimOnceMemory(store, "k", TTL, now + TTL + 1);
  check(beforeExpiry === false, "claimOnceMemory: justo antes de vencer sigue tomado (false)");
  check(afterExpiry === true, "claimOnceMemory: pasado el TTL se puede reclamar de nuevo (true)");
}

// ---------- 1c. claimOnceMemory: claves distintas son independientes ----------
{
  const store = new Map<string, Claim>();
  const now = 3_000_000;
  const a = claimOnceMemory(store, "a", TTL, now);
  const b = claimOnceMemory(store, "b", TTL, now);
  check(a === true && b === true, "claimOnceMemory: claves distintas no comparten slot");
}

// ---------- 2. claimOnce (memoria): N concurrentes a la MISMA key → gana UNA ----------
// Invariante SÍNCRONO del path en memoria: JS no cede el event loop entre leer y
// escribir, así que un Promise.all de N llamadas a la misma clave deja pasar
// EXACTAMENTE una. Es la contención que evita el doble aviso multi-tab (M-S7).
async function testConcurrentSameKey() {
  const key = `suite:once:${Math.random()}`;
  const n = 20;
  const results = await Promise.all(
    Array.from({ length: n }, () => claimOnce(key, TTL)),
  );
  const won = results.filter((r) => r === true).length;
  check(won === 1, `claimOnce: ${n} llamadas concurrentes a la misma key → gana exactamente 1 (ganaron ${won})`);
}

// ---------- 2b. claimOnce (memoria): claves distintas ganan cada una ----------
async function testDistinctKeys() {
  const u = Math.random();
  const first = await claimOnce(`suite:once:a:${u}`, TTL);
  const second = await claimOnce(`suite:once:b:${u}`, TTL);
  check(first === true && second === true, "claimOnce: claves distintas ganan cada una su slot");
}

async function main() {
  await testConcurrentSameKey();
  await testDistinctKeys();
  done();
}

main();
