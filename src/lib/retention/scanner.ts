// 担当A — Retention_Service scan (the insurance path, not the body).
// Requirements 10.4, 10.5, 10.11.
// A periodic sweep (setInterval, demo 1-min period) + manual trigger deletes
// every template whose expireAt has passed. Deletion is immediate on detection.
import { prisma } from "@/lib/db";
import { appendAudit } from "@/lib/audit/log";

/**
 * Delete all templates whose expireAt <= now. Returns the number deleted.
 * Records one audit entry per swept account (要件10.6, contents excluded).
 */
export async function runRetentionScan(now = new Date()): Promise<number> {
  const expired = await prisma.faceTemplate.findMany({
    where: { expireAt: { not: null, lte: now } },
    select: { id: true, accountId: true },
  });
  if (expired.length === 0) return 0;

  const ids = expired.map((t) => t.id);
  const result = await prisma.faceTemplate.deleteMany({ where: { id: { in: ids } } });

  // Group by account for auditing (no template contents).
  const byAccount = new Map<string, number>();
  for (const t of expired) {
    byAccount.set(t.accountId, (byAccount.get(t.accountId) ?? 0) + 1);
  }
  for (const [accountId, count] of byAccount) {
    await appendAudit("template_delete", { trigger: "expiry", count }, accountId);
  }
  return result.count;
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the periodic sweep. Demo period defaults to 60s. Idempotent. */
export function startRetentionScanner(periodMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    runRetentionScan().catch(() => {
      /* swept next tick; scan failures are non-fatal for the demo */
    });
  }, periodMs);
  // Don't keep the process alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();
}

export function stopRetentionScanner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
