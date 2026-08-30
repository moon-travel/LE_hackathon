// 担当B所有: /api/pay のハンドラ本体（純関数化しポート注入可能に。判断1）。
// identify結果を IdentifyPort で受け、matched(1件)かつ残高十分なら chargeAtomic。
// none/ambiguous（5-5/5-7）、残高不足（5-8→6）、チャージ提示・オートチャージ（6-1〜6-4/6-9）、
// 決済拒否時は残高不変（6-6）。金額検証・冪等キー算出も担う。
import type { PayRequest, PayResponse } from "@/types/api";
import { prisma } from "./prisma";
import { chargeAtomic } from "./charge";
import { applyDelta } from "./balance";
import { computeIdempotencyKey } from "./idempotency";
import { CHARGE_OPTIONS, PAY_MAX, PAY_MIN } from "./constants";
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
  shortfallAtLeast: number,
  gateway: PaymentGateway,
): Promise<number> {
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
    return 0;
  }
  const amount = account.autoChargeAmount;
  // 加算後上限超過なら実行しない（要件6-7 に整合、balance.applyDelta が範囲検証）
  if (account.balance + amount > 50000) return 0;
  if (account.balance + amount < shortfallAtLeast) {
    // オートチャージしても足りないなら実行しない
    return 0;
  }
  const res = await gateway.charge(account.cardToken, amount);
  if (!res.ok) return 0;
  // 決済成功時のみ残高加算 + 取引追記（原子）
  await client.$transaction(async (tx) => {
    const t = tx as unknown as PrismaTx;
    const newBalance = await applyDelta(t, accountId, amount);
    // charge 取引は ACTIVE セッションに紐づけず account 単位の記録は最小化。
    // ここでは残高のみ更新（取引記録はセッション pay 側で残る）。
    void newBalance;
  });
  return amount;
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
    return { status: 200, body: { paid: false, reason: "none" } };
  }
  if (idResult.result === "ambiguous") {
    return { status: 200, body: { paid: false, reason: "ambiguous" } };
  }
  const accountId = idResult.accountId;
  if (!accountId) {
    return { status: 200, body: { paid: false, reason: "none" } };
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

  const idempotencyKey = computeIdempotencyKey({
    terminal: req.terminal,
    amount: req.amount,
    sessionId,
    now: deps.now ? deps.now.getTime() : undefined,
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
    // 残高不足 → オートチャージを試み、成功して十分になれば再試行（要件6-3）
    const added = await tryAutoCharge(client, accountId, req.amount, gateway);
    if (added > 0) {
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
