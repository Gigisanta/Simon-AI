/**
 * Lógica del CTA de reenvío del email de verificación (banner del panel del
 * tutor/a). Se extrae del componente para poder testearla sin React:
 *   - `mapResendError`: mapea el error de better-auth a un copy de UI.
 *   - `runResendFlow`: orquesta la transición de estados (loading → sent | error)
 *     invocando el `send` inyectado; el timer de cooldown vive en el componente.
 *
 * El endpoint de better-auth (/send-verification-email) valida server-side que el
 * email sea el de la sesión (EMAIL_MISMATCH si no) y que no esté ya verificado, y
 * trae rate limit propio; acá solo traducimos el resultado a UI.
 */
import {
  rateLimitMessage,
  RESEND_VERIFICATION_GENERIC_ERROR,
} from "./ui-messages";

/** Estado del CTA. `cooldown` no vive acá: es un flag aparte en el componente. */
export type ResendState = "idle" | "loading" | "sent" | "error";

/**
 * Error de better-auth (subconjunto): el cliente devuelve un objeto con `status`
 * (código HTTP), y opcionalmente `code`/`message`. Solo nos importa distinguir el
 * rate-limit (429) del resto.
 */
export type ResendError =
  | { status?: number; statusCode?: number; code?: string; message?: string }
  | null
  | undefined;

/**
 * Mapea el error del reenvío a un copy de UI:
 *   - rate-limit (HTTP 429) → mensaje de rate-limit específico.
 *   - cualquier otro (EMAIL_MISMATCH, ya verificado, red…) → genérico.
 */
export function mapResendError(error: ResendError): string {
  const status = error?.status ?? error?.statusCode;
  if (status === 429) return rateLimitMessage("emails", "m");
  return RESEND_VERIFICATION_GENERIC_ERROR;
}

/**
 * Orquesta el reenvío: pone `loading`, ejecuta `send`, y según el resultado deja
 * `sent` (y dispara `onSent` para el cooldown) o `error` (con el mensaje mapeado).
 * Los setters se inyectan para poder grabar las transiciones en el test.
 */
export async function runResendFlow(deps: {
  send: () => Promise<{ error: ResendError }>;
  setState: (s: ResendState) => void;
  setMessage: (m: string | null) => void;
  onSent?: () => void;
}): Promise<void> {
  const { send, setState, setMessage, onSent } = deps;
  setState("loading");
  setMessage(null);
  const { error } = await send();
  if (error) {
    setMessage(mapResendError(error));
    setState("error");
    return;
  }
  setState("sent");
  onSent?.();
}
