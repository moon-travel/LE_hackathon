// 監査ログ追記アダプタ（担当A用）。
// _Requirements: 9.6, 9.10, 10.6, 11.10, 14.4_
//
// 【暫定実装】tasks.md タスク22 で担当Cが `src/lib/audit/log.ts` を用意し A/B/C が共通利用する
// 設計になっているが、まだ存在しないため担当A側にアダプタを置いて実装をブロックしないようにする。
// C の実装が入ったら本ファイルの中身を C への委譲に差し替える（呼び出し側は無変更で済む）。
//
// 制約:
//   - 追記のみ。update / delete の経路をこのモジュールから一切提供しない（要件14-4）
//   - 顔特徴量ベクトルの値を detail に含めない（要件11-10 / 14-4）

import { ulid } from "ulid";
import { prisma } from "@/lib/db";
import { VECTOR_DIM } from "@/types/vector";

/** 監査事象の種別。担当Aが記録するもののみ定義する。 */
export const AuditEvent = {
  /** 認証失敗（要件9-6）。 */
  AUTH_FAILED: "AUTH_FAILED",
  /** 目的外の照合要求を拒否（要件11-2 / 11-3 / 11-10）。 */
  PURPOSE_REJECTED: "PURPOSE_REJECTED",
  /** テンプレートへのアクセス要求（要件11-10）。 */
  TEMPLATE_ACCESS: "TEMPLATE_ACCESS",
  /** 対応バージョン外のテンプレートを母集団から除外（要件9-10）。 */
  UNSUPPORTED_MODEL_VERSION: "UNSUPPORTED_MODEL_VERSION",
  /** ACTIVE セッションのない退場（セッション不整合、要件8-4）。 */
  SESSION_INCONSISTENCY: "SESSION_INCONSISTENCY",
  /** 退場ゲートで識別できなかった（要件8-5）。 */
  EXIT_UNIDENTIFIED: "EXIT_UNIDENTIFIED",
  /** テンプレート削除（要件10-6）。 */
  TEMPLATE_DELETED: "TEMPLATE_DELETED",
  /** テンプレート削除の失敗（要件10-10）。 */
  TEMPLATE_DELETE_FAILED: "TEMPLATE_DELETE_FAILED",
  /**
   * 入浴券の発行。AuditLog を追記専用の入場権台帳として使う（設計は
   * docs/design/A-auth-session-retention.md 4章）。凍結スキーマに入浴券テーブルがないため。
   */
  BATH_TICKET_ISSUED: "BATH_TICKET_ISSUED",
} as const;

export type AuditEventType = (typeof AuditEvent)[keyof typeof AuditEvent];

export interface AuditEntry {
  eventType: AuditEventType;
  accountId?: string | null;
  detail?: Record<string, unknown>;
  /** 記録時刻。省略時は現在時刻。 */
  ts?: Date;
}

/**
 * detail から顔特徴量ベクトルらしき値を除去する（要件11-10 / 14-4）。
 * キー名が vector 系のもの、および長さ VECTOR_DIM の数値配列を落とす。
 * バグで監査ログにベクトルが漏れることを構造的に防ぐための保険。
 */
export function sanitizeDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    const looksLikeVectorKey = /vector|descriptor|embedding/i.test(key);
    const looksLikeVectorValue =
      Array.isArray(value) &&
      value.length === VECTOR_DIM &&
      value.every((x) => typeof x === "number");
    if (looksLikeVectorKey || looksLikeVectorValue) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** 監査ログへ1件追記する。PutItem 相当のみで、更新・削除の経路は提供しない（要件14-4）。 */
export async function appendAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      id: ulid(),
      ts: entry.ts ?? new Date(),
      eventType: entry.eventType,
      accountId: entry.accountId ?? null,
      detail: JSON.stringify(sanitizeDetail(entry.detail ?? {})),
    },
  });
}
