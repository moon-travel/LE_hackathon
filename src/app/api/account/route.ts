// 担当B — Account_Service. POST /api/account
// Requirements 2.1, 2.2, 2.4, 2.5, 2.7, 2.9, 10.9, 12.2, 12.5, 12.6, 12.8.
import { NextResponse } from "next/server";
import type { AccountRequest, AccountResponse } from "@/types/api";
import { prisma } from "@/lib/db";
import { creditBalance } from "@/lib/account/charge";
import { isValidChargeAmount, chargeFits, BALANCE_MAX } from "@/lib/account/balance";
import * as gateway from "@/lib/payment-mock/gateway";

export async function POST(
  req: Request,
): Promise<NextResponse<AccountResponse | { error: string }>> {
  let body: Partial<AccountRequest>;
  try {
    body = (await req.json()) as Partial<AccountRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  switch (body.action) {
    case "create": {
      const retentionDays =
        typeof body.retentionDays === "number" ? body.retentionDays : 7;
      if (retentionDays < 1 || retentionDays > 90) {
        return NextResponse.json({ ok: false, error: "retentionDays out of range" });
      }
      const acct = await prisma.account.create({
        data: { balance: 0, retentionDays },
      });
      return NextResponse.json({ ok: true, accountId: acct.id, balance: 0 });
    }

    case "get": {
      if (!body.accountId) return NextResponse.json({ ok: false, error: "accountId required" });
      const acct = await prisma.account.findUnique({ where: { id: body.accountId } });
      if (!acct) return NextResponse.json({ ok: false, error: "not found" });
      return NextResponse.json({
        ok: true,
        accountId: acct.id,
        balance: acct.balance,
        cardRegistered: acct.cardToken !== null,
      });
    }

    case "charge": {
      if (!body.accountId || typeof body.amount !== "number") {
        return NextResponse.json({ ok: false, error: "accountId and amount required" });
      }
      if (!isValidChargeAmount(body.amount)) {
        return NextResponse.json({
          ok: false,
          error: `charge amount must be 1000-30000`,
        });
      }
      const acct = await prisma.account.findUnique({ where: { id: body.accountId } });
      if (!acct) return NextResponse.json({ ok: false, error: "not found" });

      const fit = chargeFits(acct.balance, body.amount);
      if (!fit.ok) {
        return NextResponse.json({
          ok: false,
          balance: acct.balance,
          error: `exceeds cap ${BALANCE_MAX}; max addable ${fit.maxAddable}`,
        });
      }
      // Mock provider authorization (要件2.2, 2.3).
      const res = await gateway.charge(body.amount);
      if (!res.ok) {
        return NextResponse.json({ ok: false, balance: acct.balance, error: res.reason });
      }
      const balance = await creditBalance(body.accountId, body.amount);
      return NextResponse.json({ ok: true, accountId: acct.id, balance });
    }

    case "registerCard": {
      if (!body.accountId) return NextResponse.json({ ok: false, error: "accountId required" });
      const res = await gateway.cardAuth();
      if (!res.ok || !res.token) {
        return NextResponse.json({ ok: false, error: res.reason ?? "card auth failed" });
      }
      // Store only the provider token, never card details (要件2.7).
      await prisma.account.update({
        where: { id: body.accountId },
        data: { cardToken: res.token },
      });
      return NextResponse.json({ ok: true, accountId: body.accountId, cardRegistered: true });
    }

    case "setAutoCharge": {
      if (!body.accountId) return NextResponse.json({ ok: false, error: "accountId required" });
      const enabled = body.autoChargeEnabled === true;
      const amount = body.autoChargeAmount;
      if (enabled && (typeof amount !== "number" || amount < 1000 || amount > 30000)) {
        return NextResponse.json({ ok: false, error: "autoChargeAmount must be 1000-30000" });
      }
      await prisma.account.update({
        where: { id: body.accountId },
        data: { autoChargeEnabled: enabled, autoChargeAmount: enabled ? amount : null },
      });
      return NextResponse.json({ ok: true, accountId: body.accountId });
    }

    case "payout": {
      if (!body.accountId || typeof body.amount !== "number") {
        return NextResponse.json({ ok: false, error: "accountId and amount required" });
      }
      const acct = await prisma.account.findUnique({ where: { id: body.accountId } });
      if (!acct) return NextResponse.json({ ok: false, error: "not found" });
      if (acct.balance === 0) {
        return NextResponse.json({ ok: false, balance: 0, error: "balance is 0" });
      }
      if (body.amount < 1 || body.amount > acct.balance) {
        return NextResponse.json({
          ok: false,
          balance: acct.balance,
          error: `amount must be 1..${acct.balance}`,
        });
      }
      const method = body.payoutMethod ?? "cash";

      // Deduct first, then attempt refund; restore on refund failure (要件12.8).
      const afterDeduct = acct.balance - body.amount;
      await prisma.account.update({
        where: { id: acct.id },
        data: { balance: afterDeduct },
      });

      if (method === "card") {
        const res = await gateway.refund(body.amount);
        if (!res.ok) {
          // Restore balance on refund failure (要件12.8).
          await prisma.account.update({
            where: { id: acct.id },
            data: { balance: acct.balance },
          });
          return NextResponse.json({ ok: false, balance: acct.balance, error: res.reason });
        }
      }
      return NextResponse.json({ ok: true, accountId: acct.id, balance: afterDeduct });
    }

    default:
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
  }
}
