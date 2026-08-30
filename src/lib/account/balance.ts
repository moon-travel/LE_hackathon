// 担当B所有: 残高操作の単一入口（判断2）。
// 残高を書き換えるのはこのモジュールの applyDelta だけ。charge/withdraw/autoCharge/topup は全てこれを通す。
// 0〜50000円範囲検証を内包し、範囲外は BalanceRangeError。残高を負にしない。金額は整数円（判断5）。
import { BALANCE_MAX, BALANCE_MIN } from "./constants";
import type { PrismaTx } from "./prisma";

/** 残高範囲（0〜50000）を逸脱する操作が要求されたときの例外（要件6-5）。 */
export class BalanceRangeError extends Error {
  readonly current: number;
  readonly delta: number;
  readonly attempted: number;

  constructor(current: number, delta: number) {
    const attempted = current + delta;
    super(
      `balance out of range: current=${current} delta=${delta} attempted=${attempted} (allowed ${BALANCE_MIN}..${BALANCE_MAX})`,
    );
    this.name = "BalanceRangeError";
    this.current = current;
    this.delta = delta;
    this.attempted = attempted;
  }
}

/**
 * 純関数: 現在残高に delta を適用した新残高を返す。
 * 範囲外（0未満 or 50000超）または非整数は BalanceRangeError を投げる。
 * 立替や負残高は発生しない（減算で0未満になる要求は拒否）。要件5-2/6-5。
 */
export function computeNewBalance(current: number, delta: number): number {
  if (!Number.isInteger(current) || !Number.isInteger(delta)) {
    throw new BalanceRangeError(current, delta);
  }
  const next = current + delta;
  if (next < BALANCE_MIN || next > BALANCE_MAX) {
    throw new BalanceRangeError(current, delta);
  }
  return next;
}

/**
 * DB 適用: トランザクション内で口座残高に delta を適用する。
 * 現在残高を読み出し computeNewBalance で検証してから更新する。
 * 範囲外は BalanceRangeError を投げ（$transaction はロールバック）、残高を変更しない。
 * 戻り値は適用後の残高。
 */
export async function applyDelta(
  tx: PrismaTx,
  accountId: string,
  delta: number,
): Promise<number> {
  const account = await tx.account.findUnique({
    where: { id: accountId },
    select: { balance: true },
  });
  if (!account) {
    throw new Error(`account not found: ${accountId}`);
  }
  const next = computeNewBalance(account.balance, delta);
  await tx.account.update({
    where: { id: accountId },
    data: { balance: next },
  });
  return next;
}
