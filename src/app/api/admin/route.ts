// 担当C — Admin_Console. GET/POST /api/admin
// Requirements 11.10, 14.1-14.9.
import { NextResponse } from "next/server";
import type { AdminRequest, AdminResponse } from "@/types/api";
import { prisma } from "@/lib/db";
import { buildAdminSnapshot } from "@/lib/audit/adminSnapshot";
import { appendAudit } from "@/lib/audit/log";
import { applyForceClose } from "@/lib/auth/sessionTransition";
import { runRetentionScan } from "@/lib/retention/scanner";

export async function GET(): Promise<NextResponse<AdminResponse | { error: string }>> {
  const snapshot = await buildAdminSnapshot();
  return NextResponse.json({ ok: true, snapshot });
}

export async function POST(
  req: Request,
): Promise<NextResponse<AdminResponse | { error: string }>> {
  let body: Partial<AdminRequest>;
  try {
    body = (await req.json()) as Partial<AdminRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  switch (body.action) {
    case "snapshot": {
      const snapshot = await buildAdminSnapshot();
      return NextResponse.json({ ok: true, snapshot });
    }

    case "forceClose": {
      if (!body.sessionId) return NextResponse.json({ ok: false, error: "sessionId required" });
      const session = await prisma.session.findUnique({ where: { id: body.sessionId } });
      if (!session) return NextResponse.json({ ok: false, error: "session not found" });
      if (session.state !== "ACTIVE") {
        return NextResponse.json({ ok: false, error: "session not ACTIVE" });
      }

      const now = new Date();
      // Record the manual operation to audit FIRST; if that fails we don't apply
      // the state change (要件14.9). appendAudit throwing propagates as 500.
      const operatorId = body.operatorId ?? "staff";
      const next = applyForceClose(
        { id: session.id, accountId: session.accountId, state: "ACTIVE", enteredAt: session.enteredAt },
        now,
      );
      await prisma.session.update({
        where: { id: session.id },
        data: { state: next.state, exitedAt: next.exitedAt },
      });
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
      return NextResponse.json({ ok: true, newState: "FORCE_CLOSED" });
    }

    case "runRetentionScan": {
      const deleted = await runRetentionScan();
      return NextResponse.json({ ok: true, deletedTemplates: deleted });
    }

    default:
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
}
