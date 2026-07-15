import type { LanguageModelUsage } from "ai";

/**
 * Tipos compartidos del pipeline de chat (ADR-1).
 *
 * La ex-ruta monolítica (~1200 líneas) se descompone en stages explícitos:
 *   validate → crisisPrecheck → guardrailIn → buildContext → generate →
 *   guardrailOut → persist → notify
 * Cada stage vive en su módulo bajo src/lib/chat-pipeline/ y recibe SOLO lo
 * que necesita (funciones testeables sin runtime de Next). La orquestación
 * (orden de ramas) vive en run.ts; la DECISIÓN de precedencia de seguridad
 * sigue delegada en chat-precedence.ts (sin cambios, testeada en suite).
 */

/**
 * Difiere trabajo a después de enviada la respuesta. La ruta inyecta `after()`
 * de next/server; un test puede inyectar una cola sincrónica. Mantiene
 * next/server FUERA de lib/: los stages corren bajo tsx sin runtime de Next.
 *
 * La tarea puede devolver CUALQUIER cosa (mismo contrato que el `AfterCallback`
 * de next/server: `() => T | Promise<T>`). Importa para los diferidos cuyo
 * callback devuelve una promesa NO-void —p.ej. `maybePatternAlert` devuelve
 * `Promise<boolean>`—: `after` la awaitea (mantiene viva la función serverless),
 * así que el valor se retorna, nunca se descarta con `void` (eso cortaría el
 * await y perdería el trabajo en serverless). El valor de retorno se ignora.
 */
export type Defer = (task: () => unknown) => void;

/**
 * Subtipo estructural de `session.user` con todo lo que el pipeline necesita.
 * Asignable al parámetro de canUserChat ({ id, role? }) y trae los campos que
 * usan buildSystemPrompt (name, hasDiagnosis) y deriveChildAge (birthYear).
 */
export type ChatUser = {
  id: string;
  role?: string | null;
  name?: string | null;
  birthYear?: number | null;
  hasDiagnosis?: boolean | null;
};

/** Resultado de la generación. NUNCA lanza: el fallo es el sentinel ok:false. */
export type GenerationResult =
  | {
      ok: true;
      text: string;
      usage: LanguageModelUsage;
      generationLatencyMs: number | null;
    }
  | { ok: false };
