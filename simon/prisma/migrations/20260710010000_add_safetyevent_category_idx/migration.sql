-- Índice compuesto para las alertas de patrón (lib/alerts.ts): count/findFirst
-- de SafetyEvent por { userId, category, createdAt >= ventana }. El índice previo
-- [userId, createdAt] cubría la ruta del tutor/a (paginación por userId) pero
-- dejaba el filtro por `category` como scan+filter sobre la franja del usuario.
-- Este índice cubre equality (userId, category) + range (createdAt) de una.
-- Se CONSERVA el índice [userId, createdAt] (lo usa la ruta safety-events).

-- CreateIndex
CREATE INDEX "SafetyEvent_userId_category_createdAt_idx" ON "SafetyEvent"("userId", "category", "createdAt");
