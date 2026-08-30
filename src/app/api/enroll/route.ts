// 担当C — Enrollment. POST /api/enroll
// Requirements 1.6, 1.7, 1.11, 9.1, 9.2, 9.3, 9.4, 9.7, 11.4.
// The browser sends ONLY the 128-dim vector; the raw image never reaches here.
import { NextResponse } from "next/server";
import type { EnrollRequest, EnrollResponse } from "@/types/api";
import { isValidFaceVector } from "@/types/vector";
import { prisma } from "@/lib/db";
import { buildConsentRecord } from "@/lib/consent/record";
import { storeTemplate } from "@/lib/consent/enrollTemplate";

export async function POST(
  req: Request,
): Promise<NextResponse<EnrollResponse | { error: string }>> {
  let body: Partial<EnrollRequest>;
  try {
    body = (await req.json()) as Partial<EnrollRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!isValidFaceVector(body.vector)) {
    return NextResponse.json({ ok: false, error: "invalid vector" });
  }
  // Enrollment consent is mandatory to store a template (要件1.3).
  if (body.consentEnrollment !== true) {
    return NextResponse.json({ ok: false, error: "enrollment consent required" });
  }

  const retentionDays =
    typeof body.retentionDays === "number" ? body.retentionDays : undefined;
  if (retentionDays !== undefined && (retentionDays < 1 || retentionDays > 90)) {
    return NextResponse.json({ ok: false, error: "retentionDays must be 1-90" });
  }

  const consent = buildConsentRecord(
    true,
    body.consentPayment === true,
    body.consentVersion ?? "v1",
  );

  // Existing account (re-enrollment, 要件9.2) or a new account (要件2.1).
  let accountId = body.accountId;
  let balance = 0;
  if (accountId) {
    const acct = await prisma.account.findUnique({ where: { id: accountId } });
    if (!acct) return NextResponse.json({ ok: false, error: "account not found" });
    balance = acct.balance;
    await prisma.account.update({
      where: { id: accountId },
      data: {
        consentEnrollment: true,
        consentPayment: consent.consentPayment,
        consentTs: consent.consentTs,
        consentVersion: consent.consentVersion,
        ...(retentionDays !== undefined ? { retentionDays } : {}),
      },
    });
  } else {
    const acct = await prisma.account.create({
      data: {
        balance: 0,
        consentEnrollment: true,
        consentPayment: consent.consentPayment,
        consentTs: consent.consentTs,
        consentVersion: consent.consentVersion,
        ...(retentionDays !== undefined ? { retentionDays } : {}),
      },
    });
    accountId = acct.id;
  }

  try {
    const res = await storeTemplate(accountId, body.vector);
    return NextResponse.json({
      ok: true,
      accountId,
      templateId: res.templateId,
      templateCount: res.templateCount,
      evictedOldest: res.evictedOldest,
      balance,
    });
  } catch {
    // Storage failure: template set rolled back by the transaction (要件1.11, 9.4).
    return NextResponse.json({ ok: false, accountId, error: "template store failed" });
  }
}
