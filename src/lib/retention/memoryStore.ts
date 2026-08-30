// テスト用のインメモリ RetentionStore。
//
// Property 12（削除後の照合不成立）を DB なしで検証するために用意している。
// 併せて要件10-9（削除後も残高・カードトークン・利用権・取引記録を保持する）を検証できるよう、
// テンプレート以外の付随データも保持し、削除処理がそれらに触れていないことを確認できる形にする。

import type { AuditEntry } from "@/lib/auth/audit";
import { sanitizeDetail } from "@/lib/auth/audit";
import type { RetentionStore, TemplateLike } from "./store";

export interface MemoryTemplate {
  id: string;
  accountId: string;
  /** JSON 文字列の 128次元ベクトル（本番の SQLite 保存形式に合わせる）。 */
  vector: string;
  expireAt: Date | null;
}

/** 削除対象に含めてはならない付随データ（要件2-9 / 10-9）。 */
export interface MemoryAncillary {
  balance: number;
  cardToken: string | null;
  passIds: string[];
  transactionIds: string[];
}

export interface MemoryState {
  templates: MemoryTemplate[];
  /** ACTIVE セッションを持つアカウント（要件10-8 の延期判定用）。 */
  activeAccounts: Set<string>;
  ancillary: Map<string, MemoryAncillary>;
  audits: Array<AuditEntry & { detail: Record<string, unknown> }>;
  /** deleteTemplatesByIds を強制的に失敗させる（要件10-10 のリトライ検証用）。 */
  failDeletes: boolean;
}

export function createMemoryState(init: Partial<MemoryState> = {}): MemoryState {
  return {
    templates: init.templates ?? [],
    activeAccounts: init.activeAccounts ?? new Set<string>(),
    ancillary: init.ancillary ?? new Map<string, MemoryAncillary>(),
    audits: init.audits ?? [],
    failDeletes: init.failDeletes ?? false,
  };
}

export function createMemoryStore(state: MemoryState): RetentionStore {
  return {
    async listTemplatesByAccount(accountId): Promise<TemplateLike[]> {
      return state.templates.filter((t) => t.accountId === accountId);
    },

    async hasActiveSession(accountId): Promise<boolean> {
      return state.activeAccounts.has(accountId);
    },

    async deleteTemplatesByIds(ids): Promise<number> {
      if (state.failDeletes) {
        throw new Error("simulated delete failure");
      }
      const idSet = new Set(ids);
      const before = state.templates.length;
      state.templates = state.templates.filter((t) => !idSet.has(t.id));
      return before - state.templates.length;
    },

    async setExpireAtForAccount(accountId, expireAt): Promise<number> {
      let count = 0;
      for (const t of state.templates) {
        if (t.accountId === accountId) {
          t.expireAt = expireAt;
          count += 1;
        }
      }
      return count;
    },

    async listExpired(now): Promise<TemplateLike[]> {
      return state.templates
        .filter((t) => t.expireAt !== null && t.expireAt.getTime() <= now.getTime())
        .sort((a, b) => (a.expireAt?.getTime() ?? 0) - (b.expireAt?.getTime() ?? 0));
    },

    async appendAudit(entry): Promise<void> {
      state.audits.push({ ...entry, detail: sanitizeDetail(entry.detail ?? {}) });
    },
  };
}
