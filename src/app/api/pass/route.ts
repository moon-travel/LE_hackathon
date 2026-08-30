// 担当B — Account_Service (利用権). POST /api/pass
// Requirements 7.1, 7.2, 7.3, 7.5, 7.6, 7.7.
import { NextResponse } from "next/server";
import type { PassRequest, PassResponse } from "@/types/api";
import { isValidFaceVector } from "@/types/vector";
import { issuePass, verifyPass } from "@/lib/account/pass";
import { identify } from "@/lib/auth/identify";
import { buildPopulation } from "@/lib/auth/population";
import { appendAudit } from "@/lib/audit/log";

export async function POST(
  req: Request,
): Promise<NextResponse<PassResponse | { error: string }>> {
  let body: Partial<PassRequest>;
  try {
    body = (await req.json()) as Partial<PassRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action === "issue") {
    if (!body.accountId) {
      // Cannot identify the account (要件7.9).
      return NextResponse.json({ ok: false, error: "account not identified" });
    }
    const res = await issuePass(body.accountId);
    if (!res.ok) return NextResponse.json({ ok: false, error: "issue failed" });
    return NextResponse.json({
      ok: true,
      passId: res.passId,
      expiresAt: res.expiresAt?.toISOString(),
      alreadyExists: res.alreadyExists,
    });
  }

  if (body.action === "verify") {
    // Private-room verification via 1:N identify (purpose "pass").
    if (!isValidFaceVector(body.vector)) {
      return NextResponse.json({ ok: false, error: "invalid vector" });
    }
    const population = await buildPopulation("active");
    const outcome = identify(body.vector, "pass", population);
    await appendAudit(
      "identify",
      { purpose: "pass", result: outcome.result },
      outcome.accountId,
    );
    if (outcome.result !== "matched" || !outcome.accountId) {
      return NextResponse.json({ ok: true, valid: false });
    }
    const valid = await verifyPass(outcome.accountId);
    return NextResponse.json({ ok: true, valid });
  }

  return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
}
