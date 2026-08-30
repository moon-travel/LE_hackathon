// 担当: B — この route の中身は担当Bが実装する（Account_Service /api/account）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { AccountRequest, AccountResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<AccountResponse | { error: string }>> {
  // TODO(担当B): 生成・チャージ・カードトークン保存・払い出し（要件2/12）。
  const _body = (await request.json().catch(() => ({}))) as Partial<AccountRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
