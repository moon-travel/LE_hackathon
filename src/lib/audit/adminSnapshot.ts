// 担当C — Admin_Console のスナップショット構築。要件14-1 / 14-2 / 14-3 / 14-6 / 14-7。
//
// 応答型は凍結契約 src/types/api.ts の AdminGetResponse に従う。
// 母集団上限は担当A の POPULATION_LIMIT を単一の出所として参照する（要件3-2 / 14-6 / 14-7 が
// 同じ値を見る必要があるため、Admin 側で別定義しない）。

import { prisma } from "@/lib/db";
import { POPULATION_LIMIT } from "@/lib/auth/distance";
import type { AdminGetResponse, AdminSessionItem, AdminAuditItem } from "@/types/api";
import { parsePassHistory } from "@/lib/auth/session";

/** 上限接近警告のしきい値（要件14-6: 上限の90%）。 */
const NEAR_CAPACITY_RATIO = 0.9;

/** 通過履歴の表示件数（要件14-2: 最新20件）。 */
const PASS_HISTORY_LIMIT = 20;

/** 監査ログの取得件数（要件14-3: 降順・最大1000件）。 */
const AUDIT_LOG_LIMIT = 1000;

export async function buildAdminSnapshot(now: Date = new Date()): Promise<AdminGetResponse> {
  const active = await prisma.session.findMany({
    where: { state: "ACTIVE" },
    orderBy: { enteredAt: "desc" },
    take: POPULATION_LIMIT,
  });

  const accountIds = Array.from(new Set(active.map((s) => s.accountId)));

  // セッションごとに問い合わせると件数分だけ往復するので、まとめて引いて引き当てる。
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
    select: { id: true, balance: true },
  });
  const balanceByAccount = new Map(accounts.map((a) => [a.id, a.balance]));

  // 有効な利用権 = status VALID かつ expiresAt が現在より後（要件7-2 / 7-5）。
  // 判定基準は担当B の /api/pass と同一。ここでは表示のみで状態は書き換えない。
  const validPasses = await prisma.pass.findMany({
    where: { accountId: { in: accountIds }, status: "VALID", expiresAt: { gt: now } },
    select: { accountId: true },
  });
  const accountsWithValidPass = new Set(validPasses.map((p) => p.accountId));

  const sessions: AdminSessionItem[] = active.map((s) => ({
    sessionId: s.id,
    accountId: s.accountId,
    enteredAt: s.enteredAt.toISOString(),
    // 通過履歴は担当A の形式（PassageEntry: { gate, at }）。復元は A の parser に委ねる。
    passHistory: parsePassHistory(s.passHistory).slice(-PASS_HISTORY_LIMIT),
    balance: balanceByAccount.get(s.accountId) ?? 0,
    hasValidPass: accountsWithValidPass.has(s.accountId),
  }));

  const activeCount = await prisma.session.count({ where: { state: "ACTIVE" } });

  const logs = await prisma.auditLog.findMany({
    orderBy: { ts: "desc" },
    take: AUDIT_LOG_LIMIT,
  });
  const auditLogs: AdminAuditItem[] = logs.map((l) => ({
    id: l.id,
    ts: l.ts.toISOString(),
    eventType: l.eventType,
    accountId: l.accountId ?? undefined,
    detail: safeParseDetail(l.detail),
  }));

  return {
    activeCount,
    capacity: POPULATION_LIMIT,
    sessions,
    auditLogs,
    nearCapacityWarning: activeCount >= POPULATION_LIMIT * NEAR_CAPACITY_RATIO,
    atCapacityWarning: activeCount >= POPULATION_LIMIT,
  };
}

/** 監査ログの detail は JSON 文字列。壊れていても管理画面全体を落とさない。 */
function safeParseDetail(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
