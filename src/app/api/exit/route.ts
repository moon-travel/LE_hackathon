// 担当A — Session_Service (退場). POST /api/exit
// Requirements 8.1, 8.2, 8.3, 8.4.
import { NextResponse } from "next/server";
import type { ExitRequest, ExitResponse } from "@/types/api";
import type { PassEvent } from "@/types/session";
import { isValidFaceVector } from "@/types/vector";
import { prisma } from "@/lib/db";
import { identify } from "@/lib/auth/identify";
import { buildPopulation } from "@/lib/auth/population";
import { closeSessionAndScheduleRetention } from "@/lib/auth/exit";
import { appendAudit } from "@/lib/audit/log";

async function handleExit(accountId: string): Promise<ExitResponse> {
  const active = await prisma.session.findFirst({
    where: { accountId, state: "ACTIVE" },
  });
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  const balance = account?.balance ?? 0;

  if (!active) {
    // No ACTIVE session: open anyway, log inconsistency (要件8.4).
    const last = await prisma.session.findFirst({
      where: { accountId },
      orderBy: { enteredAt: "desc" },
      select: { state: true },
    });
    await appendAudit(
      "session_inconsistency",
      { location: "exit", lastState: last?.state ?? "none" },
      accountId,
    );
    return { result: "no_active_session", accountId, gateOpen: true, balance };
  }

  const now = new Date();
  const history: PassEvent[] = JSON.parse(active.passHistory);
  history.push({ ts: now.toISOString(), gate: "exit" });

  await closeSessionAndScheduleRetention(active.id, accountId, now, history, "CLOSED");

  await appendAudit("session_exit", { sessionId: active.id }, accountId);
  return { result: "exited", accountId, sessionId: active.id, gateOpen: true, balance };
}

export async function POST(
  req: Request,
): Promise<NextResponse<ExitResponse | { error: string }>> {
  let body: Partial<ExitRequest>;
  try {
    body = (await req.json()) as Partial<ExitRequest>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (body.manualAccountId) {
    const acct = await prisma.account.findUnique({ where: { id: body.manualAccountId } });
    if (!acct) return NextResponse.json({ error: "account not found" }, { status: 404 });
    return NextResponse.json(await handleExit(body.manualAccountId));
  }

  if (!isValidFaceVector(body.vector)) {
    return NextResponse.json({ error: "invalid vector" }, { status: 400 });
  }

  const population = await buildPopulation("active");
  const outcome = identify(body.vector, "entry", population);

  await appendAudit(
    "identify",
    { purpose: "entry", location: "exit", result: outcome.result },
    outcome.accountId,
  );

  if (outcome.result !== "matched" || !outcome.accountId) {
    await appendAudit("unidentified_exit", { reason: outcome.result });
    return NextResponse.json({ result: "auth_failed", gateOpen: false });
  }

  return NextResponse.json(await handleExit(outcome.accountId));
}
