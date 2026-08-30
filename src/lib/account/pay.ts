// 担当B所有: /api/pay のハンドラ本体（純関数化しポート注入可能に。判断1）。
// identify結果を IdentifyPort で受け、matched(1件)かつ残高十分なら chargeAtomic。
// none/ambiguous（5-5/5-7）、残高不足（5-8→6）、チャージ提示・オートチャージ（6-1〜6-4/6-9）、
// 決済拒否時は残高不変（6-6）。金額検証・冪等キー算出も担う。
import { ulid } from "ulid";
import type { PayRequest, PayResponse } from "@/types/api";
import { prisma } from "./prisma";
import { chargeAtomic } from "./charge";
import { applyDeltaAtomic } from "./balance";
import { computeIdempotencyKey } from "./idempotency";
import { parseTransactions, stringifyTransactions } from "./serde";
import {
  BALANCE_MAX,
  CARD_FAILURE_LIMIT,
  CHARGE_OPTIONS,
  PAY_MAX,
  PAY_MIN,
} from "./constants";
import type { IdentifyPort, AuditPort } from "./ports";
import { noopAuditPort } from "./ports";
import { defaultGateway, type PaymentGateway } from "@/lib/payment-mock/gateway";
import type { PrismaTx } from "./prisma";

export interface PayDeps {
  identifyPort: IdentifyPort;
  gateway?: PaymentGateway;
  auditPort?: AuditPort;
  client?: typeof prisma;
  now?: Date;
  /**
   * 端末が発行する一意 ID（冪等キーの一部、T2）。
   * src/types/api.ts の PayRequest は凍結でフィールド追加できないため、
   * 型契約外の注入経路としてここで受け取る。未指定時は時刻非依存の
   * フォールバックキー（terminal:amount:sessionId:_）になる。
   */
  clientRef?: string;
  /**
   * 同一取引におけるカード決済失敗の通算回数（要件6-9）。
   * 呼び出し側（端末セッション）が保持し再試行時に引き継ぐ。
   * CARD_FAILURE_LIMIT に達すると取引を中止する。
   */
  cardFailureCount?: number;
}

/** バリデーション結果を含む pay の内部結果。HTTP ステータスも返す。 */
export interface PayHandlerResult {
  status: number;
  body: PayResponse;
}

/**
 * オートチャージを試みる（要件6-3）。有効かつカード有り、決済成功時のみ残高加算。
 * 加算後の残高が支払い金額以上になったかを呼び出し側で再判定する。
 * 戻り値: 加算した金額（0=何もしなかった / 失敗）。
 */
async function tryAutoCharge(
  client: typeof prisma,
  accountId: string,
  sessionId: string,
  shortfallAtLeast: number,
  gateway: PaymentGateway,
  now: Date,
): Promise<{ added: number; declined: boolean }> {
  const account = await client.account.findUnique({
    where: { id: accountId },
    select: {
      autoChargeEnabled: true,
      autoChargeAmount: true,
      cardToken: true,
      balance: true,
    },
  });
  if (
    !account ||
    !account.autoChargeEnabled ||
    !account.cardToken ||
    !account.autoChargeAmount
  ) {
    return { added: 0, declined: false };
  }
  const amount = account.autoChargeAmount;
  // 加算後上限超過なら実行しない（要件6-7）
  if (account.balance + amount > BALANCE_MAX) return { added: 0, declined: false };
  // オートチャージしても足りないなら実行しない（要件6-3: 加算後が支払い金額以上になる場合のみ継続）
  if (account.balance + amount < shortfallAtLeast) {
    return { added: 0, declined: false };
  }

  // 外部決済は $transaction の外で実行（Tx 内に外部 I/O を入れない）
  const res = await gateway.charge(account.cardToken, amount);
  if (!res.ok) {
    // 決済拒否・タイムアウト時は残高不変（要件6-6/6-8）
    return { added: 0, declined: true };
  }

  // 【T3】決済成功時のみ、残高加算と取引記録を単一トランザクションで不可分に行う。
  // 旧実装は残高のみ更新し取引を記録していなかった（監査の穴）。ここで必ず記録する。
  const ok = await client.$transaction(async (tx) => {
    const t = tx as unknown as PrismaTx;
    const applied = await applyDeltaAtomic(t, accountId, amount);
    if (!applied.ok) return false;
    const session = await t.session.findUnique({
      where: { id: sessionId },
      select: { transactions: true },
    });
    const records = parseTransactions(session?.transactions);
    records.push({
      transactionId: ulid(),
      kind: "charge",
      amount,
      ts: now.toISOString(),
      balanceAfter: applied.balance,
    });
    await t.session.update({
      where: { id: sessionId },
      data: { transactions: stringifyTransactions(records) },
    });
    return true;
  });

  return { added: ok ? amount : 0, declined: false };
}

/**
 * /api/pay のハンドラ本体。バリデーション → 識別 → 減算 → (不足時)チャージ提示/オートチャージ。
 */
export async function handlePay(
  req: PayRequest,
  deps: PayDeps,
): Promise<PayHandlerResult> {
  const client = deps.client ?? prisma;
  const gateway = deps.gateway ?? defaultGateway;
  const audit = deps.auditPort ?? noopAuditPort;
  const now = deps.now ?? new Date();

  // 金額検証（要件5-1）
  if (
    typeof req.amount !== "number" ||
    !Number.isInteger(req.amount) ||
    req.amount < PAY_MIN ||
    req.amount > PAY_MAX
  ) {
    return {
      status: 400,
      body: { paid: false, reason: "invalid_amount" },
    };
  }
  // purpose 検証（要件11-2）
  if (req.purpose !== "payment") {
    return {
      status: 400,
      body: { paid: false, reason: "invalid_purpose" },
    };
  }

  // 1:N 識別（担当A、ポート経由）
  const idResult = await deps.identifyPort.identify(req.vector, "payment");
  if (idResult.result === "none") {
    // 【T5】認証失敗を監査記録（要件14-3）。要件9の再登録手順を案内（要件5-5）。
    await audit.record({
      eventType: "payment_identify_none",
      detail: { terminal: req.terminal, amount: req.amount },
    });
    return {
      status: 200,
      body: { paid: false, reason: "none_reenroll_required" },
    };
  }
  if (idResult.result === "ambiguous") {
    // 多重一致は係員対応＋要件9の再登録案内（要件5-7/14-3）
    await audit.record({
      eventType: "payment_identify_ambiguous",
      detail: { terminal: req.terminal, amount: req.amount },
    });
    return {
      status: 200,
      body: { paid: false, reason: "ambiguous_reenroll_required" },
    };
  }
  const accountId = idResult.accountId;
  if (!accountId) {
    await audit.record({
      eventType: "payment_identify_none",
      detail: { terminal: req.terminal, amount: req.amount },
    });
    return {
      status: 200,
      body: { paid: false, reason: "none_reenroll_required" },
    };
  }

  // 対象セッションの決定（sessionId 未指定時は当該アカウントの ACTIVE セッションを採用）
  let sessionId = req.sessionId;
  if (!sessionId) {
    const active = await client.session.findFirst({
      where: { accountId, state: "ACTIVE" },
      orderBy: { enteredAt: "desc" },
      select: { id: true },
    });
    if (!active) {
      return {
        status: 200,
        body: { paid: false, accountId, reason: "no_active_session" },
      };
    }
    sessionId = active.id;
  }

  // 冪等キーは時刻に依存しない（T2）。clientRef は型契約外の deps 経由で受け取る。
  const idempotencyKey = computeIdempotencyKey({
    terminal: req.terminal,
    amount: req.amount,
    sessionId,
    clientRef: deps.clientRef,
  });

  // 1回目の減算試行
  let result = await chargeAtomic(
    {
      accountId,
      sessionId,
      amount: req.amount,
      terminal: req.terminal,
      idempotencyKey,
      now: deps.now,
    },
    client,
  );

  if (result.outcome === "insufficient") {
    // 残高不足 → オートチャージを試み、成功して十分になれば再試行（要件6-3）。
    // 【T7】カード決済失敗が CARD_FAILURE_LIMIT 回に達したら以降のチャージ操作を
    // 受け付けず、取引を成立させずに終了する（残高不変、要件6-9）。
    // 失敗回数は deps.cardFailureCount（同一取引の通算、呼び出し側が保持）を起点とする。
    // 単発の拒否は insufficient として扱い、通算が上限に達した場合のみ取引中止（要件6-9）。
    let cardFailures = deps.cardFailureCount ?? 0;
    const attempt = await tryAutoCharge(
      client,
      accountId,
      sessionId,
      req.amount,
      gateway,
      now,
    );
    if (attempt.declined) {
      cardFailures += 1;
      await audit.record({
        eventType: "card_charge_declined",
        accountId,
        detail: { attempt: cardFailures, terminal: req.terminal },
      });
      if (cardFailures >= CARD_FAILURE_LIMIT) {
        // 通算失敗が上限到達 → 取引中止・残高不変（要件6-9）
        await audit.record({
          eventType: "payment_aborted_card_failures",
          accountId,
          detail: { amount: req.amount, failures: cardFailures, terminal: req.terminal },
        });
        return {
          status: 200,
          body: {
            paid: false,
            accountId,
            balance: result.balance,
            reason: "card_failed",
            cardFailureCount: cardFailures,
          } as PayResponse & { cardFailureCount: number },
        };
      }
    } else if (attempt.added > 0) {
      result = await chargeAtomic(
        {
          accountId,
          sessionId,
          amount: req.amount,
          terminal: req.terminal,
          idempotencyKey,
          now: deps.now,
        },
        client,
      );
    }
  }

  if (result.outcome === "insufficient") {
    // 依然不足 → チャージ選択肢を提示（要件6-1）。残高は不変。
    await audit.record({
      eventType: "payment_insufficient",
      accountId,
      detail: { amount: req.amount, balance: result.balance, terminal: req.terminal },
    });
    return {
      status: 200,
      body: {
        paid: false,
        accountId,
        balance: result.balance,
        reason: "insufficient",
        chargeOptions: [...CHARGE_OPTIONS],
      },
    };
  }

  // paid または duplicate（冪等 = 最初の結果を返す、要件5-6）
  return {
    status: 200,
    body: {
      paid: true,
      accountId,
      balance: result.balance,
      transactionId: result.transactionId,
    },
  };
}
