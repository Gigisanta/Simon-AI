-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "rollingSummarizedUntil" TIMESTAMP(3),
ADD COLUMN     "rollingSummary" TEXT;

-- CreateTable
CREATE TABLE "InteractionLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userMessageId" TEXT,
    "assistantMessageId" TEXT,
    "safetyEventId" TEXT,
    "model" TEXT,
    "totalLatencyMs" INTEGER NOT NULL,
    "generationLatencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "totalTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "cacheReadTokens" INTEGER,
    "moderationInputSource" TEXT,
    "moderationInputFlagged" BOOLEAN,
    "moderationInputCategory" TEXT,
    "moderationOutputSource" TEXT,
    "moderationOutputFlagged" BOOLEAN,
    "moderationOutputCategory" TEXT,
    "responsePath" TEXT NOT NULL,
    "safetyFlagFinal" TEXT,
    "historyMessagesSent" INTEGER NOT NULL,
    "roleAtRequest" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InteractionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InteractionLog_userId_createdAt_idx" ON "InteractionLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "InteractionLog_conversationId_idx" ON "InteractionLog"("conversationId");

-- CreateIndex
CREATE INDEX "InteractionLog_responsePath_idx" ON "InteractionLog"("responsePath");

-- AddForeignKey
ALTER TABLE "InteractionLog" ADD CONSTRAINT "InteractionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InteractionLog" ADD CONSTRAINT "InteractionLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
