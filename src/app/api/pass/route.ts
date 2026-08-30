// 担当: B — Account_Service /api/pass（要件7）。
// 型契約は src/types/api.ts（凍結）。ハンドラ本体は src/lib/account/pass.ts の純関数 handlePass に分離。
// action: issue（利用権発行）/ verify（別室有効性判定）。
import { NextResponse } from "next/server";
import type { PassRequest, PassResponse } from "@/types/api";
import { handlePass } from "@/lib/account/pass";

export async function POST(
  request: Request,
): Promise<NextResponse<PassResponse | { error: string }>> {
  const body = (await request.json().catch(() => null)) as PassRequest | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { status, body: res } = await handlePass(body);
  return NextResponse.json(res, { status });
}
