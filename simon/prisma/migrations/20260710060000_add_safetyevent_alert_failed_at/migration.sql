-- Registro persistente del fallo de una alerta de crisis (ciclo 15 L2b, ruta de
-- seguridad): cuando el envío del email al tutor/a falla tras los reintentos, se
-- marca este instante para reintentarlo luego (cron retryFailedCrisisAlerts) sin
-- perder la señal. Columna nullable, ADITIVA y segura sobre datos existentes
-- (null = sin fallo pendiente; no-null = envío pendiente de reintento). La purga
-- por TTL NO la toca: solo el cascade al eliminar al menor. SQL verificado con
-- `prisma migrate diff --from-schema <prev> --to-schema <actual> --script`:
-- coincide exactamente con lo que Prisma generaría.

-- AlterTable
ALTER TABLE "SafetyEvent" ADD COLUMN     "alertFailedAt" TIMESTAMP(3);
