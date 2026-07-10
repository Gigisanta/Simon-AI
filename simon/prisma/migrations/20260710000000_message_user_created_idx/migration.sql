-- M-S7: índice dedicado para la ventana de sesión cross-conversation
-- (sessionWindowQuery): filtra Message por `createdAt >= now-75min` sobre todas
-- las conversaciones del usuario. Message no tiene columna userId, así que el
-- predicado a nivel de tabla es el rango de createdAt; este índice lo cubre con
-- un range scan en lugar de un seq scan del historial completo.

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");
