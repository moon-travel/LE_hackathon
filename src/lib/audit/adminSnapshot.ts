// 担当C — Admin_Console snapshot builder. Requirements 14.1, 14.2, 14.3, 14.6, 14.7.
import { prisma } from "@/lib/db";
import { POPULATION_CAP } from "@/types/vector";
import type { AdminSnapshot, ActiveSessionView, AuditLogView } from "@/types/api";
import type { PassEvent } from "@/types/session";
import { isPassValid } from "@/lib/account/pass";

export async function buildAdminSnapshot(now = new Date()): Promise<AdminSnapshot> {
  const active = await prisma.session.findMany({
    where: { state: "ACTIVE" },
    orderBy: { enteredAt: "desc" },
    take: POPULATION_CAP,
  });

  const activeSessions: ActiveSessionView[] = [];
  for (const s of active) {
    const account = await prisma.account.findUnique({ where: { id: s.accountId } });
    const passes = await prisma.pass.findMany({ where: { accountId: s.accountId } });
    const hasValidPass = passes.some((p) => isPassValid(p, now));

    const history: PassEvent[] = JSON.parse(s.passHistory);
    activeSessions.push({
      sessionId: s.id,
      accountId: s.accountId,
      enteredAt: s.enteredAt.toISOString(),
      passHistory: history.slice(-20).map((h) => ({ ts: h.ts, gate: h.gate })), // latest 20 (要件14.2)
      balance: account?.balance ?? 0,
      hasValidPass,
    });
  }

  const activeCount = await prisma.session.count({ where: { state: "ACTIVE" } });

  // Audit log: descending, capped at 1000 (要件14.3).
  const logs = await prisma.auditLog.findMany({
    orderBy: { ts: "desc" },
    take: 1000,
  });
  const auditLog: AuditLogView[] = logs.map((l) => ({
    id: l.id,
    ts: l.ts.toISOString(),
    eventType: l.eventType,
    accountId: l.accountId ?? undefined,
    detail: JSON.parse(l.detail),
  }));

  return {
    activeCount,
    populationCap: POPULATION_CAP,
    nearCapacity: activeCount >= POPULATION_CAP * 0.9, // 要件14.6
    atCapacity: activeCount >= POPULATION_CAP, // 要件14.7
    activeSessions,
    auditLog,
  };
}
