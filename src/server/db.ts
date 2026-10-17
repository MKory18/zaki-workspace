import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

export const db = globalThis.prisma ?? new PrismaClient({ log: ["error"] });

if (process.env.NODE_ENV !== "production") globalThis.prisma = db;

export type DbTx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
export type DbClient = PrismaClient | DbTx;
