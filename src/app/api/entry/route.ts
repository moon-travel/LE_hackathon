// 担当: A — この route の中身は担当Aが実装する（Session_Service /api/entry）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { EntryRequest, EntryResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<EntryResponse | { error: string }>> {
  // TODO(担当A): identify成功+当日有効入浴券でSession ACTIVE生成（要件3/4）。
  const _body = (await request.json().catch(() => ({}))) as Partial<EntryRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
