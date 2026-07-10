-- Revocación de consentimiento standalone (Ley 25.326, derecho de oposición): el
-- tutor/a puede SUSPENDER el acceso del menor sin borrar sus datos. Columna
-- nullable, ADITIVA y segura sobre datos existentes (null = consentimiento
-- vigente; no-null = suspendido desde ese instante). SQL verificado con
-- `prisma migrate diff --from-schema <prev> --to-schema <actual> --script`:
-- coincide exactamente con lo que Prisma generaría.

-- AlterTable
ALTER TABLE "Guardian" ADD COLUMN     "consentRevokedAt" TIMESTAMP(3);
