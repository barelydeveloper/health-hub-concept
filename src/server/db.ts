import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { neonEnv } from "./neon-env";

neonConfig.webSocketConstructor = ws;

const globalForPrisma = globalThis as { prisma?: PrismaClient };

function createPrisma(): PrismaClient {
  const adapter = new PrismaNeon({ connectionString: neonEnv().postgres.databaseUrl });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export function dec(value: { toString(): string } | null | undefined): number | null {
  if (value == null) return null;
  const number = Number(value.toString());
  return Number.isFinite(number) ? number : null;
}
