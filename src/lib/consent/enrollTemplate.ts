// 担当C — template storage with the 5-template cap + oldest eviction.
// Requirements 9.3, 9.4. Kept as a small module so enroll route stays thin.
import { prisma } from "@/lib/db";
import { encodeTemplate } from "@/lib/codec";
import { appendAudit } from "@/lib/audit/log";
import type { FaceVector } from "@/types/vector";
// バージョン識別子は担当A の対応バージョン一覧と同一の定数を使う。別の文字列を書くと
// 対応バージョン外として 1:N 識別の母集団から除外され、その顔で認証できなくなる（要件9-10）。
import { CURRENT_MODEL_VERSION } from "@/lib/auth/modelVersion";

/** 1アカウントあたりの保管テンプレート上限（要件9-3）。 */
export const MAX_TEMPLATES_PER_ACCOUNT = 5;

export interface StoreResult {
  templateId: string;
  templateCount: number;
  evictedOldest: boolean;
}

/**
 * Store a new template for an account, enforcing the max-5 rule by evicting the
 * OLDEST template first when already at the cap (要件9.3, 9.4). Eviction +
 * insert run in one transaction so the set never exceeds 5 and rolls back on
 * failure (要件9.4, 1.11).
 */
export async function storeTemplate(
  accountId: string,
  vector: FaceVector,
): Promise<StoreResult> {
  const encoded = encodeTemplate(vector, CURRENT_MODEL_VERSION);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.faceTemplate.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true },
    });

    let evictedOldest = false;
    if (existing.length >= MAX_TEMPLATES_PER_ACCOUNT) {
      // Delete the oldest (ties broken by insertion order = first in asc list).
      const oldest = existing[0];
      await tx.faceTemplate.delete({ where: { id: oldest.id } });
      evictedOldest = true;
    }

    const created = await tx.faceTemplate.create({
      data: { accountId, vector: encoded, modelVersion: CURRENT_MODEL_VERSION },
      select: { id: true },
    });

    const count = await tx.faceTemplate.count({ where: { accountId } });
    return { templateId: created.id, templateCount: count, evictedOldest };
  }).then(async (res) => {
    await appendAudit(
      "enroll",
      { templateCount: res.templateCount, evictedOldest: res.evictedOldest },
      accountId,
    );
    return res;
  });
}
