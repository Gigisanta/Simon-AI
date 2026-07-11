-- CreateTable
CREATE TABLE "GuardianFollowup" (
    "id" TEXT NOT NULL,
    "guardianUserId" TEXT NOT NULL,
    "childUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'contacted',
    "resourceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuardianFollowup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GuardianFollowup_guardianUserId_childUserId_key" ON "GuardianFollowup"("guardianUserId", "childUserId");

-- CreateIndex
CREATE INDEX "GuardianFollowup_guardianUserId_status_idx" ON "GuardianFollowup"("guardianUserId", "status");

-- AddForeignKey
ALTER TABLE "GuardianFollowup" ADD CONSTRAINT "GuardianFollowup_guardianUserId_fkey" FOREIGN KEY ("guardianUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuardianFollowup" ADD CONSTRAINT "GuardianFollowup_childUserId_fkey" FOREIGN KEY ("childUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
