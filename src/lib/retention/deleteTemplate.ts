// Retention_Service: 同期削除（本体）と保管期限の設定。
// _Requirements: 1.12, 8.2, 8.8, 10.6, 10.7, 10.8, 10.9, 10.11_
//
// 削除の契機は「保管期限の到来（scanner.ts）」と「利用者の削除要求・同意撤回（本ファイル）」の
// 2つだけ。**退場は削除の契機ではない**。退場時は setExpireAtForAccount で保管期限を置くだけで、
// 実際の削除は期限到来か利用者要求のいずれかで起きる。
// 退場即削除にすると expireAt が無意味になり、保管期間（要件10-1: 既定7日 / 10-2: 顧客指定
// 1〜90日）が常に0日になって要件を満たせないため（docs/design/A-auth-session-retention.md 7.1節）。

import { AuditEvent, prismaRetentionStore } from "./store";
import type { DeletionTrigger, RetentionStore } from "./store";
import { computeExpireAt } from "./computeExpireAt";

export interface DeleteResult {
  /** 実際に削除したテンプレート件数。 */
  deletedCount: number;
  /**
   * ACTIVE セッション保持中のため削除を延期したか（要件10-8）。
   * 延期時は expireAt = now を書き込み、セッション終了後の走査で削除される。
   */
  deferred: boolean;
}

/**
 * 当該アカウントの顔特徴量テンプレートを同期削除する（要件10-7 / 1-12）。
 *
 * ACTIVE セッションが存在する場合は削除せず、`expireAt = now` を書き込んで延期する（要件10-8）。
 * 走査側は ACTIVE 保持アカウントをスキップするため、CLOSED / FORCE_CLOSED 遷移後の最初の走査で
 * 削除される。専用の delete-pending フラグを持たないのは、凍結スキーマを変更しないための設計
 * （docs/design/A-auth-session-retention.md 5.3節）。
 *
 * 削除対象は FaceTemplate のみ。残高・カードトークン・利用権・取引記録は削除対象に含めない
 * （要件2-9 / 10-9）。
 */
export async function deleteTemplatesForAccount(
  accountId: string,
  trigger: DeletionTrigger,
  store: RetentionStore = prismaRetentionStore,
  now: Date = new Date(),
): Promise<DeleteResult> {
  const templates = await store.listTemplatesByAccount(accountId);
  if (templates.length === 0) {
    return { deletedCount: 0, deferred: false };
  }

  if (await store.hasActiveSession(accountId)) {
    // 要件10-8: ACTIVE セッションが終了するまで削除を延期する。
    await store.setExpireAtForAccount(accountId, now);
    await store.appendAudit({
      eventType: AuditEvent.TEMPLATE_DELETED,
      accountId,
      ts: now,
      detail: {
        trigger,
        deferred: true,
        message: "ACTIVE セッション保持中のため削除を延期。セッション終了後に削除される",
      },
    });
    return { deletedCount: 0, deferred: true };
  }

  const deletedCount = await store.deleteTemplatesByIds(templates.map((t) => t.id));

  // 要件10-6: 削除日時・対象アカウント識別子・削除の契機を記録し、テンプレートの内容は記録しない。
  await store.appendAudit({
    eventType: AuditEvent.TEMPLATE_DELETED,
    accountId,
    ts: now,
    detail: { trigger, deletedCount, deferred: false },
  });

  return { deletedCount, deferred: false };
}

/**
 * 退場（または強制クローズ）に伴い保管期限を設定する（要件8-2 / 8-8）。
 * **削除はしない。** 期限を置くだけ。
 */
export async function setRetentionDeadline(
  accountId: string,
  exitedAt: Date,
  retentionDays: number,
  store: RetentionStore = prismaRetentionStore,
): Promise<{ expireAt: Date; updatedCount: number }> {
  const expireAt = computeExpireAt(exitedAt, retentionDays);
  const updatedCount = await store.setExpireAtForAccount(accountId, expireAt);
  return { expireAt, updatedCount };
}
