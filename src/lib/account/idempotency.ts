// 担当B所有: 支払いの冪等キー（要件5-6）。
// 判断3: 時刻窓ではなく決定的キー文字列（terminal:amount:sessionId:窓ID）で同一窓を同一キーに畳む。
// 「同一の Service_Terminal・同一の支払い金額・同一の滞在セッションを対象とする要求」を
// 一定時間窓（既定60秒）で1件に畳む。窓IDは受付時刻を窓幅で床関数した決定的な値。

/** 冪等の時間窓（ミリ秒）。要件5-6 は60秒。 */
export const IDEMPOTENCY_WINDOW_MS = 60_000;

export interface IdempotencyKeyInput {
  terminal: string;
  amount: number;
  /** 対象滞在セッション。未指定はアカウント単位に代替（呼び出し側で accountId を渡す）。 */
  sessionId: string;
  /** 受付時刻（ms）。省略時は Date.now()。 */
  now?: number;
  /** 時間窓幅（ms）。省略時は IDEMPOTENCY_WINDOW_MS。 */
  windowMs?: number;
}

/**
 * 決定的な冪等キー文字列を算出する。
 * 同一 (terminal, amount, sessionId) かつ同一時間窓の要求は同一キーになる。
 */
export function computeIdempotencyKey(input: IdempotencyKeyInput): string {
  const now = input.now ?? Date.now();
  const windowMs = input.windowMs ?? IDEMPOTENCY_WINDOW_MS;
  const windowId = Math.floor(now / windowMs);
  return `${input.terminal}:${input.amount}:${input.sessionId}:${windowId}`;
}
