// 担当B所有: 支払いの冪等キー（要件5-6）。
//
// 【T2・時刻窓バグの除去】旧実装は受付時刻を60秒で床関数した「窓ID」をキーに含めていた。
// これには2つの欠陥があった:
//   (a) 窓境界（例 59.9秒 と 60.1秒）をまたぐ同一支払いが別キーになり二重減算しうる
//   (b) 同一窓内の「正当な2回目の同額支払い」が同一キーに畳まれて握りつぶされる
// よって時刻窓 floor を廃止し、キーは (terminal, amount, sessionId, clientRef) の決定的文字列とする。
//
// clientRef は呼び出し側（端末）が発行する一意 ID。これがあるとき冪等性は厳密になる。
// 型契約 src/types/api.ts（PayRequest）は凍結でフィールド追加できないため、
// clientRef 未指定時は時刻に依存しないフォールバックキーを用いる。
//
// キー自体は時刻非依存だが、**重複と判定する範囲**は charge.ts が
// IDEMPOTENCY_WINDOW_MS（既定60秒）の時間窓で絞る。これにより
//  - 窓境界で別キー化して二重減算する旧バグは発生せず
//  - 同一条件の「正当な2回目の支払い」は窓を過ぎれば通る（取り逃しを防ぐ）
// の両方を満たす（要件5-6）。

/** 重複と判定する時間窓（ミリ秒）。要件5-6 は60秒。charge.ts が既定値として用いる。 */
export const IDEMPOTENCY_WINDOW_MS = 60_000;

export interface IdempotencyKeyInput {
  terminal: string;
  amount: number;
  /** 対象滞在セッション。 */
  sessionId: string;
  /**
   * 呼び出し側（端末）が発行する一意 ID。指定時は厳密な冪等キーになる。
   * 未指定時は時刻非依存のフォールバックキーを生成する。
   */
  clientRef?: string;
}

/**
 * 決定的な冪等キー文字列を算出する。時刻に依存しない（T2）。
 * clientRef 指定時: `terminal:amount:sessionId:clientRef`（厳密）
 * clientRef 未指定時: `terminal:amount:sessionId:_` （同一条件は常に同一キー）
 */
export function computeIdempotencyKey(input: IdempotencyKeyInput): string {
  const ref = input.clientRef && input.clientRef.length > 0 ? input.clientRef : "_";
  return `${input.terminal}:${input.amount}:${input.sessionId}:${ref}`;
}
