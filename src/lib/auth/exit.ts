// 担当A — Session close + retention scheduling (testable core).
// Requirements 8.1 (ACTIVE->CLOSED, record exit time), 8.2 (expireAt = exit + retention).
import { prisma } from "@/lib/db";
import type { PassEvent, SessionState } from "@/types/session";

/** Compute the retention expiry: exit time + retentionDays (要件8.2, 10.1). */
export function computeExpireAt(exitedAt: Date, retentionDays: number): Date {
  const d = new Date(exitedAt);
  d.setDate(d.getDate() + retentionDays);
  return d;
}

/**
 * Close a session (CLOSED or FORCE_CLOSED), record the exit time, and set the
 * retention expireAt on all of the account's templates. Runs in one transaction.
 */
export async function closeSessionAndScheduleRetention(
  sessionId: string,
  accountId: string,
  exitedAt: Date,
  passHistory: PassEvent[],
  newState: Extract<SessionState, "CLOSED" | "FORCE_CLOSED">,
): Promise<Date> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { retentionDays: true },
  });
  const retentionDays = account?.retentionDays ?? 7;
  const expireAt = computeExpireAt(exitedAt, retentionDays);

  await prisma.$transaction([
    prisma.session.update({
      where: { id: sessionId },
      data: {
        state: newState,
        exitedAt,
        passHistory: JSON.stringify(passHistory),
      },
    }),
    prisma.faceTemplate.updateMany({
      where: { accountId },
      data: { expireAt },
    }),
  ]);

  return expireAt;
}
