// 担当: C — この route の中身は担当Cが実装する（登録フロー /api/enroll）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { EnrollRequest, EnrollResponse } from "@/types/api";

export async function POST(request: Request): Promise<NextResponse<EnrollResponse | { error: string }>> {
  // TODO(担当C): 同意記録→128次元ベクトルを codec で符号化し FaceTemplate 保管（要件1/9）。
  const _body = (await request.json().catch(() => ({}))) as Partial<EnrollRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
