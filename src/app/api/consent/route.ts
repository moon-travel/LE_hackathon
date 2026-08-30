// 担当C — Consent_Service. POST /api/consent
// _Requirements: 1.2, 1.4, 1.5, 1.12, 10.7, 11.1_
//
// 応答は凍結契約 src/types/api.ts の ConsentResponse / ApiError に従う。
import { NextResponse } from "next/server";
import type { ConsentRequest, ConsentResponse, ApiError } from "@/types/api";
import { prisma } from "@/lib/db";
import { buildConsentRecord } from "@/lib/consent/record";
import { revokeEnrollmentConsent } from "@/lib/consent/revoke";
import { appendAudit } from "@/lib/audit/log";

export async function POST(
  req: Request,
): Promise<NextResponse<ConsentResponse | ApiError>> {
  let body: Partial<ConsentRequest>;
  try {
    body = (await req.json()) as Partial<ConsentRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json", reason: "bad_request" }, { status: 400 });
  }

  if (body.action === "revoke") {
    if (!body.accountId) {
      return NextResponse.json(
        { error: "accountId required", reason: "bad_request" },
        { status: 400 },
      );
    }
    const res = await revokeEnrollmentConsent(body.accountId);
    if (!res.ok) {
      return NextResponse.json(
        { error: "account not found", reason: "no_account" },
        { status: 404 },
      );
    }
    const account = await prisma.account.findUnique({
      where: { id: body.accountId },
      select: { consentPayment: true, consentTs: true },
    });
    return NextResponse.json({
      accountId: body.accountId,
      consentEnrollment: false,
      // 撤回したのは顔登録同意のみ。顔決済利用同意は独立した項目なので変えない（要件1-4）。
      consentPayment: account?.consentPayment ?? false,
      consentTs: account?.consentTs?.toISOString(),
      // 延期された場合（ACTIVE セッション保持中、要件10-8）はまだ削除していない。
      templatesDeleted: res.deletedTemplates > 0,
    });
  }

  // record（既定）: 2つの同意項目を互いに独立に記録する（要件1-4）。
  const enrollment = body.consentEnrollment === true;
  const payment = body.consentPayment === true;
  const version = body.consentVersion ?? "v1";
  const rec = buildConsentRecord(enrollment, payment, version);

  let accountId = body.accountId;
  if (accountId) {
    const existing = await prisma.account.findUnique({ where: { id: accountId } });
    if (!existing) {
      return NextResponse.json(
        { error: "account not found", reason: "no_account" },
        { status: 404 },
      );
    }
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

  await appendAudit("consent_record", { enrollment, payment, version }, accountId);

  return NextResponse.json({
    accountId,
    consentEnrollment: enrollment,
    consentPayment: payment,
    consentTs: rec.consentTs.toISOString(),
  });
}
