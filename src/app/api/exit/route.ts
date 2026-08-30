// 担当: A — Session_Service /api/exit（退場）。
// 型契約は src/types/api.ts（凍結）。
// _Requirements: 8.1, 8.2, 8.4_
//
// 要件8-3（退場ゲートでの残高表示）はスコープ外。凍結済みの ExitResponse に balance がなく、
// AccountAction にも残高読み取り操作がないため、凍結解除なしでは実現経路がない。
//
// 退場は Session の CLOSED 化と expireAt 設定のみ。**テンプレートの削除はしない**。
// デモの「顔が消える」は退場画面からの明示的な削除操作（/api/consent の撤回）で行う。

import { NextResponse } from "next/server";
import type { ApiError, ExitRequest, ExitResponse } from "@/types/api";
import { prisma } from "@/lib/db";
import { IdentifyTimeoutError, identify } from "@/lib/auth/identify";
import { statusOf, toApiError } from "@/lib/auth/apiError";
import { AuditEvent, appendAudit } from "@/lib/auth/audit";
import { appendPassage, parsePassHistory, toSecondPrecision } from "@/lib/auth/session";
import { setRetentionDeadline } from "@/lib/retention/deleteTemplate";
import { DEFAULT_RETENTION_DAYS } from "@/lib/retention/computeExpireAt";

export async function POST(request: Request): Promise<NextResponse<ExitResponse | ApiError>> {
  const body = (await request.json().catch(() => ({}))) as Partial<ExitRequest>;
  const now = new Date();

  let decision;
  try {
    decision = await identify(body.vector, body.purpose ?? "entry", now);
  } catch (error) {
    if (error instanceof IdentifyTimeoutError) {
      return NextResponse.json({ released: false, reason: "timeout" });
    }
    return NextResponse.json(toApiError(error), { status: statusOf(error) });
  }

  // 要件8-5: 識別できない場合はゲートを閉鎖したまま維持し、未識別の退場試行を監査記録する。
  if (decision.result !== "matched" || decision.accountId === undefined) {
    await appendAudit({
      eventType: AuditEvent.EXIT_UNIDENTIFIED,
      ts: now,
      detail: { result: decision.result, populationSize: decision.populationSize },
    });
    return NextResponse.json({ released: false, reason: decision.result });
  }
  const accountId = decision.accountId;

  const active = await prisma.session.findFirst({
    where: { accountId, state: "ACTIVE" },
    orderBy: { enteredAt: "desc" },
  });

  // 要件8-4: ACTIVE セッションがない場合もゲートは開ける。状態は一切変更せず、
  // セッション不整合として監査記録する（閉じ込め防止を優先する要件の裁定）。
  if (active === null) {
    const latest = await prisma.session.findFirst({
      where: { accountId },
      orderBy: { enteredAt: "desc" },
      select: { id: true, state: true },
    });
    await appendAudit({
      eventType: AuditEvent.SESSION_INCONSISTENCY,
      accountId,
      ts: now,
      detail: {
        identifiedAt: toSecondPrecision(now).toISOString(),
        latestSessionId: latest?.id ?? null,
        latestSessionState: latest?.state ?? null,
      },
    });
    return NextResponse.json({ released: true, accountId });
  }

  // 要件8-1: 状態を CLOSED に更新し、識別時刻を秒精度の退場時刻として記録する。
  const exitedAt = toSecondPrecision(now);
  const history = appendPassage(parsePassHistory(active.passHistory), "EXIT", now);
  await prisma.session.update({
    where: { id: active.id },
    data: { state: "CLOSED", exitedAt, passHistory: JSON.stringify(history) },
  });

  // 要件8-2: 保管期間設定を退場時刻に加算した日時を保管期限として算定し保持する。削除はしない。
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { retentionDays: true },
  });
  await setRetentionDeadline(
    accountId,
    exitedAt,
    account?.retentionDays ?? DEFAULT_RETENTION_DAYS,
  );

  return NextResponse.json({
    released: true,
    sessionId: active.id,
    accountId,
    sessionState: "CLOSED",
    exitedAt: exitedAt.toISOString(),
  });
}
