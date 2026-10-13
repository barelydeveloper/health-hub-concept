import { PrismaClient } from "@prisma/client";
import { loadLocalEnv } from "./env";

loadLocalEnv();

const globalForPrisma = globalThis as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export function dec(value: { toString(): string } | null | undefined): number | null {
  if (value == null) return null;
  const number = Number(value.toString());
  return Number.isFinite(number) ? number : null;
}
