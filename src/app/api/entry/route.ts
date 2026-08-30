// 担当: A — Session_Service /api/entry（入場・再入場）。
// 型契約は src/types/api.ts（凍結）。
// _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 4.1, 4.2, 4.3, 4.4, 4.6, 4.7_

import { NextResponse } from "next/server";
import type { ApiError, EntryRequest, EntryResponse } from "@/types/api";
import { prisma } from "@/lib/db";
import { IdentifyTimeoutError, identify } from "@/lib/auth/identify";
import { statusOf, toApiError } from "@/lib/auth/apiError";
import { hasValidBathTicket } from "@/lib/auth/bathTicket";
import { appendPassage, newSession, parsePassHistory, toSecondPrecision } from "@/lib/auth/session";

export async function POST(request: Request): Promise<NextResponse<EntryResponse | ApiError>> {
  const body = (await request.json().catch(() => ({}))) as Partial<EntryRequest>;
  const now = new Date();

  let decision;
  try {
    decision = await identify(body.vector, body.purpose ?? "entry", now);
  } catch (error) {
    if (error instanceof IdentifyTimeoutError) {
      // 要件3-11: 識別要求を無効として扱い、ゲートを開けずセッションを生成しない。
      // ゲート端末は理由を表示する必要があるので、エラーではなく in-band で返す。
      return NextResponse.json({ admitted: false, reason: "timeout" });
    }
    return NextResponse.json(toApiError(error), { status: statusOf(error) });
  }

  // 要件3-6 / 3-7: 0件は認証失敗、2件以上は係員対応。いずれもセッションを生成しない。
  // 要件4-6: 識別不成立でも再試行回数は制限しない。
  if (decision.result !== "matched" || decision.accountId === undefined) {
    return NextResponse.json({ admitted: false, reason: decision.result });
  }
  const accountId = decision.accountId;

  // 要件3-8 / 4-7: 当日有効な入浴券がなければ入場させず、セッションも生成しない。
  if (!(await hasValidBathTicket(accountId, now))) {
    return NextResponse.json({ admitted: false, accountId, reason: "no_pass" });
  }

  // 要件3-9 / 4-1 / 4-2: 既存 ACTIVE セッションがあれば新規生成せず維持したまま開放する。
  const active = await prisma.session.findFirst({
    where: { accountId, state: "ACTIVE" },
    orderBy: { enteredAt: "desc" },
  });

  if (active !== null) {
    // 要件4-3: 通過履歴を時刻昇順で追記。件数に上限を設けない。
    const history = appendPassage(parsePassHistory(active.passHistory), "ENTRY", now);
    await prisma.session.update({
      where: { id: active.id },
      data: { passHistory: JSON.stringify(history) },
    });
    return NextResponse.json({
      admitted: true,
      sessionId: active.id,
      accountId,
      sessionState: "ACTIVE",
    });
  }

  // 要件3-4 / 4-4: 初回、または CLOSED / FORCE_CLOSED 後の再入場は新規セッションを ACTIVE で生成。
  const seed = newSession(now);
  const created = await prisma.session.create({
    data: {
      accountId,
      state: "ACTIVE",
      enteredAt: toSecondPrecision(now),
      passHistory: JSON.stringify(seed.passHistory),
      transactions: "[]",
    },
  });

  return NextResponse.json({
    admitted: true,
    sessionId: created.id,
    accountId,
    sessionState: "ACTIVE",
  });
}
