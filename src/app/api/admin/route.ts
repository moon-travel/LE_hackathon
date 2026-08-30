// 担当C — Admin_Console. GET/POST /api/admin
// _Requirements: 10.11, 11.10, 14.1, 14.2, 14.3, 14.5, 14.6, 14.7, 14.9_
//
// 応答は凍結契約 src/types/api.ts の AdminGetResponse / AdminActionResponse / ApiError に従う。
import { NextResponse } from "next/server";
import type {
  AdminGetResponse,
  AdminActionRequest,
  AdminActionResponse,
  ApiError,
} from "@/types/api";
import { prisma } from "@/lib/db";
import { buildAdminSnapshot } from "@/lib/audit/adminSnapshot";
import { appendAudit } from "@/lib/audit/log";
import { applyForceClose } from "@/lib/auth/sessionTransition";
import { runRetentionScan } from "@/lib/retention/scanner";

export async function GET(): Promise<NextResponse<AdminGetResponse | ApiError>> {
  const snapshot = await buildAdminSnapshot();
  return NextResponse.json(snapshot);
}

export async function POST(
  req: Request,
): Promise<NextResponse<AdminActionResponse | ApiError>> {
  let body: Partial<AdminActionRequest>;
  try {
    body = (await req.json()) as Partial<AdminActionRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json", reason: "bad_request" }, { status: 400 });
  }

  // 操作者識別子は監査記録に必須（要件14-5）。
  const operatorId = body.operatorId;
  if (!operatorId) {
    return NextResponse.json(
      { error: "operatorId required", reason: "bad_request" },
      { status: 400 },
    );
  }

  switch (body.action) {
    case "forceClose": {
      if (!body.sessionId) {
        return NextResponse.json(
          { error: "sessionId required", reason: "bad_request" },
          { status: 400 },
        );
      }
      const session = await prisma.session.findUnique({ where: { id: body.sessionId } });
      if (!session) {
        return NextResponse.json(
          { error: "session not found", reason: "no_session" },
          { status: 404 },
        );
      }
      if (session.state !== "ACTIVE") {
        return NextResponse.json(
          { error: "session not ACTIVE", reason: "not_active" },
          { status: 409 },
        );
      }

      const now = new Date();
      const next = applyForceClose(
        {
          id: session.id,
          accountId: session.accountId,
          state: "ACTIVE",
          enteredAt: session.enteredAt,
        },
        now,
      );
      await prisma.session.update({
        where: { id: session.id },
        data: { state: next.state, exitedAt: next.exitedAt },
      });
      // 手動操作は操作者識別子とともに記録する（要件14-5）。追記に失敗すれば 500 として伝播する。
      await appendAudit(
        "manual_operation",
        { operation: "forceClose", operatorId, sessionId: session.id },
        session.accountId,
      );
      await appendAudit(
        "session_force_close",
        { operatorId, reason: "manual", exitedAt: now.toISOString() },
        session.accountId,
      );
      return NextResponse.json({ ok: true, sessionState: next.state });
    }

    case "runRetentionScan": {
      const result = await runRetentionScan();
      await appendAudit("manual_operation", {
        operation: "runRetentionScan",
        operatorId,
        deletedCount: result.deletedCount,
      });
      return NextResponse.json({ ok: true, deletedCount: result.deletedCount });
    }

    default:
      return NextResponse.json(
        { error: "unknown action", reason: "bad_request" },
        { status: 400 },
      );
  }
}
