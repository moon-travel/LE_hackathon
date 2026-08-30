// 担当B所有: Prisma クライアントのアクセサ（シングルトン）。
// 共有カーネル未提供のため担当B配下に置く。将来フェーズ2で共有化する場合は移設可能。
// dev/HMR で複数インスタンス生成を避けるため globalThis にキャッシュする。
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * $transaction のトランザクションクライアント型。
 * PrismaClient から $transaction / $connect などのトップレベル API を除いたもの。
 */
export type PrismaTx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
