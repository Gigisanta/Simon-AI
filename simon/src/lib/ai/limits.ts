/**
 * Límites de latencia compartidos de la ruta de chat (Lote 4, ciclo 15).
 *
 * FUENTE ÚNICA del `maxDuration` de /api/chat. Antes el valor vivía hardcodeado
 * como `90` en la ruta y como `60` (desactualizado) en los comentarios de
 * `retry.ts` y `provider.ts` — se habían desincronizado al subir el tope de la
 * ruta. Centralizarlo acá evita que vuelva a pasar: la ruta importa la constante
 * y los comentarios de esos módulos la nombran (no repiten el número).
 */

/**
 * Tope de duración (segundos) de la ruta POST /api/chat. Cubre, en el peor caso:
 * generación completa con 1 reintento transitorio + moderación de entrada y de
 * salida (ver el presupuesto detallado en lib/ai/retry.ts). Debe ser ≥ que la
 * suma de esos topes; hoy 90s da margen real sin tocar el timeout por-intento de
 * cada llamada al proveedor.
 */
export const CHAT_ROUTE_MAX_DURATION_S = 90;
