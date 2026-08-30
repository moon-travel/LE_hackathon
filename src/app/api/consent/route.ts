// 担当: C — この route の中身は担当Cが実装する（Consent_Service /api/consent）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { ConsentRequest, ConsentResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<ConsentResponse | { error: string }>> {
  // TODO(担当C): 同意記録・撤回（撤回時は同期削除、要件1/11）。
  const _body = (await request.json().catch(() => ({}))) as Partial<ConsentRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
