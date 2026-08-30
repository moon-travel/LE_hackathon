// Retention_Service のストアポート。
//
// 削除ロジックを DB から切り離すための境界。本番経路は Prisma 実装、プロパティテストは
// インメモリ実装を注入する。Property 12（削除後の照合不成立）を DB なしで検証できるようにする
// ためにこの分離を入れている。

import { prisma } from "@/lib/db";
import { AuditEvent, appendAudit } from "@/lib/auth/audit";
import type { AuditEntry } from "@/lib/auth/audit";

/** 削除対象テンプレートの最小形。ベクトルは JSON 文字列（SQLite は Json 非対応）。 */
export interface TemplateLike {
  id: string;
  accountId: string;
  vector: string;
  expireAt: Date | null;
}

/** 削除の契機（要件10-6 が監査ログへ記録することを求める区分）。 */
export type DeletionTrigger = "EXPIRED" | "USER_REQUEST";

export interface RetentionStore {
  listTemplatesByAccount(accountId: string): Promise<TemplateLike[]>;
  /** 当該アカウントに状態 ACTIVE の滞在セッションが存在するか（要件10-8）。 */
  hasActiveSession(accountId: string): Promise<boolean>;
  /** 指定 id のテンプレートを削除し、削除件数を返す。 */
  deleteTemplatesByIds(ids: readonly string[]): Promise<number>;
  /** 当該アカウントの全テンプレートの expireAt を書き換え、件数を返す。 */
  setExpireAtForAccount(accountId: string, expireAt: Date): Promise<number>;
  /** expireAt <= now のテンプレートを列挙する（要件10-4 / 10-5）。 */
  listExpired(now: Date): Promise<TemplateLike[]>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

/** 本番経路の Prisma 実装。触るのは FaceTemplate と読み取り専用の Session のみ（要件10-9）。 */
export const prismaRetentionStore: RetentionStore = {
  async listTemplatesByAccount(accountId) {
    return prisma.faceTemplate.findMany({
      where: { accountId },
      select: { id: true, accountId: true, vector: true, expireAt: true },
    });
  },

  async hasActiveSession(accountId) {
    const found = await prisma.session.findFirst({
      where: { accountId, state: "ACTIVE" },
      select: { id: true },
    });
    return found !== null;
  },

  async deleteTemplatesByIds(ids) {
    if (ids.length === 0) return 0;
    const result = await prisma.faceTemplate.deleteMany({ where: { id: { in: [...ids] } } });
    return result.count;
  },

  async setExpireAtForAccount(accountId, expireAt) {
    const result = await prisma.faceTemplate.updateMany({
      where: { accountId },
      data: { expireAt },
    });
    return result.count;
  },

  async listExpired(now) {
    return prisma.faceTemplate.findMany({
      where: { expireAt: { not: null, lte: now } },
      select: { id: true, accountId: true, vector: true, expireAt: true },
      orderBy: { expireAt: "asc" },
    });
  },

  appendAudit,
};

export { AuditEvent };
