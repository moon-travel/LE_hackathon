// 担当B所有: 残高減算（支払い）の原子的実行と冪等性（判断3・最重要）。
// ACID と冪等を prisma.$transaction に閉じ込める:
//   1. 冪等キーで既存取引検索 → あれば最初の結果を返す（二重減算しない、要件5-6）
//   2. 残高チェック（不足は insufficient で中断、減算も立替もしない、要件5-8/6-5）
//   3. applyDelta で減算（要件5-2）
//   4. transactions(JSON文字列列)に取引追記（要件5-2）
// 途中失敗は $transaction が自動ロールバック（要件5-9）。金額は整数円（判断5）。
import { ulid } from "ulid";
import { prisma } from "./prisma";
import type { PrismaTx } from "./prisma";
import { applyDelta } from "./balance";
import {
  parseTransactions,
  stringifyTransactions,
  type TransactionRecord,
} from "./serde";

/** chargeAtomic の結果種別。 */
export type ChargeOutcome = "paid" | "insufficient" | "duplicate";

export interface ChargeResult {
  outcome: ChargeOutcome;
  /** 減算後（または既存取引時点）の残高。 */
  balance: number;
  /** 成立/既存取引の識別子（insufficient 時は undefined）。 */
  transactionId?: string;
  /** duplicate の場合、最初の取引レコード。 */
  existing?: TransactionRecord;
}

export interface ChargeInput {
  accountId: string;
  sessionId: string;
  amount: number;
  terminal: string;
  /** 冪等キー（idempotency.computeIdempotencyKey で算出）。 */
  idempotencyKey: string;
  /** 取引日時（省略時 new Date()）。 */
  now?: Date;
}

/**
 * 純関数: 減算判定の中核。冪等・残高チェックのロジックを DB から切り離して検証可能にする。
 * - 既存取引（同一 idempotencyKey）があれば duplicate（正味減算0）
 * - 残高 < amount なら insufficient（減算しない・立替しない）
 * - それ以外は paid（ちょうど amount 減算）
 */
export function decideCharge(
  balance: number,
  amount: number,
  existingTransactions: TransactionRecord[],
  idempotencyKey: string,
): { outcome: ChargeOutcome; existing?: TransactionRecord } {
  const existing = existingTransactions.find(
    (t) => t.kind === "pay" && t.idempotencyKey === idempotencyKey,
  );
  if (existing) {
    return { outcome: "duplicate", existing };
  }
  if (balance < amount) {
    return { outcome: "insufficient" };
  }
  return { outcome: "paid" };
}

/**
 * トランザクション内での減算処理本体。$transaction のコールバックから呼ぶ。
 * 冪等・残高チェックの上で applyDelta し取引を追記する。
 */
export async function chargeInTx(
  tx: PrismaTx,
  input: ChargeInput,
): Promise<ChargeResult> {
  const now = input.now ?? new Date();

  const session = await tx.session.findUnique({
    where: { id: input.sessionId },
    select: { transactions: true, accountId: true },
  });
  if (!session) {
    throw new Error(`session not found: ${input.sessionId}`);
  }

  const account = await tx.account.findUnique({
    where: { id: input.accountId },
    select: { balance: true },
  });
  if (!account) {
    throw new Error(`account not found: ${input.accountId}`);
  }

  const records = parseTransactions(session.transactions);
  const decision = decideCharge(
    account.balance,
    input.amount,
    records,
    input.idempotencyKey,
  );

  if (decision.outcome === "duplicate") {
    return {
      outcome: "duplicate",
      balance: account.balance,
      transactionId: decision.existing?.transactionId,
      existing: decision.existing,
    };
  }

  if (decision.outcome === "insufficient") {
    return { outcome: "insufficient", balance: account.balance };
  }

  // paid: 減算 → 取引追記（同一トランザクション内。片方失敗で全体ロールバック）
  const newBalance = await applyDelta(tx, input.accountId, -input.amount);
  const transactionId = ulid();
  const record: TransactionRecord = {
    transactionId,
    kind: "pay",
    amount: input.amount,
    ts: now.toISOString(),
    terminal: input.terminal,
    idempotencyKey: input.idempotencyKey,
    balanceAfter: newBalance,
  };
  records.push(record);
  await tx.session.update({
    where: { id: input.sessionId },
    data: { transactions: stringifyTransactions(records) },
  });

  return { outcome: "paid", balance: newBalance, transactionId };
}

/**
 * 支払いの原子的実行（要件5-2/5-6/5-9）。$transaction でロールバック保証。
 * 依存注入のため client を差し替え可能（テストで一時DBクライアントを渡す）。
 */
export async function chargeAtomic(
  input: ChargeInput,
  client: typeof prisma = prisma,
): Promise<ChargeResult> {
  return client.$transaction((tx) => chargeInTx(tx as unknown as PrismaTx, input));
}
