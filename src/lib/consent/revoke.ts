// 担当C — Consent_Service revoke. Requirements 1.12, 10.7.
// Revoking enrollment consent triggers synchronous template deletion so that
// "delete the face -> re-entry with the same face fails" is demonstrable.
import { prisma } from "@/lib/db";
import { deleteTemplatesForAccount } from "@/lib/retention/deleteTemplate";
import { appendAudit } from "@/lib/audit/log";

export interface RevokeResult {
  ok: boolean;
  deletedTemplates: number;
  deferred: boolean;
}

/**
 * Revoke enrollment consent for an account: record the revocation and
 * synchronously delete the account's face templates (要件1.12, 10.7). If the
 * account has an ACTIVE session, deletion is deferred until it closes (要件10.8),
 * but the consent flag is cleared immediately.
 */
export async function revokeEnrollmentConsent(accountId: string): Promise<RevokeResult> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return { ok: false, deletedTemplates: 0, deferred: false };

  await prisma.account.update({
    where: { id: accountId },
    data: { consentEnrollment: false },
  });
  await appendAudit("consent_revoke", { item: "enrollment" }, accountId);

  // Synchronous deletion (respects ACTIVE session per 要件10.8).
  const del = await deleteTemplatesForAccount(accountId, "consent_revoke", true);
  return { ok: true, deletedTemplates: del.deleted, deferred: del.deferred };
}
