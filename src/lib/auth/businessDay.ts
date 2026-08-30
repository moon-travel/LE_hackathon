// 営業日の境界。要件3-2「当日ACTIVE + 当日登録」の判定に使う。
//
// 【未決事項】要件Glossary の「営業日」は開場時刻〜閉場時刻だが、施設の営業時間が未確定
// （docs/design/A-auth-session-retention.md 7.3節）。MVP ではローカル暦日（00:00〜23:59:59.999）
// を営業日として扱う。閉場時刻が決まったらこのファイルだけを差し替える。

/** 営業日識別子（YYYY-MM-DD、ローカルタイム）。 */
export function businessDateOf(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 指定時刻が属する営業日の開始・終了時刻。終了は当日の 23:59:59.999。 */
export function businessDayRange(at: Date): { start: Date; end: Date } {
  const start = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
  const end = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59, 999);
  return { start, end };
}

/** 2つの時刻が同一営業日か。 */
export function isSameBusinessDay(a: Date, b: Date): boolean {
  return businessDateOf(a) === businessDateOf(b);
}
