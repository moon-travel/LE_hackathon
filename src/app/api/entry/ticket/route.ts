// 担当: A — 入浴券の発行（券売機での購入相当）。
// _Requirements: 3.8, 4.4, 4.7_
//
// 凍結済みの src/types/api.ts にはこのルートの型がないため、リクエスト/レスポンス型は
// src/lib/auth/bathTicket.ts 側にローカル定義している（凍結ファイルは変更しない方針）。
// 型契約を api.ts へ移す場合はフェーズ0担当へ依頼する。

import { NextResponse } from "next/server";
import type { ApiError } from "@/types/api";
import { prisma } from "@/lib/db";
import { issueBathTicket } from "@/lib/auth/bathTicket";
import type { IssueBathTicketResult } from "@/lib/auth/bathTicket";

interface TicketRequest {
  accountId: string;
}

export async function POST(
  request: Request,
): Promise<NextResponse<IssueBathTicketResult | ApiError>> {
  const body = (await request.json().catch(() => ({}))) as Partial<TicketRequest>;

  if (typeof body.accountId !== "string" || body.accountId.length === 0) {
    return NextResponse.json({ error: "accountId is required" }, { status: 400 });
  }

  // 存在しないアカウントに券を発行しない（要件7-9 と同趣旨）。
  const account = await prisma.account.findUnique({
    where: { id: body.accountId },
    select: { id: true },
  });
  if (account === null) {
    return NextResponse.json(
      { error: "account not found", reason: "account_not_found" },
      { status: 404 },
    );
  }

  const result = await issueBathTicket(body.accountId);
  return NextResponse.json(result);
}
