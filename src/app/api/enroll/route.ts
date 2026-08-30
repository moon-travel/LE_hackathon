// 担当C — Enrollment. POST /api/enroll
// _Requirements: 1.3, 1.6, 1.7, 1.11, 9.1, 9.2, 9.3, 9.4, 9.7, 10.2, 11.4_
//
// ブラウザは 128 次元ベクトルだけを送る。元の顔画像はここには届かない（要件1-7 / 11-4）。
// 応答は凍結契約 src/types/api.ts の EnrollResponse / ApiError に従い、失敗は HTTP ステータスで表す。
import { NextResponse } from "next/server";
import type { EnrollRequest, EnrollResponse, ApiError } from "@/types/api";
import { isValidVector } from "@/lib/auth/distance";
import { prisma } from "@/lib/db";
import { buildConsentRecord } from "@/lib/consent/record";
import { storeTemplate } from "@/lib/consent/enrollTemplate";

export async function POST(
  req: Request,
): Promise<NextResponse<EnrollResponse | ApiError>> {
  let body: Partial<EnrollRequest>;
  try {
    body = (await req.json()) as Partial<EnrollRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json", reason: "bad_request" }, { status: 400 });
  }

  if (!isValidVector(body.vector)) {
    return NextResponse.json(
      { error: "invalid vector", reason: "invalid_vector" },
      { status: 400 },
    );
  }
  const vector = body.vector;

  // 顔登録同意がなければテンプレートを保管しない（要件1-3）。
  if (body.consentEnrollment !== true) {
    return NextResponse.json(
      { error: "enrollment consent required", reason: "no_consent" },
      { status: 400 },
    );
  }

  // 顧客指定保管期間は 1〜90 日（要件10-2）。
  const retentionDays =
    typeof body.retentionDays === "number" ? body.retentionDays : undefined;
  if (retentionDays !== undefined && (retentionDays < 1 || retentionDays > 90)) {
    return NextResponse.json(
      { error: "retentionDays must be 1-90", reason: "invalid_retention_days" },
      { status: 400 },
    );
  }

  const consent = buildConsentRecord(
    true,
    body.consentPayment === true,
    body.consentVersion ?? "v1",
  );

  // 既存アカウントへの再登録（要件9-2）か、新規アカウント生成（要件2-1）。
  let accountId = body.accountId;
  if (accountId) {
    const acct = await prisma.account.findUnique({ where: { id: accountId } });
    if (!acct) {
      return NextResponse.json(
        { error: "account not found", reason: "no_account" },
        { status: 404 },
      );
    }
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
    const res = await storeTemplate(accountId, vector);
    return NextResponse.json({
      accountId,
      templateId: res.templateId,
      templateCount: res.templateCount,
    });
  } catch {
    // 保管失敗時はトランザクションでテンプレート集合が巻き戻る（要件1-11 / 9-4）。
    return NextResponse.json(
      { error: "template store failed", reason: "store_failed" },
      { status: 500 },
    );
  }
}
