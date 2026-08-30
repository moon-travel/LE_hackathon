// 担当B所有: /api/account のハンドラ本体（純関数化しポート/クライアント注入可能に）。
// action:
//   create      新規アカウント生成（残高0初期化、要件2-1）
//   charge      チャージ 1000〜30000・上限50000（要件2-2/2-4）
//   registerCard カード登録認証→トークン保存（番号等は保存しない、要件2-5/2-7）
//   withdraw    払い出し（減算→カード返金→失敗時に減算を戻す補償、要件12-2/12-5/12-6/12-8）
// テンプレート削除後もアカウントは保持（要件2-9/10-9）— アカウントレコードは本サービスで削除しない。
import type { AccountRequest, AccountResponse, ApiError } from "@/types/api";
import { prisma } from "./prisma";
import type { PrismaTx } from "./prisma";
import { applyDelta, BalanceRangeError } from "./balance";
import { BALANCE_MAX, CHARGE_MAX, CHARGE_MIN } from "./constants";
import { defaultGateway, type PaymentGateway } from "@/lib/payment-mock/gateway";
import { ulid } from "ulid";

export interface AccountDeps {
  gateway?: PaymentGateway;
  client?: typeof prisma;
  now?: Date;
}

export interface AccountHandlerResult {
  status: number;
  body: AccountResponse | ApiError;
}

function ok(
  accountId: string,
  balance: number,
  hasCard: boolean,
  message?: string,
): AccountHandlerResult {
  return { status: 200, body: { accountId, balance, hasCard, message } };
}

function err(status: number, error: string, reason?: string): AccountHandlerResult {
  return { status, body: { error, reason } };
}

export async function handleAccount(
  req: AccountRequest,
  deps: AccountDeps = {},
): Promise<AccountHandlerResult> {
  const client = deps.client ?? prisma;
  const gateway = deps.gateway ?? defaultGateway;
  const now = deps.now ?? new Date();

  switch (req.action) {
    case "create": {
      const account = await client.account.create({ data: { balance: 0 } });
      return ok(account.id, 0, false); // 残高0初期化（要件2-1）
    }

    case "charge": {
      if (!req.accountId) return err(400, "accountId required");
      const amount = req.amount;
      // チャージ金額範囲 1000〜30000（要件2-4）
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < CHARGE_MIN ||
        amount > CHARGE_MAX
      ) {
        return err(400, "invalid charge amount", "range");
      }
      const account = await client.account.findUnique({ where: { id: req.accountId } });
      if (!account) return err(404, "account not found");
      // 加算後の残高上限 50000 超過を事前検証（要件2-4/6-7）
      if (account.balance + amount > BALANCE_MAX) {
        return err(400, "balance limit exceeded", "over_max");
      }
      try {
        const newBalance = await client.$transaction(async (tx) =>
          applyDelta(tx as unknown as PrismaTx, req.accountId!, amount),
        );
        return ok(req.accountId, newBalance, Boolean(account.cardToken));
      } catch (e) {
        if (e instanceof BalanceRangeError) {
          return err(400, "balance out of range", "range");
        }
        throw e;
      }
    }

    case "registerCard": {
      if (!req.accountId) return err(400, "accountId required");
      if (!req.cardToken) return err(400, "cardToken required");
      const account = await client.account.findUnique({ where: { id: req.accountId } });
      if (!account) return err(404, "account not found");
      // 決済事業者の認証（要件2-5/2-6）。カード番号等は保存しない（req.cardToken は事業者参照のみ）。
      const auth = await gateway.cardAuth(req.cardToken);
      if (!auth.ok || !auth.token) {
        // 認証失敗: 既存トークンを変更しない（要件2-6）
        return err(402, "card auth failed", auth.reason ?? "declined");
      }
      const updated = await client.account.update({
        where: { id: req.accountId },
        data: { cardToken: auth.token }, // 事業者発行トークンのみ保存（要件2-7）
      });
      return ok(updated.id, updated.balance, true, "card registered");
    }

    case "withdraw": {
      if (!req.accountId) return err(400, "accountId required");
      const amount = req.amount;
      const account = await client.account.findUnique({ where: { id: req.accountId } });
      if (!account) return err(404, "account not found");
      // 残高0は入力を受け付けない（要件12-9）
      if (account.balance === 0) {
        return err(400, "balance is zero", "zero_balance");
      }
      // 1円以上・現在残高以下・1円単位（要件12-2/12-5）
      if (
        typeof amount !== "number" ||
        !Number.isInteger(amount) ||
        amount < 1 ||
        amount > account.balance
      ) {
        return err(400, "invalid withdraw amount", "range");
      }
      const method = req.withdrawMethod ?? "cash";
      if (method === "card" && !account.cardToken) {
        return err(400, "no card registered", "no_card");
      }

      // まず減算（補償トランザクションのため取引記録も付す）。
      // カード返金失敗時は減算を戻す（要件12-8）。
      const withdrawTxId = ulid();
      const newBalance = await client.$transaction(async (tx) => {
        const t = tx as unknown as PrismaTx;
        const bal = await applyDelta(t, req.accountId!, -amount);
        return bal;
      });

      if (method === "card") {
        const refund = await gateway.refund(account.cardToken!, amount);
        if (!refund.ok) {
          // 返金失敗 → 減算した金額を残高へ復元（補償）。取引記録に未完了として残す（要件12-8）。
          const restored = await client.$transaction(async (tx) =>
            applyDelta(tx as unknown as PrismaTx, req.accountId!, amount),
          );
          void restored;
          void withdrawTxId;
          return err(402, "refund failed", refund.reason ?? "refund_failed");
        }
      }

      return ok(req.accountId, newBalance, Boolean(account.cardToken), "withdrawn");
    }

    default:
      return err(400, "unknown action");
  }
}
