/**
 * Export del dataset de fine-tuning (B4.4).
 *
 *   pnpm export-training --out data/simon.jsonl --min-turns 4 --role child
 *
 * Genera:
 *   - <out>: JSONL en formato chat-completions ({"messages":[{role,content}...]}).
 *   - <out sin .jsonl>.meta.jsonl: sidecar con {conversationId, turnCount,
 *     createdAtMonth, qualityTier} — una línea por ejemplo.
 *
 * Filtros (toda la lógica pura vive en src/lib/training-export.ts, testeada en
 * scripts/training-export-suite.ts):
 *   - Excluye conversaciones que tocaron crisis/abuso (SafetyEvent).
 *   - Corta el ejemplo en el primer Message.safetyFlag != null.
 *   - Abre en user, cierra en assistant, mínimo 3 pares user/assistant.
 *   - System genérico SIN userName ni memorias (anonimización, Ley 25.326).
 *
 * Flags: --out, --min-turns, --role (child|guardian|all).
 */
import { config as dotenv } from "dotenv";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  buildTrainingExample,
  metaSidecarPath,
  parseRoleFilter,
} from "../src/lib/training-export";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

dotenv({ path: [".env.local", ".env"] });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está configurada");
}
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/** Lee `--flag value` de argv (o el default). */
function argValue(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const out = argValue("--out", "training.jsonl");
const minTurns = Math.max(1, Number(argValue("--min-turns", "3")) || 3);
const roleFilter = parseRoleFilter(argValue("--role", "all"));

async function main() {
  const conversations = await prisma.conversation.findMany({
    where: roleFilter === "all" ? {} : { user: { role: roleFilter } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true, safetyFlag: true },
      },
    },
  });

  // Categorías de SafetyEvent por conversación (para excluir crisis/abuso). No
  // hay relación Conversation→SafetyEvent en el schema; se consulta aparte.
  const convIds = conversations.map((c) => c.id);
  const events = await prisma.safetyEvent.findMany({
    where: { conversationId: { in: convIds } },
    select: { conversationId: true, category: true },
  });
  const catsByConv = new Map<string, string[]>();
  for (const e of events) {
    if (!e.conversationId) continue;
    const list = catsByConv.get(e.conversationId) ?? [];
    list.push(e.category);
    catsByConv.set(e.conversationId, list);
  }

  const recordLines: string[] = [];
  const metaLines: string[] = [];
  for (const conv of conversations) {
    const example = buildTrainingExample(
      {
        id: conv.id,
        createdAt: conv.createdAt,
        messages: conv.messages,
        safetyEventCategories: catsByConv.get(conv.id) ?? [],
      },
      { minTurns },
    );
    if (!example) continue;
    recordLines.push(JSON.stringify(example.record));
    metaLines.push(JSON.stringify(example.meta));
  }

  const metaPath = metaSidecarPath(out);
  const dir = dirname(out);
  if (dir && dir !== ".") mkdirSync(dir, { recursive: true });
  writeFileSync(out, recordLines.length ? recordLines.join("\n") + "\n" : "");
  writeFileSync(metaPath, metaLines.length ? metaLines.join("\n") + "\n" : "");

  console.log(
    `[export-training] ${recordLines.length} ejemplos de ${conversations.length} conversaciones ` +
      `(role=${roleFilter}, min-turns=${minTurns})`,
  );
  console.log(`  → ${out}`);
  console.log(`  → ${metaPath}`);
}

main()
  .catch((err) => {
    console.error("[export-training] error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
