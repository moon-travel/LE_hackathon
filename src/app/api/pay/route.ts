// 担当B — Account_Service (施設内決済). POST /api/pay
// Requirements 5.2-5.9, 6.1-6.4, 6.6, 6.9.
import { NextResponse } from "next/server";
import type { PayRequest, PayResponse } from "@/types/api";
import { isValidFaceVector } from "@/types/vector";
import { prisma } from "@/lib/db";
import { identify } from "@/lib/auth/identify";
import { buildPopulation } from "@/lib/auth/population";
import { deductBalance, creditBalance } from "@/lib/account/charge";
import { PAY_MIN, PAY_MAX, chargeFits } from "@/lib/account/balance";
import * as gateway from "@/lib/payment-mock/gateway";
import { appendAudit } from "@/lib/audit/log";

export async function POST(
  req: Request,
): Promise<NextResponse<PayResponse | { error: string }>> {
  let body: Partial<PayRequest>;
  try {
    body = (await req.json()) as Partial<PayRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (typeof body.amount !== "number" || body.amount < PAY_MIN || body.amount > PAY_MAX) {
    return NextResponse.json({ error: `amount must be ${PAY_MIN}..${PAY_MAX}` }, { status: 400 });
  }
  if (!body.terminal) {
    return NextResponse.json({ error: "terminal required" }, { status: 400 });
  }
  if (!isValidFaceVector(body.vector)) {
    return NextResponse.json({ error: "invalid vector" }, { status: 400 });
  }

  const amount = body.amount;

  // 1:N identify over ACTIVE-session accounts (要件5.1).
  const population = await buildPopulation("active");
  const outcome = identify(body.vector, "payment", population);
  await appendAudit(
    "identify",
    { purpose: "payment", result: outcome.result, terminal: body.terminal },
    outcome.accountId,
  );

  if (outcome.result === "none") {
    return NextResponse.json({ result: "auth_failed" });
  }
  if (outcome.result === "ambiguous") {
    return NextResponse.json({ result: "ambiguous" });
  }

  const accountId = outcome.accountId!;

  // Resolve the ACTIVE session for idempotency scope + transaction recording.
  const session = await prisma.session.findFirst({
    where: { accountId, state: "ACTIVE" },
    orderBy: { enteredAt: "desc" },
  });
  const sessionId = body.sessionId ?? session?.id;
  if (!sessionId) {
    return NextResponse.json({ result: "failed" });
  }

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return NextResponse.json({ result: "failed" });

  // Insufficient balance -> attempt auto-charge, else signal insufficient (要件5.8, 6.1, 6.3).
  if (account.balance < amount) {
    if (account.autoChargeEnabled && account.autoChargeAmount && account.cardToken) {
      const fit = chargeFits(account.balance, account.autoChargeAmount);
      if (fit.ok) {
        const res = await gateway.charge(account.autoChargeAmount);
        if (res.ok) {
          await creditBalance(accountId, account.autoChargeAmount);
        }
      }
    }
    // Re-read balance after any auto-charge.
    const refreshed = await prisma.account.findUnique({ where: { id: accountId } });
    if (!refreshed || refreshed.balance < amount) {
      return NextResponse.json({
        result: "insufficient",
        accountId,
        balance: refreshed?.balance ?? account.balance,
        amount,
        shortfall: amount - (refreshed?.balance ?? account.balance),
      });
    }
  }

  // Atomic deduction + idempotent record (要件5.2, 5.6, 5.9).
  const result = await deductBalance({ accountId, sessionId, amount, terminal: body.terminal });

  if (result.result === "paid") {
    return NextResponse.json({ result: "paid", accountId, balance: result.balance, amount });
  }
  if (result.result === "insufficient") {
    return NextResponse.json({
      result: "insufficient",
      accountId,
      balance: result.balance,
      amount,
      shortfall: amount - result.balance,
    });
  }
  await appendAudit("payment_declined", { terminal: body.terminal, amount }, accountId);
  return NextResponse.json({ result: "failed", accountId, balance: result.balance });
}
