// Retention_Service: 保管期限の算定。
// _Requirements: 8.2, 8.8, 10.1, 10.2, 10.3_
//
// CLOSED（要件8-2）と FORCE_CLOSED（要件8-8）の両経路から呼べるよう独立させている。
// FORCE_CLOSED の場合 exitedAt には閉場時刻を渡す。

/** 基本保管期間（日）。要件Glossary「基本保管期間」= 7日。 */
export const DEFAULT_RETENTION_DAYS = 7;

/** 顧客指定保管期間の下限・上限（日）。要件10-2 / 10-3。 */
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 90;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 保管期間設定が範囲外（要件10-3）。 */
export class RetentionDaysOutOfRangeError extends Error {
  readonly reason = "retention_days_out_of_range";
  constructor(readonly given: number) {
    super(`retentionDays must be ${MIN_RETENTION_DAYS}..${MAX_RETENTION_DAYS}, got ${given}`);
    this.name = "RetentionDaysOutOfRangeError";
  }
}

/**
 * 保管期限を算定する。
 *
 *   expireAt = exitedAt + retentionDays 日
 *
 * 起算点は要件8で記録された退場時刻（要件10-1）。保管期間設定は当該アカウントの
 * retentionDays（既定7、顧客指定1〜90。要件10-1 / 10-2）。
 *
 * 入力検証の本体は登録端末側（担当C、要件10-3）だが、範囲外を静かに受け入れると
 * 保管期間の要件が崩れるため算定側でも例外にして二重に防ぐ。
 *
 * Property 11 の一部（`expireAt = exitedAt + retentionDays`）が検証する対象。
 */
export function computeExpireAt(exitedAt: Date, retentionDays: number): Date {
  if (
    !Number.isInteger(retentionDays) ||
    retentionDays < MIN_RETENTION_DAYS ||
    retentionDays > MAX_RETENTION_DAYS
  ) {
    throw new RetentionDaysOutOfRangeError(retentionDays);
  }
  return new Date(exitedAt.getTime() + retentionDays * MS_PER_DAY);
}
