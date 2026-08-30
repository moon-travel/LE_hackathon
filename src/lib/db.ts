// Prisma Client シングルトン。
//
// 【共有ファイル】フェーズ0が用意していなかったため担当Aが作成した。A/B/C 全員が使う想定。
// 開発時の HMR で PrismaClient が多重生成され SQLite のコネクションを食い潰すのを防ぐため、
// globalThis に退避して再利用する。

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
