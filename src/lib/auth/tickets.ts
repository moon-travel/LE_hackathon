// 担当A — shared "valid pass/ticket today" check.
// The frozen schema has a single Pass table (利用権). For the MVP a valid Pass
// serves as the entry bathing-ticket (要件3.8 当日有効な入浴券) and as the
// private-room use-right (要件7.2). Ownership note: Pass issuance/verification
// logic proper is 担当B; this helper only reads validity for the entry gate.
import { prisma } from "@/lib/db";

/**
 * Returns true if the account has at least one VALID pass that has not expired
 * as of `now`. Also lazily marks expired passes (要件7.5 経過で失効).
 */
export async function hasValidPass(accountId: string, now = new Date()): Promise<boolean> {
  // Lazily expire passes whose window has closed.
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
