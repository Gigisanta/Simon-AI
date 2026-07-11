-- AlterTable: zona de la familia para filtrar recursos ("Cerca tuyo")
ALTER TABLE "Guardian" ADD COLUMN     "province" TEXT,
ADD COLUMN     "localidad" TEXT;

-- CreateTable
CREATE TABLE "HelpResource" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "localidad" TEXT,
    "address" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "phone" TEXT,
    "whatsapp" TEXT,
    "hours" TEXT,
    "cost" TEXT NOT NULL DEFAULT 'gratis',
    "takesChildren" BOOLEAN NOT NULL DEFAULT true,
    "noAppointment" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT,
    "notes" TEXT,
    "source" TEXT,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpResource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HelpResource_slug_key" ON "HelpResource"("slug");

-- CreateIndex
CREATE INDEX "HelpResource_province_kind_idx" ON "HelpResource"("province", "kind");
