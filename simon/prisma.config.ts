import { config as dotenv } from "dotenv";
import { defineConfig } from "prisma/config";

// Orden Next.js: .env.local pisa .env. El CLI de Prisma no lo hace solo.
dotenv({ path: [".env.local", ".env"] });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migraciones por conexión DIRECTA (sin pooler); el runtime usa la pooled.
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "",
  },
});
