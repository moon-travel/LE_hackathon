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

  // 同期削除（ACTIVE セッション保持中は要件10-8 に従い延期される）。
  // 削除の契機は担当A の DeletionTrigger 区分に合わせる。同意撤回は利用者の要求なので USER_REQUEST。
  const del = await deleteTemplatesForAccount(accountId, "USER_REQUEST");
  return { ok: true, deletedTemplates: del.deletedCount, deferred: del.deferred };
}
