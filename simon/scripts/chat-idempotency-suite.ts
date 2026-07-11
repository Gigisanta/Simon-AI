/**
 * Suite de la idempotencia del mensaje del menor en /api/chat (#31-3).
 *
 *   pnpm chat-idempotency-suite
 *
 * Testea EXHAUSTIVAMENTE la lógica pura que decide si un reintento re-persiste el
 * mensaje del menor o lo reusa:
 *   - parseClientMessageId: uuid válido → id; ausente/basura → null (retrocompat).
 *   - resolveDuplicateUserMessage: reuse (mismo hilo, role user) vs recreate
 *     (id ajeno / otro rol / otro hilo).
 *
 * Sale con código 1 si algún caso falla (gate de CI).
 */
import { randomUUID } from "node:crypto";
import { createChecker } from "./suite-helpers";
import {
  parseClientMessageId,
  resolveDuplicateUserMessage,
  type ExistingMessage,
} from "../src/lib/chat-idempotency";

const { check, done } = createChecker("Chat-idempotency suite");

// ---------- parseClientMessageId ----------
const uuid = randomUUID();
check(parseClientMessageId(uuid) === uuid, "uuid válido → se conserva");
check(parseClientMessageId(uuid.toUpperCase()) === uuid.toUpperCase(), "uuid en mayúsculas → válido");
check(parseClientMessageId(undefined) === null, "ausente → null (retrocompat)");
check(parseClientMessageId(null) === null, "null → null");
check(parseClientMessageId("") === null, "string vacío → null");
check(parseClientMessageId("no-es-uuid") === null, "basura → null (no rompe el request)");
check(parseClientMessageId("123") === null, "numérico corto → null");
check(parseClientMessageId(42) === null, "no-string → null");
check(parseClientMessageId({ id: uuid }) === null, "objeto → null");
// Un cuid del servidor NO es uuid → null (no se confunde con un id del cliente).
check(parseClientMessageId("clh1abcd0000xyz123456789") === null, "cuid del server → null");

// ---------- resolveDuplicateUserMessage ----------
const CONV = "conv_A";
const at = new Date("2026-07-10T12:00:00.000Z");

const sameConvUser: ExistingMessage = { conversationId: CONV, role: "user", createdAt: at };
const r1 = resolveDuplicateUserMessage(sameConvUser, CONV);
check(r1.kind === "reuse", "mismo hilo + role user → reuse");
check(r1.kind === "reuse" && r1.persistedUserAt === at, "reuse expone el createdAt persistido");

// role assistant con el mismo id (patológico): no se reusa como mensaje del menor.
check(
  resolveDuplicateUserMessage({ conversationId: CONV, role: "assistant", createdAt: at }, CONV).kind ===
    "recreate",
  "mismo hilo + role assistant → recreate",
);

// id existente pero en OTRA conversación (colisión/forja): no reusar ajeno.
check(
  resolveDuplicateUserMessage({ conversationId: "conv_B", role: "user", createdAt: at }, CONV).kind ===
    "recreate",
  "otro hilo → recreate (no se reusa un id ajeno)",
);

// sin fila existente (no debería llamarse así en el handler, pero es seguro).
check(resolveDuplicateUserMessage(null, CONV).kind === "recreate", "existing null → recreate");

done();
