// Seed de la base de conocimiento (RAG liviano).
// Las fichas viven en prisma/knowledge-data.ts (fuente única, también usada por
// el eval determinístico de retrieval). Contenido de maqueta portado de
// legacy/data.js — `reviewed: false` hasta que un profesional firme cada ficha.
import { config as dotenv } from "dotenv";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../src/generated/prisma/client";
import { KNOWLEDGE_CARDS } from "./knowledge-data";
import { HELP_RESOURCES } from "./help-resources-data";
import { TRAMITE_GUIDES } from "./tramites-data";

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

  // Directorio "Cerca tuyo": líneas nacionales verificadas (reviewed:true) +
  // recursos provinciales pendientes de validar (reviewed:false, no se muestran
  // hasta que una persona confirme los datos). Idempotente por `slug`.
  for (const r of HELP_RESOURCES) {
    const data = {
      name: r.name,
      kind: r.kind,
      province: r.province,
      localidad: r.localidad ?? null,
      address: r.address ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      phone: r.phone ?? null,
      whatsapp: r.whatsapp ?? null,
      hours: r.hours ?? null,
      cost: r.cost ?? "gratis",
      takesChildren: r.takesChildren ?? true,
      noAppointment: r.noAppointment ?? false,
      url: r.url ?? null,
      notes: r.notes ?? null,
      source: r.source ?? null,
      reviewed: r.reviewed ?? false,
    };
    await prisma.helpResource.upsert({
      where: { slug: r.slug },
      update: data,
      create: { slug: r.slug, ...data },
    });
  }
  console.log(`Seeded ${HELP_RESOURCES.length} help resources.`);

  // Guías de trámites ("Mis trámites"): contenido orientativo con fuente
  // oficial. reviewed:false hasta validación humana (mismo criterio que las
  // fichas). Idempotente por `slug`.
  for (const g of TRAMITE_GUIDES) {
    const data = {
      title: g.title,
      summary: g.summary,
      category: g.category,
      estimatedTime: g.estimatedTime ?? null,
      requirements: g.requirements,
      steps: g.steps,
      source: g.source ?? null,
      sourceUrl: g.sourceUrl ?? null,
    };
    await prisma.tramiteGuide.upsert({
      where: { slug: g.slug },
      update: data,
      create: { slug: g.slug, ...data, reviewed: false },
    });
  }
  console.log(`Seeded ${TRAMITE_GUIDES.length} tramite guides.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
