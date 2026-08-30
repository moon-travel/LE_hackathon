// 担当B所有: /api/pass のハンドラ本体（純関数化しクライアント注入可能に）。
// action:
//   issue   利用権発行。有効期間=購入日の営業日終了（要件7-1）、アカウント紐づけ（要件7-6）。
//           既存の有効利用権があれば新規発行しない（要件7-7）。
//   verify  別室有効性判定。有効期間内なら valid、回数無制限（要件7-2/7-3）。
//           期限経過は失効として記録し無効を返す（要件7-5）。
import type { PassRequest, PassResponse, ApiError } from "@/types/api";
import { prisma } from "./prisma";
import { businessDayEnd } from "./businessDay";

export interface PassDeps {
  client?: typeof prisma;
  now?: Date;
}

export interface PassHandlerResult {
  status: number;
  body: PassResponse | ApiError;
}

/**
 * 期限を過ぎた VALID 利用権を EXPIRED に更新する（要件7-5）。
 * 走査対象は当該アカウントの利用権のみ。
 */
async function expireOverdue(
  client: typeof prisma,
  accountId: string,
  now: Date,
): Promise<void> {
  await client.pass.updateMany({
    where: { accountId, status: "VALID", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
}

/**
 * 当該アカウントの現在有効な利用権（VALID かつ expiresAt > now）を返す。なければ null。
 */
async function findValidPass(
  client: typeof prisma,
  accountId: string,
  now: Date,
) {
  return client.pass.findFirst({
    where: { accountId, status: "VALID", expiresAt: { gt: now } },
    orderBy: { expiresAt: "desc" },
  });
}

export async function handlePass(
  req: PassRequest,
  deps: PassDeps = {},
): Promise<PassHandlerResult> {
  const client = deps.client ?? prisma;
  const now = deps.now ?? new Date();

  if (!req.accountId) {
    return { status: 400, body: { error: "accountId required" } };
  }
  const account = await client.account.findUnique({ where: { id: req.accountId } });
  if (!account) {
    // アカウント特定失敗（要件7-9）
    return { status: 404, body: { error: "account not found", reason: "no_account" } };
  }

  // 判定前に期限切れを反映（要件7-5）
  await expireOverdue(client, req.accountId, now);

  switch (req.action) {
    case "issue": {
      const existing = await findValidPass(client, req.accountId, now);
      if (existing) {
        // 既存有効利用権あり → 新規発行しない・期間変更しない（要件7-7）
        return {
          status: 200,
          body: {
            valid: true,
            passId: existing.id,
            expiresAt: existing.expiresAt.toISOString(),
            alreadyExists: true,
          },
        };
      }
      const expiresAt = businessDayEnd(now);
      const created = await client.pass.create({
        data: { accountId: req.accountId, expiresAt, status: "VALID" },
      });
      return {
        status: 200,
        body: {
          valid: true,
          passId: created.id,
          expiresAt: created.expiresAt.toISOString(),
          alreadyExists: false,
        },
      };
    }

    case "verify": {
      const valid = await findValidPass(client, req.accountId, now);
      if (!valid) {
        return { status: 200, body: { valid: false } };
      }
      // 有効期間内 → 回数無制限で許可（要件7-3）
      return {
        status: 200,
        body: {
          valid: true,
          passId: valid.id,
          expiresAt: valid.expiresAt.toISOString(),
        },
      };
    }

    default:
      return { status: 400, body: { error: "unknown action" } };
  }
}
