"use client";

import { useEffect, useState } from "react";

/**
 * ¿Hay conexión de red? Escucha los eventos `online`/`offline` del navegador y
 * arranca del valor real (`navigator.onLine`).
 *
 * Arranca en `true` (optimista) para que el primer render del cliente coincida
 * con el del server (donde no hay `navigator`) y no haya mismatch de hidratación;
 * el `useEffect` corrige al valor real ni bien monta. `navigator.onLine` es una
 * heurística del SO (true = hay interfaz de red, no garantiza internet), pero
 * cubre el caso común de wifi caído / modo avión, que es lo que este aviso busca.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); // valor real al montar (puede haberse perdido antes de hidratar)
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}
