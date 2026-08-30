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

/** applyDeltaAtomic の失敗理由。例外に頼らず判定結果として返す。 */
export type BalanceFailureReason = "insufficient" | "over_max" | "not_found";

/** applyDeltaAtomic の結果。ok=false のとき balance は更新前の値（変更なし）。 */
export interface ApplyDeltaResult {
  ok: boolean;
  /** 適用後（失敗時は現在）の残高。 */
  balance: number;
  reason?: BalanceFailureReason;
}

/**
 * DB 適用（原子）: トランザクション内で口座残高に delta を適用する。
 *
 * 【T1・lost update 対策】「読んで→計算して→書く」(read-modify-write) を廃止し、
 * 条件付き updateMany + decrement/increment により **判定と更新を DB の 1 文に統合**する。
 * これにより同時実行で残高を読み違えて片方の更新が消える lost update が構造的に発生しない。
 *
 * - delta < 0（減算）: `balance >= |delta|` を条件に decrement。条件不成立（count===0）は insufficient。
 *   残高が負になる更新は条件により発生しない（要件5-2/5-8/6-5）。
 * - delta > 0（加算）: `balance <= BALANCE_MAX - delta` を条件に increment。条件不成立は over_max（要件2-4/6-7）。
 * - delta === 0: 何もしない。
 *
 * 戻り値の残高は表示用に更新後を 1 回読むだけで、判定には用いない。
 */
export async function applyDeltaAtomic(
  tx: PrismaTx,
  accountId: string,
  delta: number,
): Promise<ApplyDeltaResult> {
  if (!Number.isInteger(delta)) {
    throw new BalanceRangeError(0, delta);
  }

  const readBalance = async (): Promise<number | null> => {
    const a = await tx.account.findUnique({
      where: { id: accountId },
      select: { balance: true },
    });
    return a ? a.balance : null;
  };

  if (delta === 0) {
    const b = await readBalance();
    if (b === null) return { ok: false, balance: 0, reason: "not_found" };
    return { ok: true, balance: b };
  }

  if (delta < 0) {
    const amount = -delta;
    // 条件付き原子減算: balance >= amount のときのみ decrement（残高は負にならない）
    const res = await tx.account.updateMany({
      where: { id: accountId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    if (res.count === 0) {
      const b = await readBalance();
      if (b === null) return { ok: false, balance: 0, reason: "not_found" };
      return { ok: false, balance: b, reason: "insufficient" };
    }
    const b = await readBalance();
    return { ok: true, balance: b ?? 0 };
  }

  // 条件付き原子加算: balance <= BALANCE_MAX - delta のときのみ increment（上限を超えない）
  const res = await tx.account.updateMany({
    where: { id: accountId, balance: { lte: BALANCE_MAX - delta } },
    data: { balance: { increment: delta } },
  });
  if (res.count === 0) {
    const b = await readBalance();
    if (b === null) return { ok: false, balance: 0, reason: "not_found" };
    return { ok: false, balance: b, reason: "over_max" };
  }
  const b = await readBalance();
  return { ok: true, balance: b ?? 0 };
}

/**
 * 後方互換ラッパ: 失敗時は BalanceRangeError を投げ、成功時は適用後残高を返す。
 * 内部で applyDeltaAtomic（原子更新）を用いるため lost update は発生しない。
 * 新規コードは applyDeltaAtomic を直接使うこと。
 */
export async function applyDelta(
  tx: PrismaTx,
  accountId: string,
  delta: number,
): Promise<number> {
  const result = await applyDeltaAtomic(tx, accountId, delta);
  if (!result.ok) {
    if (result.reason === "not_found") {
      throw new Error(`account not found: ${accountId}`);
    }
    throw new BalanceRangeError(result.balance, delta);
  }
  return result.balance;
}
