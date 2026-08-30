// Retention_Service: 保管期限の走査（保険）。
// _Requirements: 10.4, 10.5, 10.8, 10.10, 10.11_
//
// 同期削除（deleteTemplate.ts）が本体で、こちらは取り逃がしを拾う保険。
// design.md に従いデモは1分周期。要件10-5 は「60分以内の間隔」なので要件より厳しい側。

import { AuditEvent, prismaRetentionStore } from "./store";
import type { RetentionStore, TemplateLike } from "./store";

/** 走査間隔。要件10-5 は60分以内。デモの体験を成立させるため1分にする。 */
export const SCAN_INTERVAL_MS = 60 * 1000;

/** 削除失敗時のリトライ上限（要件10-10）。 */
export const MAX_DELETE_RETRIES = 3;

export interface ScanResult {
  deletedCount: number;
  /** ACTIVE セッション保持のため延期したテンプレート件数（要件10-8）。 */
  deferredCount: number;
  /** リトライ上限に達し削除待ちのまま残った件数（要件10-10）。 */
  pendingCount: number;
}

/**
 * 削除失敗回数。単一プロセス前提なのでメモリ上で数える（凍結スキーマに retryCount 列を
 * 足さないための設計。docs/design/A-auth-session-retention.md 5.3節）。
 */
const failureCounts = new Map<string, number>();

/** テスト用。失敗カウンタを初期化する。 */
export function resetRetryState(): void {
  failureCounts.clear();
}

/**
 * 期限切れテンプレートを1回走査して削除する（要件10-4 / 10-5）。
 *
 * - ACTIVE セッションを持つアカウントのテンプレートはスキップして延期する（要件10-8）
 * - 削除は FaceTemplate のみ。残高・カードトークン・利用権・取引記録は触らない（要件10-9）
 * - 削除完了後は同一DBを引くため即座に母集団から外れる（要件10-11 の「60秒以内」を構造的に満たす）
 * - 失敗時は最大3回までリトライし、超過分は削除待ちのまま管理者へ通知する（要件10-10）
 */
export async function runRetentionScan(
  store: RetentionStore = prismaRetentionStore,
  now: Date = new Date(),
): Promise<ScanResult> {
  const expired = await store.listExpired(now);

  // アカウント単位にまとめる（ACTIVE 判定をアカウントごとに1回で済ませるため）。
  const byAccount = new Map<string, TemplateLike[]>();
  for (const t of expired) {
    const list = byAccount.get(t.accountId);
    if (list === undefined) byAccount.set(t.accountId, [t]);
    else list.push(t);
  }

  let deletedCount = 0;
  let deferredCount = 0;
  let pendingCount = 0;

  for (const [accountId, templates] of byAccount) {
    if (await store.hasActiveSession(accountId)) {
      // 要件10-8: セッション終了まで削除しない。expireAt は既に過去なので次回走査で再度拾われる。
      deferredCount += templates.length;
      continue;
    }

    // リトライ上限に達したものは削除待ちのまま残す（要件10-10）。
    const targets = templates.filter(
      (t) => (failureCounts.get(t.id) ?? 0) < MAX_DELETE_RETRIES,
    );
    pendingCount += templates.length - targets.length;
    if (targets.length === 0) continue;

    try {
      const count = await store.deleteTemplatesByIds(targets.map((t) => t.id));
      deletedCount += count;
      for (const t of targets) failureCounts.delete(t.id);

      // 要件10-6: 削除日時・対象アカウント・契機を記録。内容は記録しない。
      await store.appendAudit({
        eventType: AuditEvent.TEMPLATE_DELETED,
        accountId,
        ts: now,
        detail: { trigger: "EXPIRED", deletedCount: count, deferred: false },
      });
    } catch (error) {
      // 要件10-10: 60分以内の間隔で最大3回まで再試行。3回すべて失敗したら削除待ちで維持し通知。
      let exhausted = false;
      for (const t of targets) {
        const next = (failureCounts.get(t.id) ?? 0) + 1;
        failureCounts.set(t.id, next);
        if (next >= MAX_DELETE_RETRIES) exhausted = true;
      }
      pendingCount += targets.length;
      await store.appendAudit({
        eventType: AuditEvent.TEMPLATE_DELETE_FAILED,
        accountId,
        ts: now,
        detail: {
          attemptedCount: targets.length,
          message: error instanceof Error ? error.message : "unknown error",
          retriesExhausted: exhausted,
          notifyAdministrator: exhausted,
        },
      });
    }
  }

  return { deletedCount, deferredCount, pendingCount };
}

/**
 * 走査タイマーの起動。
 *
 * 開発時の HMR で複数のタイマーが走るのを防ぐため globalThis でシングルトン化する。
 * サーバーレス環境では setInterval の動作が保証されないが、ローカル単一プロセス実行前提の
 * MVP なので許容する（design.md の割り切り）。
 */
const globalForScanner = globalThis as unknown as {
  retentionScannerTimer?: ReturnType<typeof setInterval>;
};

export function startRetentionScanner(intervalMs: number = SCAN_INTERVAL_MS): void {
  if (globalForScanner.retentionScannerTimer !== undefined) return;
  const timer = setInterval(() => {
    void runRetentionScan().catch(() => {
      // 走査自体の失敗でプロセスを落とさない。個々の削除失敗は上で監査記録している。
    });
  }, intervalMs);
  // Node のイベントループを掴み続けないようにする。
  if (typeof timer.unref === "function") timer.unref();
  globalForScanner.retentionScannerTimer = timer;
}

export function stopRetentionScanner(): void {
  if (globalForScanner.retentionScannerTimer === undefined) return;
  clearInterval(globalForScanner.retentionScannerTimer);
  globalForScanner.retentionScannerTimer = undefined;
}
