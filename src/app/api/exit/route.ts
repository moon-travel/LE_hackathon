// 担当: A — この route の中身は担当Aが実装する（Session_Service /api/exit）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { ExitRequest, ExitResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<ExitResponse | { error: string }>> {
  // TODO(担当A): ACTIVE を CLOSED に更新し退場時刻記録+expireAt設定（要件8）。
  const _body = (await request.json().catch(() => ({}))) as Partial<ExitRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
