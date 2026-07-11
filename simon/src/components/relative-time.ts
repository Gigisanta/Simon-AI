/**
 * Fecha relativa en es-AR: "hace 2 horas", "ayer". Compartida entre el chat
 * (prompt "¿Seguimos donde quedamos?") y la lista de conversaciones.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
  // Los timestamps son del servidor pero `now` sale del reloj del cliente: con
  // el cliente adelantado, un evento recién persistido cae "en el futuro" y se
  // vería "en 3 segundos". Un evento ya persistido nunca es futuro → clamp a
  // no-futuro, así un desfasaje chico muestra "ahora" (0) en vez de futuro.
  const diffSec = Math.min(0, Math.round((new Date(iso).getTime() - now) / 1000));
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, "second");
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 2592000) return rtf.format(Math.round(diffSec / 86400), "day");
  return rtf.format(Math.round(diffSec / 2592000), "month");
}

/**
 * Agrupa por antigüedad para la lista de conversaciones (patrón WhatsApp):
 * "Hoy" | "Ayer" | "Anteriores", comparando por día calendario local.
 */
export function dayGroup(iso: string): "Hoy" | "Ayer" | "Anteriores" {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfDate.getTime()) / 86_400_000,
  );
  if (diffDays <= 0) return "Hoy";
  if (diffDays === 1) return "Ayer";
  return "Anteriores";
}
