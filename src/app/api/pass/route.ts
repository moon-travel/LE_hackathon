// 担当: B — この route の中身は担当Bが実装する（Account_Service /api/pass）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { PassRequest, PassResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<PassResponse | { error: string }>> {
  // TODO(担当B): 利用権の発行・別室有効性判定（要件7）。
  const _body = (await request.json().catch(() => ({}))) as Partial<PassRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
