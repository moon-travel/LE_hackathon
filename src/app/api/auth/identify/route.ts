// 担当: A — この route の中身は担当Aが実装する（Auth_Service /api/auth/identify）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { IdentifyRequest, IdentifyResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<IdentifyResponse | { error: string }>> {
  // TODO(担当A): identify.ts を呼び {result, accountId?, score?} を返す（要件3/5/11）。
  const _body = (await request.json().catch(() => ({}))) as Partial<IdentifyRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
