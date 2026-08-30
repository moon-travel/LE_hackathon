// 担当B — Pass (利用権) logic. Requirements 7.1, 7.2, 7.3, 7.5, 7.6, 7.7.
import { prisma } from "@/lib/db";

/** Business-day end = 23:59:59.999 of the purchase day (要件7.1). */
export function businessDayEnd(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** A pass is valid iff status VALID and now < expiresAt (要件7.2, 7.3, 7.5). */
export function isPassValid(
  pass: { status: string; expiresAt: Date },
  now = new Date(),
): boolean {
  return pass.status === "VALID" && now.getTime() < pass.expiresAt.getTime();
}

export interface IssueResult {
  ok: boolean;
  passId?: string;
  expiresAt?: Date;
  alreadyExists?: boolean;
}

/**
 * Issue a pass for an account. If a valid pass already exists, do NOT issue a
 * new one and do not change the existing expiry (要件7.7).
 */
export async function issuePass(accountId: string, now = new Date()): Promise<IssueResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false };

  // Expire stale passes first.
  await prisma.pass.updateMany({
    where: { accountId, status: "VALID", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });

  const existing = await prisma.pass.findFirst({
    where: { accountId, status: "VALID", expiresAt: { gt: now } },
  });
  if (existing) {
    return { ok: true, passId: existing.id, expiresAt: existing.expiresAt, alreadyExists: true };
  }

  const expiresAt = businessDayEnd(now);
  const pass = await prisma.pass.create({
    data: { accountId, status: "VALID", expiresAt },
  });
  return { ok: true, passId: pass.id, expiresAt, alreadyExists: false };
}

/** Verify a pass for an account (要件7.2, 7.3 idempotent within validity). */
export async function verifyPass(accountId: string, now = new Date()): Promise<boolean> {
  await prisma.pass.updateMany({
    where: { accountId, status: "VALID", expiresAt: { lte: now } },
    data: { status: "EXPIRED" },
  });
  const valid = await prisma.pass.findFirst({
    where: { accountId, status: "VALID", expiresAt: { gt: now } },
    select: { id: true },
  });
  return valid !== null;
}
