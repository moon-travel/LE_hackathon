// 担当B所有: 依存境界のポート抽象化（判断1）。
// B の pay/pass は A の identify・C の audit を要するが、A/C は並行実装中で未完成。
// 直接 import せず、ここでポートを定義してハンドラ本体（純関数）へ引数注入する。
// Phase2 統合までスタブを既定注入する。型は src/types/api.ts（凍結）の契約に一致させる。
import type { IdentifyResponse } from "@/types/api";
import type { FaceVector } from "@/types/vector";
import type { Purpose } from "@/types/purpose";

/** Auth_Service（担当A /api/auth/identify）への依存を抽象化するポート。 */
export interface IdentifyPort {
  /** 1:N 識別を行い IdentifyResponse を返す。戻り値の型は凍結契約に一致。 */
  identify(vector: FaceVector, purpose: Purpose): Promise<IdentifyResponse>;
}

/** 監査ログ記録イベント（担当C src/lib/audit/ へ渡す最小契約）。ベクトル値は含めない（要件11-10）。 */
export interface AuditEvent {
  eventType: string;
  accountId?: string;
  detail?: Record<string, unknown>;
}

/** Audit（担当C src/lib/audit/log.ts）への依存を抽象化するポート。 */
export interface AuditPort {
  record(event: AuditEvent): Promise<void>;
}

// ---------------------------------------------------------------------------
// スタブ（統合まで既定注入 / テスト用）
// ---------------------------------------------------------------------------

/**
 * 固定応答を返す IdentifyPort スタブ。テスト・統合前の既定注入に用いる。
 */
export function createStubIdentifyPort(response: IdentifyResponse): IdentifyPort {
  return {
    async identify() {
      return response;
    },
  };
}

/**
 * 呼び出しを記録するだけの AuditPort スタブ。既定注入・テストに用いる。
 * 記録した events を検査できるよう配列を公開する。
 */
export function createStubAuditPort(): AuditPort & { events: AuditEvent[] } {
  const events: AuditEvent[] = [];
  return {
    events,
    async record(event: AuditEvent) {
      events.push(event);
    },
  };
}

/** 何もしない AuditPort（既定注入用の no-op）。 */
export const noopAuditPort: AuditPort = {
  async record() {
    /* no-op */
  },
};
