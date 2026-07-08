import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Falla ruidosa al primer USO: sin DB no hay app. Lazy para que módulos
    // puros (suites) puedan importar este archivo sin entorno de DB.
    throw new Error("DATABASE_URL no está configurada");
  }
  // Adapter Neon (HTTP/WebSocket): apto para serverless (Vercel) y local.
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  // Cache global: reuso entre requests (serverless) y entre hot-reloads (dev).
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop as keyof PrismaClient];
    return typeof value === "function" ? value.bind(client) : value;
  },
});
