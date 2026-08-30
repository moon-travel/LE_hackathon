// 担当B所有: 残高減算（支払い）の原子的実行と冪等性（判断3・最重要）。
// ACID と冪等を prisma.$transaction に閉じ込める（要件5-2/5-6/5-9）。
//
// 【T1/T2 で改修】
//  - 減算は balance.applyDeltaAtomic による条件付き原子更新（read-modify-write を廃止）
//  - 冪等キーは時刻窓に依存しない決定的キー（idempotency.ts）
//  - 順序を「重複確認 → 原子減算 → 追記直前の再確認 → 追記」に反転し二重減算の窓を閉じる
//
// 【Phase2 への申し送り（要スキーマ変更）】
// 取引は Session.transactions(JSON文字列) に格納されており、JSON 列には一意制約を張れない。
// 完全な冪等保証には独立した Transaction テーブル + idempotencyKey @unique が必要で、
// 二重挿入を P2002 で検出する形が本来の解。prisma/schema.prisma は現在凍結中のため、
// Phase2 統合時に Phase0 担当へスキーマ追加を依頼すること。
import { ulid } from "ulid";
import { prisma } from "./prisma";
import type { PrismaTx } from "./prisma";
import { applyDeltaAtomic } from "./balance";
import { IDEMPOTENCY_WINDOW_MS } from "./idempotency";
import {
  parseTransactions,
  stringifyTransactions,
  type TransactionRecord,
} from "./serde";

/**
 * 追記直前の再確認で同一冪等キーの取引が出現したときに投げる内部例外。
 * $transaction をロールバックさせ、直前の減算を確実に戻す目的で用いる。
 */
export class DuplicateChargeError extends Error {
  readonly idempotencyKey: string;
  constructor(idempotencyKey: string) {
    super(`duplicate charge detected: ${idempotencyKey}`);
    this.name = "DuplicateChargeError";
    this.idempotencyKey = idempotencyKey;
  }
}

/**
 * chargeAtomic の結果種別。
 * - paid: 減算成立
 * - insufficient: 残高不足（減算なし）
 * - duplicate: 同一冪等キーの既存取引あり（減算なし。既存の取引結果を返す）
 * - conflict: 競合を検出したが既存取引を特定できなかった（減算なし。支払い成立と扱ってはならない）
 */
export type ChargeOutcome = "paid" | "insufficient" | "duplicate" | "conflict";

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
  /**
   * 重複と判定する時間窓（ミリ秒）。既定 IDEMPOTENCY_WINDOW_MS（60秒、要件5-6）。
   * この窓より古い同一キー取引は重複とみなさない（＝正当な2回目の支払いは通る）。
   * clientRef 由来の厳密キーを使う場合は Infinity を指定して無期限にできる。
   */
  duplicateWindowMs?: number;
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
 *
 * 【T2・順序の反転】旧実装は「冪等検索 → 残高判定 → 減算」の順で、検索と減算の間に
 * 別リクエストが割り込むと両方が「既存なし」と読んで二重減算しうる窓があった。
 * 新実装は「(1)既存重複の確認 → (2)原子減算(applyDeltaAtomic) → (3)取引追記 →
 * (4)追記直前の再確認で重複が現れていたら例外でロールバック」とし、
 * 減算自体が条件付き原子更新（T1）であることと合わせて二重減算の窓を閉じる。
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

  const records = parseTransactions(session.transactions);
  const windowMs = input.duplicateWindowMs ?? IDEMPOTENCY_WINDOW_MS;

  // (1) 既存の同一冪等キー取引があれば duplicate（正味減算0、要件5-6）
  const existing = findByIdempotencyKey(
    records,
    input.idempotencyKey,
    now,
    windowMs,
  );
  if (existing) {
    const bal = await readBalance(tx, input.accountId);
    return {
      outcome: "duplicate",
      balance: bal,
      transactionId: existing.transactionId,
      existing,
    };
  }

  // (2) 原子減算。残高不足は条件不成立として判定され、残高は変更されない（T1）
  const applied = await applyDeltaAtomic(tx, input.accountId, -input.amount);
  if (!applied.ok) {
    if (applied.reason === "not_found") {
      throw new Error(`account not found: ${input.accountId}`);
    }
    // insufficient / over_max いずれも減算不成立。残高不変で返す
    return { outcome: "insufficient", balance: applied.balance };
  }

  // (3) 取引追記。直前に再読込して重複の出現を確認する
  const fresh = await tx.session.findUnique({
    where: { id: input.sessionId },
    select: { transactions: true },
  });
  const freshRecords = parseTransactions(fresh?.transactions);
  if (findByIdempotencyKey(freshRecords, input.idempotencyKey, now, windowMs)) {
    // (4) 競合により重複が生じた → 例外で $transaction をロールバックし減算も戻す
    throw new DuplicateChargeError(input.idempotencyKey);
  }

  const transactionId = ulid();
  const record: TransactionRecord = {
    transactionId,
    kind: "pay",
    amount: input.amount,
    ts: now.toISOString(),
    terminal: input.terminal,
    idempotencyKey: input.idempotencyKey,
    balanceAfter: applied.balance,
  };
  freshRecords.push(record);
  await tx.session.update({
    where: { id: input.sessionId },
    data: { transactions: stringifyTransactions(freshRecords) },
  });

  return { outcome: "paid", balance: applied.balance, transactionId };
}

/**
 * 取引履歴から同一冪等キーの支払い取引を探す。
 *
 * 【最終監査の修正】時間窓を導入する。旧実装は履歴全体を無期限に検索していたため、
 * 同一セッション・同一端末・同一金額の「正当な2回目の支払い」が永久に重複扱いとなり、
 * 減算されないまま成功が返る取り逃しが発生していた（要件5-6 の60秒窓から乖離）。
 * windowMs 以内の同一キー取引のみを重複とみなす。
 */
function findByIdempotencyKey(
  records: TransactionRecord[],
  idempotencyKey: string,
  now: Date,
  windowMs: number,
): TransactionRecord | undefined {
  const nowMs = now.getTime();
  return records.find((t) => {
    if (t.kind !== "pay" || t.idempotencyKey !== idempotencyKey) return false;
    if (!Number.isFinite(windowMs)) return true; // 無期限指定
    const ts = Date.parse(t.ts);
    if (Number.isNaN(ts)) return true; // 日時不明は安全側（重複とみなす）
    return nowMs - ts <= windowMs;
  });
}

/** 表示用に現在残高を読む（判定には用いない）。 */
async function readBalance(tx: PrismaTx, accountId: string): Promise<number> {
  const a = await tx.account.findUnique({
    where: { id: accountId },
    select: { balance: true },
  });
  return a?.balance ?? 0;
}

/**
 * 支払いの原子的実行（要件5-2/5-6/5-9）。$transaction でロールバック保証。
 * 依存注入のため client を差し替え可能（テストで一時DBクライアントを渡す）。
 */
export async function chargeAtomic(
  input: ChargeInput,
  client: typeof prisma = prisma,
): Promise<ChargeResult> {
  try {
    return await client.$transaction((tx) =>
      chargeInTx(tx as unknown as PrismaTx, input),
    );
  } catch (e) {
    if (e instanceof DuplicateChargeError) {
      // 競合で重複が確定した場合、減算はロールバック済み。最初の取引結果を返す（要件5-6）。
      const session = await client.session.findUnique({
        where: { id: input.sessionId },
        select: { transactions: true },
      });
      const records = parseTransactions(session?.transactions);
      const existing = records.find(
        (t) => t.kind === "pay" && t.idempotencyKey === input.idempotencyKey,
      );
      const account = await client.account.findUnique({
        where: { id: input.accountId },
        select: { balance: true },
      });
      // 【最終監査の修正】existing を特定できない場合に duplicate を返すと、
      // 呼び出し側が「支払い成立」に変換して減算も記録もないまま成功を表示してしまう。
      // 既存取引を提示できないなら duplicate と断定せず conflict として返す。
      if (!existing) {
        return { outcome: "conflict", balance: account?.balance ?? 0 };
      }
      return {
        outcome: "duplicate",
        balance: account?.balance ?? 0,
        transactionId: existing.transactionId,
        existing,
      };
    }
    throw e;
  }
}
