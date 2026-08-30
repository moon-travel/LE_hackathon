// 担当A — Session_Service (入場). POST /api/entry
// Requirements 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 3.12, 4.1, 4.2, 4.3, 4.4, 4.6, 4.7.
import { NextResponse } from "next/server";
import type { EntryRequest, EntryResponse } from "@/types/api";
import type { PassEvent } from "@/types/session";
import { isValidFaceVector } from "@/types/vector";
import { prisma } from "@/lib/db";
import { identify } from "@/lib/auth/identify";
import { buildPopulation } from "@/lib/auth/population";
import { hasValidPass } from "@/lib/auth/tickets";
import { appendAudit } from "@/lib/audit/log";

async function openForAccount(accountId: string, manual: boolean): Promise<EntryResponse> {
  // Bathing ticket check (要件3.8 / 4.4 / 4.7).
  if (!(await hasValidPass(accountId))) {
    return { result: "no_pass", accountId, gateOpen: false };
  }

  const now = new Date();
  const existing = await prisma.session.findFirst({
    where: { accountId, state: "ACTIVE" },
  });

  if (existing) {
    // Already ACTIVE: keep it, just record the crossing and open (要件3.9, 4.1, 4.2).
    const history: PassEvent[] = JSON.parse(existing.passHistory);
    history.push({ ts: now.toISOString(), gate: "entry", manual });
    await prisma.session.update({
      where: { id: existing.id },
      data: { passHistory: JSON.stringify(history) },
    });
    await appendAudit("session_entry", { sessionId: existing.id, reentry: true, manual }, accountId);
    return { result: "reentered", accountId, sessionId: existing.id, gateOpen: true };
  }

  // New ACTIVE session (要件3.4 / 4.4).
  const history: PassEvent[] = [{ ts: now.toISOString(), gate: "entry", manual }];
  const session = await prisma.session.create({
    data: {
      accountId,
      state: "ACTIVE",
      enteredAt: now,
      passHistory: JSON.stringify(history),
      transactions: "[]",
    },
  });
  await appendAudit("session_entry", { sessionId: session.id, reentry: false, manual }, accountId);
  return { result: "entered", accountId, sessionId: session.id, gateOpen: true };
}

export async function POST(
  req: Request,
): Promise<NextResponse<EntryResponse | { error: string }>> {
  let body: Partial<EntryRequest>;
  try {
    body = (await req.json()) as Partial<EntryRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // Manual staff override: open for a specified account (要件3.12).
  if (body.manualAccountId) {
    const acct = await prisma.account.findUnique({ where: { id: body.manualAccountId } });
    if (!acct) return NextResponse.json({ error: "account not found" }, { status: 404 });
    const out = await openForAccount(body.manualAccountId, true);
    return NextResponse.json(out);
  }

  if (!isValidFaceVector(body.vector)) {
    return NextResponse.json({ error: "invalid vector" }, { status: 400 });
  }

  const population = await buildPopulation("entry");
  const outcome = identify(body.vector, "entry", population);

  await appendAudit(
    "identify",
    { purpose: "entry", result: outcome.result, populationSize: population.length },
    outcome.accountId,
  );

  if (outcome.result === "none") {
    await appendAudit("auth_failure", { location: "entry", reason: "none" });
    return NextResponse.json({ result: "auth_failed", gateOpen: false });
  }
  if (outcome.result === "ambiguous") {
    await appendAudit("auth_failure", { location: "entry", reason: "ambiguous" });
    return NextResponse.json({ result: "ambiguous", gateOpen: false });
  }

  const out = await openForAccount(outcome.accountId!, false);
  return NextResponse.json(out);
}
