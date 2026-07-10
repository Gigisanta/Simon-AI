/**
 * Mensajes de UI compartidos (rioplatense, voseo). Fuente única para copys que
 * se repetían literalmente por varias rutas/handlers, para que el texto no
 * derive entre lugares y se pueda testear el patrón en un solo sitio.
 */

/**
 * Patrón de rate-limit: "Demasiados/as <sustantivo> seguidos/as. Esperá un
 * momento." La concordancia de género la fija `gender` ("m" → -os, "f" → -as),
 * así "Demasiadas consultas seguidas" y "Demasiados mensajes seguidos" salen de
 * la misma fuente. `noun` va en plural (consultas, mensajes, altas, descargas…).
 */
export function rateLimitMessage(noun: string, gender: "m" | "f"): string {
  const suffix = gender === "f" ? "as" : "os";
  return `Demasiad${suffix} ${noun} seguid${suffix}. Esperá un momento.`;
}

/**
 * Fallo genérico del reenvío del email de verificación (cualquier error que no
 * sea rate-limit: EMAIL_MISMATCH, ya verificado, red, etc.). No revela el
 * detalle server-side; solo invita a reintentar.
 */
export const RESEND_VERIFICATION_GENERIC_ERROR =
  "No se pudo reenviar el email. Probá de nuevo.";
