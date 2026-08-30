// 担当: A — Auth_Service /api/auth/identify。
// 型契約は src/types/api.ts（凍結）。
// _Requirements: 3.1, 3.3, 3.11, 5.1, 11.2, 11.3, 11.6, 11.10_

import { NextResponse } from "next/server";
import type { ApiError, IdentifyRequest, IdentifyResponse } from "@/types/api";
import { identify } from "@/lib/auth/identify";
import { statusOf, toApiError } from "@/lib/auth/apiError";

export async function POST(
  request: Request,
): Promise<NextResponse<IdentifyResponse | ApiError>> {
  const body = (await request.json().catch(() => ({}))) as Partial<IdentifyRequest>;

  try {
    const decision = await identify(body.vector, body.purpose);

    // 要件11-6: 応答にベクトル値を一切含めない。返すのは判定結果とスコアのみ。
    const response: IdentifyResponse = { result: decision.result };
    if (decision.accountId !== undefined) response.accountId = decision.accountId;
    if (decision.score !== undefined) response.score = decision.score;
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(toApiError(error), { status: statusOf(error) });
  }
}
