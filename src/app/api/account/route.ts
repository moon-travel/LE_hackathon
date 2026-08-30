// 担当: B — Account_Service /api/account（要件2/12）。
// 型契約は src/types/api.ts（凍結）。ハンドラ本体は src/lib/account/account.ts の純関数 handleAccount に分離。
// action: create / charge / registerCard / withdraw。決済はモックゲートウェイをポート注入（判断1）。
import { NextResponse } from "next/server";
import type { AccountRequest, AccountResponse } from "@/types/api";
import { handleAccount } from "@/lib/account/account";
import { defaultGateway } from "@/lib/payment-mock/gateway";

export async function POST(
  request: Request,
): Promise<NextResponse<AccountResponse | { error: string }>> {
  const body = (await request.json().catch(() => null)) as AccountRequest | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { status, body: res } = await handleAccount(body, {
    gateway: defaultGateway,
  });

  return NextResponse.json(res, { status });
}
