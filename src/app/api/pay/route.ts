// 担当: B — Account_Service /api/pay（要件5/6）。
// 型契約は src/types/api.ts（凍結）。ハンドラ本体は src/lib/account/pay.ts の純関数 handlePay に分離し、
// IdentifyPort（担当A）・AuditPort（担当C）・PaymentGateway をポート注入する（判断1）。
// A/C は並行実装中のため既定は安全側スタブ（identify=none）を注入。Phase2 統合で差し替える。
import { NextResponse } from "next/server";
import type { PayRequest, PayResponse } from "@/types/api";
import { handlePay } from "@/lib/account/pay";
import { createStubIdentifyPort, noopAuditPort } from "@/lib/account/ports";
import { defaultGateway } from "@/lib/payment-mock/gateway";

// Phase2 統合まで: 担当A の identify 未接続のため、安全側（none）を既定注入する。
// 統合時にこの注入を実 IdentifyPort に差し替える。
const defaultIdentifyPort = createStubIdentifyPort({ result: "none" });

export async function POST(
  request: Request,
): Promise<NextResponse<PayResponse | { error: string }>> {
  const body = (await request.json().catch(() => null)) as PayRequest | null;
  if (!body || !Array.isArray(body.vector)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { status, body: res } = await handlePay(body, {
    identifyPort: defaultIdentifyPort,
    gateway: defaultGateway,
    auditPort: noopAuditPort,
  });

  return NextResponse.json(res, { status });
}
