// 担当: B — この route の中身は担当Bが実装する（Account_Service /api/pay）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { PayRequest, PayResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<PayResponse | { error: string }>> {
  // TODO(担当B): identify結果を型契約経由で受け charge.ts で減算・取引記録（要件5/6）。
  const _body = (await request.json().catch(() => ({}))) as Partial<PayRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
