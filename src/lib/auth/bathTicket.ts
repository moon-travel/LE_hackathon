// 入浴券台帳。
// _Requirements: 3.8, 4.4, 4.7_
//
// 設計の根拠は docs/design/A-auth-session-retention.md 4章。要約:
//
//   凍結スキーマに入浴券のテーブルがない。`Pass` は用語定義上「入浴以外の有料権利（別室利用権
//   など）」であり流用できない（流用すると入浴券を買っただけで別室に入れてしまい、要件7-4の
//   「有効な利用権がない→購入案内」が到達不能になる）。
//
//   そこで `AuditLog` を追記専用の入場権台帳として使う。`AuditLog` は eventType 自由の追記専用
//   テーブルで、入場券の発行は監査対象事象でもあるため置き場所として無理がない。要件14-4の
//   追記専用制約にも沿い、状態はイベントの畳み込みで導出する。
//
//   券の消費処理は持たない。要件4-1が ACTIVE 中の通過回数を無制限とし、要件4-4も同一営業日の
//   再入場を当日券で認めるため、当日中は有効なままでよい。
//
// 将来テーブル化する場合は本ファイルの2関数の実装だけ差し替えれば呼び出し側は無変更で済む。

import { prisma } from "@/lib/db";
import { AuditEvent, appendAudit } from "./audit";
import { businessDateOf, businessDayRange } from "./businessDay";

export interface IssueBathTicketResult {
  issued: boolean;
  businessDate: string;
  /** 当日すでに発行済みだった場合 true（重複発行はしない）。 */
  alreadyIssued: boolean;
}

/**
 * 当日有効な入浴券が存在するか（要件3-8 / 4-4 / 4-7）。
 * 当該アカウントの当日 BATH_TICKET_ISSUED エントリが1件以上あるかで判定する。
 */
export async function hasValidBathTicket(
  accountId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { start, end } = businessDayRange(now);
  const found = await prisma.auditLog.findFirst({
    where: {
      eventType: AuditEvent.BATH_TICKET_ISSUED,
      accountId,
      ts: { gte: start, lte: end },
    },
    select: { id: true },
  });
  return found !== null;
}

/**
 * 入浴券を発行する（券売機での購入相当）。
 *
 * 登録（/api/enroll）では自動発行しない。自動発行すると母集団（当日ACTIVE ∪ 当日登録）に入る
 * 全アカウントが必ず券を持つことになり、要件3-8の拒否分岐が到達不能になって受入基準を
 * 検証できなくなる。
 */
export async function issueBathTicket(
  accountId: string,
  now: Date = new Date(),
): Promise<IssueBathTicketResult> {
  const businessDate = businessDateOf(now);

  if (await hasValidBathTicket(accountId, now)) {
    return { issued: false, businessDate, alreadyIssued: true };
  }

  await appendAudit({
    eventType: AuditEvent.BATH_TICKET_ISSUED,
    accountId,
    ts: now,
    detail: { businessDate },
  });

  return { issued: true, businessDate, alreadyIssued: false };
}
