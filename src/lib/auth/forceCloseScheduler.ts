// 担当A — business-day-end force close. Requirements 8.6, 8.7, 8.8.
// After closing time + grace period, ACTIVE sessions become FORCE_CLOSED with
// the closing time recorded as exit time, and retention expiry is scheduled.
import { prisma } from "@/lib/db";
import { closeSessionAndScheduleRetention } from "./exit";
import { appendAudit } from "@/lib/audit/log";
import type { PassEvent } from "@/types/session";

/**
 * Force-close all ACTIVE sessions, recording `closingTime` as the exit time
 * (要件8.6). Intended to be invoked once the closing time + 60min grace has
 * elapsed. Returns the number of sessions closed.
 */
export async function forceCloseAll(closingTime = new Date()): Promise<number> {
  const active = await prisma.session.findMany({ where: { state: "ACTIVE" } });
  let closed = 0;
  for (const s of active) {
    const history: PassEvent[] = JSON.parse(s.passHistory);
    history.push({ ts: closingTime.toISOString(), gate: "exit" });
    await closeSessionAndScheduleRetention(
      s.id,
      s.accountId,
      closingTime,
      history,
      "FORCE_CLOSED",
    );
    await appendAudit(
      "session_force_close",
      { reason: "business_day_end", exitedAt: closingTime.toISOString() },
      s.accountId,
    );
    closed++;
  }
  return closed;
}
