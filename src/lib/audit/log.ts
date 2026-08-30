// 担当C — Audit_Service. Append-only audit logger shared by A/B/C via this contract.
// ULID ids, append-only (no update/delete API). Vector values are NEVER logged
// (要件11.10, 14.4). Callers must pass only non-sensitive detail.
import { ulid } from "ulid";
import { prisma } from "@/lib/db";

export type AuditEventType =
  | "identify" // Auth_Service access (要件11.10)
  | "enroll"
  | "consent_record"
  | "consent_revoke"
  | "template_delete" // 要件10.6
  | "session_entry"
  | "session_exit"
  | "session_inconsistency" // 要件8.4
  | "session_force_close" // 要件8.7
  | "force_close_failed" // 要件8.9
  | "unidentified_exit" // 要件8.5
  | "auth_failure" // 要件9.6
  | "payment_declined"
  | "manual_operation" // 要件14.5
  | "purpose_denied" // 要件11.3
  | "model_version_unsupported"; // 要件13.10

/** A single JSON-serializable detail object. Must not contain vector values. */
export type AuditDetail = Record<string, unknown>;

// Defensive: strip anything that looks like a raw feature vector before persisting.
function sanitize(detail: AuditDetail): AuditDetail {
  const clean: AuditDetail = {};
  for (const [k, val] of Object.entries(detail)) {
    if (/vector|descriptor|embedding|template/i.test(k)) {
      // Record only presence/length, never the values (要件11.10, 13.7).
      if (Array.isArray(val)) clean[`${k}_len`] = val.length;
      continue;
    }
    clean[k] = val;
  }
  return clean;
}

/**
 * Append one audit entry. Returns the generated ULID.
 * Append-only: there is intentionally no update/delete counterpart (要件14.4).
 */
export async function appendAudit(
  eventType: AuditEventType,
  detail: AuditDetail = {},
  accountId?: string,
): Promise<string> {
  const id = ulid();
  await prisma.auditLog.create({
    data: {
      id,
      eventType,
      accountId: accountId ?? null,
      detail: JSON.stringify(sanitize(detail)),
    },
  });
  return id;
}
