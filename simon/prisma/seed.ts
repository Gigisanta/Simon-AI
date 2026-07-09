// Seed de la base de conocimiento (RAG liviano).
// Las fichas viven en prisma/knowledge-data.ts (fuente única, también usada por
// el eval determinístico de retrieval). Contenido de maqueta portado de
// legacy/data.js — `reviewed: false` hasta que un profesional firme cada ficha.
import { config as dotenv } from "dotenv";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { KNOWLEDGE_CARDS } from "./knowledge-data";

dotenv({ path: [".env.local", ".env"] });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL no está configurada");
}
const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  for (const card of KNOWLEDGE_CARDS) {
    await prisma.knowledgeCard.upsert({
      where: { slug: card.slug },
      update: {
        category: card.category,
        title: card.title,
        body: card.body,
        source: card.source ?? null,
      },
      create: {
        slug: card.slug,
        category: card.category,
        title: card.title,
        body: card.body,
        source: card.source ?? null,
        reviewed: false,
      },
    });
  }
  console.log(`Seeded ${KNOWLEDGE_CARDS.length} knowledge cards.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
