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

const STORAGE_KEY = "simon-session-start";
const SHOW_AFTER_MIN = 20;
const PAUSE_HINT_MIN = 30;

function readRecord(): { start: number; last: number } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
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

export function SessionTimer({ serverWarned }: { serverWarned: boolean }) {
  const [elapsedMin, setElapsedMin] = useState(0);

  useEffect(() => {
    const now = Date.now();
    let record = readRecord();
    if (!record || now - record.last >= SESSION_GAP_MS) {
      record = { start: now, last: now };
    }

    function tick() {
      const t = Date.now();
      record = { start: record!.start, last: t };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      } catch {
        // sin persistencia: el timer sigue valiendo para esta visita
      }
      setElapsedMin(Math.floor((t - record.start) / 60_000));
    }

    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  if (elapsedMin < SHOW_AFTER_MIN) return null;

  return (
    <p aria-live="off" className="text-xs text-ink-soft tabular-nums">
      {elapsedMin} min
      {serverWarned && elapsedMin >= PAUSE_HINT_MIN && (
        <span className="ml-1.5">· buen momento para una pausa</span>
      )}
    </p>
  );
}
