"use client";

import { useEffect, useState } from "react";
import { SESSION_GAP_MS } from "@/lib/session-limit";

/**
 * Timer de sesión sutil (research-ux §1.6 item 8): cuenta ASCENDENTE, nunca
 * countdown (ansiógeno). Aparece recién a los 20 minutos, con aria-live="off"
 * para no interrumpir lectores de pantalla. La lógica real de límite es
 * server-side (lib/session-limit.ts); esto es solo indicador visual, con la
 * misma regla de racha: un cierre de ≥ 30 min (SESSION_GAP_MS) la reinicia.
 */

// Prefijo por-usuario: en tablets compartidas cada cuenta tiene su propia
// racha; sin namespacing, el tiempo transcurrido se filtraba entre menores.
const STORAGE_PREFIX = "simon-session-start";
const SHOW_AFTER_MIN = 20;
const PAUSE_HINT_MIN = 30;

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

// Purga entradas huérfanas de otras cuentas (tablets compartidas): cualquier
// clave con el mismo prefijo cuya racha ya venció (`last` más viejo que
// SESSION_GAP_MS) no volverá a usarse — `readRecord` la reiniciaría igual — así
// que se elimina para que localStorage no crezca sin techo. Se salta la clave
// activa y tolera valores corruptos (los borra: no aportan nada).
function purgeStale(activeKey: string, nowMs: number): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (!k || k === activeKey || !k.startsWith(`${STORAGE_PREFIX}:`)) continue;
      const rec = readRecord(k);
      if (!rec || nowMs - rec.last >= SESSION_GAP_MS) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // sin localStorage o acceso denegado: nada que purgar
  }
}

function readRecord(key: string): { start: number; last: number } | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { start?: unknown }).start === "number" &&
      typeof (parsed as { last?: unknown }).last === "number"
    ) {
      return parsed as { start: number; last: number };
    }
  } catch {
    // valor corrupto o sin localStorage: se reinicia la cuenta
  }
  return null;
}

export function SessionTimer({
  serverWarned,
  userId,
}: {
  serverWarned: boolean;
  userId: string | undefined;
}) {
  const [elapsedMin, setElapsedMin] = useState(0);

  useEffect(() => {
    // Sin usuario resuelto (sesión cargando) no se persiste nada: evita
    // arrancar una racha bajo una clave anónima que otra cuenta podría heredar.
    // El display queda oculto por la guarda de render (no hace falta setState).
    if (!userId) return;
    const key = storageKey(userId);
    const now = Date.now();
    // Limpia rachas vencidas de otras cuentas antes de arrancar la propia.
    purgeStale(key, now);
    let record = readRecord(key);
    if (!record || now - record.last >= SESSION_GAP_MS) {
      record = { start: now, last: now };
    }

    function tick() {
      const t = Date.now();
      record = { start: record!.start, last: t };
      try {
        localStorage.setItem(key, JSON.stringify(record));
      } catch {
        // sin persistencia: el timer sigue valiendo para esta visita
      }
      setElapsedMin(Math.floor((t - record.start) / 60_000));
    }

    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [userId]);

  if (!userId || elapsedMin < SHOW_AFTER_MIN) return null;

  return (
    <p aria-live="off" className="text-xs text-ink-soft tabular-nums">
      {elapsedMin} min
      {serverWarned && elapsedMin >= PAUSE_HINT_MIN && (
        <span className="ml-1.5">· buen momento para una pausa</span>
      )}
    </p>
  );
}
