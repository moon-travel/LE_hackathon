// 担当A — Retention_Service synchronous deletion.
// Requirements 10.4, 10.6, 10.7, 10.8, 10.11.
// The BODY of deletion is synchronous: on exit / consent withdrawal / user
// request, matching FaceTemplates are deleted immediately. If the account still
// has an ACTIVE session, deletion is deferred until the session closes (要件10.8).
import { prisma } from "@/lib/db";
import { appendAudit } from "@/lib/audit/log";

export type DeleteTrigger = "exit" | "consent_revoke" | "user_request" | "expiry";

export interface DeleteResult {
  deleted: number;
  deferred: boolean; // true when an ACTIVE session blocks deletion (要件10.8)
}

/**
 * Synchronously delete all FaceTemplates for an account.
 * - If the account has an ACTIVE session and `respectActiveSession` is true,
 *   defer (return deferred:true, delete nothing) (要件10.8).
 * - Records a template_delete audit entry WITHOUT template contents (要件10.6).
 */
export async function deleteTemplatesForAccount(
  accountId: string,
  trigger: DeleteTrigger,
  respectActiveSession = true,
): Promise<DeleteResult> {
  if (respectActiveSession) {
    const active = await prisma.session.findFirst({
      where: { accountId, state: "ACTIVE" },
      select: { id: true },
    });
    if (active) {
      return { deleted: 0, deferred: true };
    }
  }

  const result = await prisma.faceTemplate.deleteMany({ where: { accountId } });
  if (result.count > 0) {
    await appendAudit("template_delete", { trigger, count: result.count }, accountId);
  }
  return { deleted: result.count, deferred: false };
}

/**
 * Delete a single template by id (used by the 6th-template eviction path is
 * handled in enroll; this is for targeted retention). Records audit.
 */
export async function deleteTemplateById(
  templateId: string,
  trigger: DeleteTrigger,
): Promise<boolean> {
  const tpl = await prisma.faceTemplate.findUnique({ where: { id: templateId } });
  if (!tpl) return false;
  await prisma.faceTemplate.delete({ where: { id: templateId } });
  await appendAudit("template_delete", { trigger, templateId }, tpl.accountId);
  return true;
}
