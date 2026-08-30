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
 * 指定時刻が属する営業日の終了時刻（＝その日の閉場時刻）を返す。
 * ローカルタイムゾーンの当日 BUSINESS_CLOSE_HOUR:BUSINESS_CLOSE_MINUTE:00.000 を用いる。
 */
export function businessDayEnd(at: Date = new Date()): Date {
  const end = new Date(at);
  end.setHours(BUSINESS_CLOSE_HOUR, BUSINESS_CLOSE_MINUTE, 0, 0);
  return end;
}
