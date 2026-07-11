-- CreateTable
CREATE TABLE "TramiteGuide" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "estimatedTime" TEXT,
    "requirements" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "source" TEXT,
    "sourceUrl" TEXT,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TramiteGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TramiteProgress" (
    "id" TEXT NOT NULL,
    "guardianUserId" TEXT NOT NULL,
    "guideSlug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "checkedItems" JSONB NOT NULL DEFAULT '[]',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TramiteProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TramiteGuide_slug_key" ON "TramiteGuide"("slug");

-- CreateIndex
CREATE INDEX "TramiteGuide_category_idx" ON "TramiteGuide"("category");

-- CreateIndex
CREATE UNIQUE INDEX "TramiteProgress_guardianUserId_guideSlug_key" ON "TramiteProgress"("guardianUserId", "guideSlug");

-- CreateIndex
CREATE INDEX "TramiteProgress_guardianUserId_idx" ON "TramiteProgress"("guardianUserId");

-- AddForeignKey
ALTER TABLE "TramiteProgress" ADD CONSTRAINT "TramiteProgress_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
