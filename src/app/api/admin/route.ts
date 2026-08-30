// 担当: C — この route の中身は担当Cが実装する（Admin_Console /api/admin）。
// 型契約は src/types/api.ts（凍結）。フェーズ0スタブ: 501 を返す。
import { NextResponse } from "next/server";
import type { AdminGetResponse, AdminActionRequest, AdminActionResponse } from "@/types/api";

export async function GET(): Promise<NextResponse<AdminGetResponse | { error: string }>> {
  // TODO(担当C): ACTIVE一覧・件数、監査ログ降順、上限警告（要件14）。
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}

export async function POST(request: Request): Promise<NextResponse<AdminActionResponse | { error: string }>> {
  // TODO(担当C): 強制クローズ・削除走査の手動発火（要件14/10）。
  const _body = (await request.json().catch(() => ({}))) as Partial<AdminActionRequest>;
  void _body;
  return NextResponse.json({ error: "Not Implemented" }, { status: 501 });
}
