// 担当C — Consent_Service. POST /api/consent
// Requirements 1.2, 1.4, 1.5, 1.12, 11.1.
import { NextResponse } from "next/server";
import type { ConsentRequest, ConsentResponse } from "@/types/api";
import { prisma } from "@/lib/db";
import { buildConsentRecord } from "@/lib/consent/record";
import { revokeEnrollmentConsent } from "@/lib/consent/revoke";
import { appendAudit } from "@/lib/audit/log";

export async function POST(
  req: Request,
): Promise<NextResponse<ConsentResponse | { error: string }>> {
  let body: Partial<ConsentRequest>;
  try {
    body = (await req.json()) as Partial<ConsentRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.action === "revoke") {
    if (!body.accountId) return NextResponse.json({ ok: false, error: "accountId required" });
    const res = await revokeEnrollmentConsent(body.accountId);
    if (!res.ok) return NextResponse.json({ ok: false, error: "account not found" });
    return NextResponse.json({
      ok: true,
      accountId: body.accountId,
      consentEnrollment: false,
      deletedTemplates: res.deletedTemplates,
    });
  }

  // record (default): record two independent consent items (要件1.4).
  const enrollment = body.consentEnrollment === true;
  const payment = body.consentPayment === true;
  const version = body.consentVersion ?? "v1";
  const rec = buildConsentRecord(enrollment, payment, version);

  // Attach to an existing account or create a fresh one.
  let accountId = body.accountId;
  if (accountId) {
    await prisma.account.update({
      where: { id: accountId },
      data: {
        consentEnrollment: rec.consentEnrollment,
        consentPayment: rec.consentPayment,
        consentTs: rec.consentTs,
        consentVersion: rec.consentVersion,
      },
    });
  } else {
    const acct = await prisma.account.create({
      data: {
        balance: 0,
        consentEnrollment: rec.consentEnrollment,
        consentPayment: rec.consentPayment,
        consentTs: rec.consentTs,
        consentVersion: rec.consentVersion,
      },
    });
    accountId = acct.id;
  }

  await appendAudit(
    "consent_record",
    { enrollment, payment, version },
    accountId,
  );

  return NextResponse.json({
    ok: true,
    accountId,
    consentEnrollment: enrollment,
    consentPayment: payment,
    consentTs: rec.consentTs.toISOString(),
  });
}
