/**
 * Filtro de exclusión de crisis para el data engine generativo.
 *
 * REÚSA el detector de producción `detectSafetyFlag` (simon/src/lib/safety.ts)
 * — no se reimplementa la taxonomía de seguridad en Python (una segunda copia
 * divergiría). Lee JSONL por stdin y escribe por stdout SOLO las líneas cuyo
 * texto NO dispara ningún flag de seguridad (crisis/abuso/alimentario/riesgo).
 *
 * Principio del lab: las categorías de crisis/abuso JAMÁS entran al dataset
 * generativo (esas conversaciones son plantilla determinística + guard, no las
 * genera ni las aprende el modelo). curate.py invoca este filtro como una etapa.
 *
 * Uso:  cat crudo.jsonl | npx tsx lab/data/scripts/exclude-flagged.ts > limpio.jsonl
 *
 * Sale con código 0 siempre (es un filtro). Reporta contadores por stderr.
 * El texto de cada muestra se toma de 'output' | 'content' | 'text', o del
 * último turno assistant si viene en formato {messages:[...]}.
 */
import { detectSafetyFlag } from "../../../simon/src/lib/safety";
import { createInterface } from "node:readline";

function extractText(obj: unknown): string | null {
  if (typeof obj === "string") return obj;
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  for (const k of ["output", "content", "text", "response"]) {
    if (typeof o[k] === "string") return o[k] as string;
  }
  if (Array.isArray(o.messages)) {
    for (let i = o.messages.length - 1; i >= 0; i--) {
      const m = o.messages[i] as Record<string, unknown> | undefined;
      if (m && m.role === "assistant" && typeof m.content === "string") return m.content;
    }
  }
  return null;
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let kept = 0;
let dropped = 0;
let malformed = 0;

rl.on("line", (line: string) => {
  const s = line.trim();
  if (!s) return;
  let obj: unknown;
  try {
    obj = JSON.parse(s);
  } catch {
    malformed++;
    return; // fail-closed: una línea inválida no pasa
  }
  const text = extractText(obj);
  if (text === null) {
    malformed++;
    return;
  }
  // Fail-closed: cualquier flag (incluido 'riesgo') excluye la muestra del set
  // generativo. Un turno de riesgo se atiende con addendum en prod, no se
  // convierte en dato de entrenamiento conversacional.
  if (detectSafetyFlag(text) !== null) {
    dropped++;
    return;
  }
  process.stdout.write(line + "\n");
  kept++;
});

rl.on("close", () => {
  process.stderr.write(
    `[exclude-flagged] kept=${kept} dropped=${dropped} malformed=${malformed}\n`,
  );
});
