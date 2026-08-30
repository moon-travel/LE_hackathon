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
import { applyDeltaAtomic } from "./balance";
import {
  parseTransactions,
  stringifyTransactions,
  type TransactionRecord,
} from "./serde";
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

/**
 * アカウント単位の取引（チャージ・払い出し・取消）を記録する。
 * 取引履歴の格納先は Session.transactions（JSON文字列）のため、
 * 直近のセッションに追記する。セッションが存在しない場合は記録をスキップする。
 *
 * 【Phase2 への申し送り】本来は Account に紐づく独立した Transaction テーブルへ
 * 記録すべきだが、prisma/schema.prisma が凍結中のため暫定でセッションに寄せている。
 * Phase2 で Phase0 担当へテーブル追加を依頼すること。
 */
async function appendAccountTransaction(
  tx: PrismaTx,
  accountId: string,
  record: TransactionRecord,
): Promise<void> {
  const session = await tx.session.findFirst({
    where: { accountId },
    orderBy: { enteredAt: "desc" },
    select: { id: true, transactions: true },
  });
  if (!session) return;
  const records = parseTransactions(session.transactions);
  records.push(record);
  await tx.session.update({
    where: { id: session.id },
    data: { transactions: stringifyTransactions(records) },
  });
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

      // 【T4・要件2-2/2-3】前払いチャージは決済事業者の承認を経てから加算する。
      // 旧実装は gateway を通さず残高を直接加算しており「決済を完了する」要件を満たしていなかった。
      // カード登録済みならそのトークンで決済する。未登録の場合は現地現金チャージ相当として
      // 決済を経ずに加算する（券売機での現金投入を模す。デモ既定）。
      if (account.cardToken) {
        const res = await gateway.charge(account.cardToken, amount);
        if (!res.ok) {
          // 拒否・タイムアウト時は残高不変（要件2-3）
          return err(402, "charge declined", res.reason ?? "declined");
        }
      }

      const applied = await client.$transaction(async (tx) =>
        applyDeltaAtomic(tx as unknown as PrismaTx, req.accountId!, amount),
      );
      if (!applied.ok) {
        return err(400, "balance out of range", applied.reason ?? "range");
      }
      return ok(req.accountId, applied.balance, Boolean(account.cardToken));
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

      // 【T3・サーガ化】外部返金は $transaction 内に入れられないため、
      // 「減算＋取引記録(withdraw)を1トランザクションで確定」→「返金」→
      // 「失敗時は復元＋取消記録(withdrawReverted)を1トランザクションで確定」とする。
      // 各段が記録を残すため、途中でクラッシュしても状態を追跡・復旧できる（要件12-8）。
      const withdrawTxId = ulid();
      const applied = await client.$transaction(async (tx) => {
        const t = tx as unknown as PrismaTx;
        const r = await applyDeltaAtomic(t, req.accountId!, -amount);
        if (!r.ok) return r;
        await appendAccountTransaction(t, req.accountId!, {
          transactionId: withdrawTxId,
          kind: "withdraw",
          amount,
          ts: now.toISOString(),
          balanceAfter: r.balance,
        });
        return r;
      });
      if (!applied.ok) {
        return err(400, "invalid withdraw amount", applied.reason ?? "range");
      }

      if (method === "card") {
        const refund = await gateway.refund(account.cardToken!, amount);
        if (!refund.ok) {
          // 返金失敗 → 減算を戻し、取消を記録（補償）。要件12-8。
          const restored = await client.$transaction(async (tx) => {
            const t = tx as unknown as PrismaTx;
            const r = await applyDeltaAtomic(t, req.accountId!, amount);
            if (r.ok) {
              await appendAccountTransaction(t, req.accountId!, {
                transactionId: ulid(),
                kind: "withdrawReverted",
                amount,
                ts: new Date().toISOString(),
                balanceAfter: r.balance,
              });
            }
            return r;
          });
          void restored;
          return err(402, "refund failed", refund.reason ?? "refund_failed");
        }
      }

      return ok(req.accountId, applied.balance, Boolean(account.cardToken), "withdrawn");
    }

    default:
      return err(400, "unknown action");
  }
}
