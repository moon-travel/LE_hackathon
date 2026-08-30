// 担当B所有: 営業日終了時刻の算出（要件7-1）。
// 利用権の有効期間終了時刻＝購入日の営業日終了時刻。
//
// 既定（デモ設定・明示）: 施設の閉場時刻を「その日の 23:00（ローカル時刻）」とする。
// 購入時刻がその日の閉場時刻以降であっても、当日の営業日終了時刻を用いる（当日券の前提）。
// 実運用では施設の閉場時刻設定に置き換える。ここでは MVP デモ用に固定値で明示する。

/** デモ用の閉場時刻（時）。実運用では施設設定に置換。 */
export const BUSINESS_CLOSE_HOUR = 23;
/** デモ用の閉場時刻（分）。 */
export const BUSINESS_CLOSE_MINUTE = 0;
/**
 * デモ用の開場時刻（時）。実運用では施設設定に置換。
 * 深夜営業（閉場時刻を跨いで翌朝まで）を表現するため、
 * 「開場時刻より前の時間帯は前営業日の延長」と解釈する。
 */
export const BUSINESS_OPEN_HOUR = 6;

/**
 * 指定時刻が属する営業日の終了時刻（＝閉場時刻）を返す。要件7-1。
 *
 * 【T6・境界バグ修正】旧実装は常に「当日の閉場時刻」を返していたため、
 * 閉場後（23:00〜）や深夜（0:00〜）に購入すると expiresAt <= now となり、
 * 発行直後に失効する利用権が生まれていた。
 *
 * 判定:
 *  - 時刻が開場時刻より前（深夜帯 0:00〜BUSINESS_OPEN_HOUR）→ 前営業日の延長とみなし、
 *    当日の閉場時刻を営業日終了とする（当日中に必ず未来になる）
 *  - 時刻が当日の閉場時刻以降 → 翌日の閉場時刻を営業日終了とする
 *  - それ以外（通常営業中）→ 当日の閉場時刻
 *
 * いずれの場合も戻り値は at より必ず未来になる。
 */
export function businessDayEnd(at: Date = new Date()): Date {
  const end = new Date(at);
  end.setHours(BUSINESS_CLOSE_HOUR, BUSINESS_CLOSE_MINUTE, 0, 0);

  const hour = at.getHours();

  // 深夜帯（開場前）は前営業日の延長。当日の閉場時刻はまだ未来なのでそのまま使える。
  if (hour < BUSINESS_OPEN_HOUR) {
    return end;
  }

  // 閉場時刻以降に購入した場合は翌営業日の閉場時刻まで有効とする（即失効を防ぐ）。
  if (end.getTime() <= at.getTime()) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}
