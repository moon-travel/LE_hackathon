// 担当A — build the 1:N identification population from the DB.
// Requirements 3.2 (当日ACTIVE+当日登録, cap 500), 5.1 (ACTIVE only for payment),
// 13.10 (skip templates whose model version is unsupported).
import { prisma } from "@/lib/db";
import { decodeTemplate } from "@/lib/codec";
import { appendAudit } from "@/lib/audit/log";
import { CURRENT_MODEL_VERSION, POPULATION_CAP, type FaceVector } from "@/types/vector";
import type { Candidate } from "./identify";

const SUPPORTED_MODEL_VERSIONS = new Set<string>([CURRENT_MODEL_VERSION]);

function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Build candidates for identification.
 *
 * @param scope
 *  - "entry": accounts that are ACTIVE today OR registered today (要件3.2)
 *  - "active": only accounts with an ACTIVE session (payment / pass, 要件5.1)
 */
export async function buildPopulation(
  scope: "entry" | "active",
  now = new Date(),
): Promise<Candidate[]> {
  const dayStart = startOfToday(now);

  // Accounts with an ACTIVE session (today).
  const activeSessions = await prisma.session.findMany({
    where: { state: "ACTIVE" },
    select: { accountId: true },
  });
  const activeAccountIds = new Set(activeSessions.map((s) => s.accountId));

  let accountIds: Set<string>;
  if (scope === "active") {
    accountIds = activeAccountIds;
  } else {
    // entry: ACTIVE today + registered today (templates created today).
    const todayTemplates = await prisma.faceTemplate.findMany({
      where: { createdAt: { gte: dayStart } },
      select: { accountId: true },
    });
    accountIds = new Set<string>([
      ...activeAccountIds,
      ...todayTemplates.map((t) => t.accountId),
    ]);
  }

  const ids = Array.from(accountIds).slice(0, POPULATION_CAP);
  if (ids.length === 0) return [];

  const templates = await prisma.faceTemplate.findMany({
    where: { accountId: { in: ids } },
    select: { id: true, accountId: true, vector: true },
  });

  const byAccount = new Map<string, FaceVector[]>();
  for (const t of templates) {
    let decoded;
    try {
      decoded = decodeTemplate(t.vector);
    } catch {
      // Corrupt/undecodable template: skip it (defensive).
      continue;
    }
    // Skip templates whose model version isn't supported (要件13.10).
    if (!SUPPORTED_MODEL_VERSIONS.has(decoded.modelVersion)) {
      await appendAudit(
        "model_version_unsupported",
        { templateId: t.id, modelVersion: decoded.modelVersion, reenrollNeeded: true },
        t.accountId,
      );
      continue;
    }
    const arr = byAccount.get(t.accountId) ?? [];
    arr.push(decoded.vector);
    byAccount.set(t.accountId, arr);
  }

  const candidates: Candidate[] = [];
  for (const [accountId, vectors] of byAccount) {
    candidates.push({ accountId, templates: vectors });
  }
  return candidates;
}
