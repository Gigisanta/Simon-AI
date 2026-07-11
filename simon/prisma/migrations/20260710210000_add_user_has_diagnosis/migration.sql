-- Store only whether the child reports having a diagnosis.
-- We intentionally do not persist diagnosis names or clinical details.
ALTER TABLE "user" ADD COLUMN "hasDiagnosis" BOOLEAN;
