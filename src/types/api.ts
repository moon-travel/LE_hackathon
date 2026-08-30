// 【凍結対象】共有型: 全 API のリクエスト/レスポンス型契約。
// design.md「Components and Interfaces」に厳密対応。A/B/C はこの契約経由でのみ結合する。
// この型は凍結後、原則変更禁止。変更はフェーズ0担当に一元依頼すること。

import type { FaceVector } from "./vector";
import type { Purpose } from "./purpose";
import type { SessionState } from "./session";

// ============================================================================
// 共通
// ============================================================================

/** API 共通のエラー応答。 */
export interface ApiError {
  error: string;
  /** 目的外利用など拒否事由の区分（任意）。 */
  reason?: string;
}

/** 1:N 識別の判定結果。閾値未満件数に対応（要件3-6/3-7/5-5/5-7）。 */
export type IdentifyResult = "matched" | "none" | "ambiguous";

// ============================================================================
// Auth_Service — POST /api/auth/identify （担当A）
// ============================================================================

export interface IdentifyRequest {
  vector: FaceVector;
  purpose: Purpose;
}

export interface IdentifyResponse {
  result: IdentifyResult;
  /** result==="matched" のときのみ設定。 */
  accountId?: string;
  /** 採用された最小距離ベースのスコア（任意）。 */
  score?: number;
}

// ============================================================================
// Enroll — POST /api/enroll （担当C）
// ============================================================================

export interface EnrollRequest {
  /** ブラウザ内 face-api.js で算出した 128 次元ベクトル（元画像は送らない、要件1-7/11-4）。 */
  vector: FaceVector;
  modelVersion: string;
  /** 顔登録同意（要件1-4）。 */
  consentEnrollment: boolean;
  /** 顔決済利用同意（要件1-4）。 */
  consentPayment: boolean;
  /** 同意画面バージョン識別子（要件1-2）。 */
  consentVersion: string;
  /** 顧客指定保管期間 1〜90 日（任意、要件10-2）。 */
  retentionDays?: number;
  /** 再登録時の既存アカウント（本人確認後、要件9-1/9-2）。 */
  accountId?: string;
}

export interface EnrollResponse {
  accountId: string;
  templateId: string;
  /** 保管中テンプレート件数（最大5件、要件9-3）。 */
  templateCount: number;
}

// ============================================================================
// Session_Service — POST /api/entry （担当A）
// ============================================================================

export interface EntryRequest {
  vector: FaceVector;
  purpose: Purpose; // "entry"
}

export interface EntryResponse {
  /** 入場を許可しゲート開放するか。 */
  admitted: boolean;
  /** 生成または維持された滞在セッション識別子（許可時）。 */
  sessionId?: string;
  accountId?: string;
  sessionState?: SessionState;
  /** 不許可時の理由区分（none / ambiguous / no_pass / timeout など）。 */
  reason?: string;
}

// ============================================================================
// Session_Service — POST /api/exit （担当A）
// ============================================================================

export interface ExitRequest {
  vector: FaceVector;
  purpose: Purpose; // "entry"（退場ゲートも顔照合）
}

export interface ExitResponse {
  /** ゲート開放するか。 */
  released: boolean;
  sessionId?: string;
  accountId?: string;
  /** 退場後のセッション状態（通常 "CLOSED"）。 */
  sessionState?: SessionState;
  /** 退場時刻（ISO文字列）。 */
  exitedAt?: string;
  reason?: string;
}

// ============================================================================
// Account_Service — POST /api/pay （担当B）
// ============================================================================

export interface PayRequest {
  vector: FaceVector;
  purpose: Purpose; // "payment"
  /** 支払い金額 1〜100000 円（要件5-1）。 */
  amount: number;
  /** 設置窓口識別子。冪等キーの一部（要件5-6）。 */
  terminal: string;
  /** 冪等キー算出用（同一セッション対象、要件5-6）。 */
  sessionId?: string;
}

export interface PayResponse {
  /** 支払い成立か。 */
  paid: boolean;
  accountId?: string;
  /** 減算後残高。 */
  balance?: number;
  /** 取引識別子。 */
  transactionId?: string;
  /** 不成立の理由（none / ambiguous / insufficient / declined など）。 */
  reason?: string;
  /** 残高不足時のチャージ選択肢（要件6-1）。 */
  chargeOptions?: number[];
}

// ============================================================================
// Account_Service — POST /api/account （担当B）
// ============================================================================

/** 操作種別: 生成 / チャージ / カードトークン保存 / 払い出し。 */
export type AccountAction = "create" | "charge" | "registerCard" | "withdraw";

export interface AccountRequest {
  action: AccountAction;
  accountId?: string;
  /** charge / withdraw の金額。 */
  amount?: number;
  /** registerCard のトークン（決済事業者発行）。 */
  cardToken?: string;
  /** withdraw の方法（"card" | "cash"）。 */
  withdrawMethod?: "card" | "cash";
}

export interface AccountResponse {
  accountId: string;
  balance: number;
  hasCard: boolean;
  /** 削除保留などの状態メッセージ（任意）。 */
  message?: string;
}

// ============================================================================
// Account_Service — POST /api/pass （担当B）
// ============================================================================

/** 操作種別: 発行 / 検証。 */
export type PassAction = "issue" | "verify";

export interface PassRequest {
  action: PassAction;
  accountId: string;
}

export interface PassResponse {
  /** 有効な利用権が存在するか（verify）。 */
  valid: boolean;
  passId?: string;
  /** 有効期間終了時刻（ISO文字列）。 */
  expiresAt?: string;
  /** 既存有効利用権があり新規発行しなかった場合 true（要件7-7）。 */
  alreadyExists?: boolean;
}

// ============================================================================
// Consent_Service — POST /api/consent （担当C）
// ============================================================================

/** 操作種別: 記録 / 撤回。 */
export type ConsentAction = "record" | "revoke";

export interface ConsentRequest {
  action: ConsentAction;
  accountId: string;
  /** record 時: 顔登録同意（要件1-4）。 */
  consentEnrollment?: boolean;
  /** record 時: 顔決済利用同意（要件1-4）。 */
  consentPayment?: boolean;
  /** record 時: 同意画面バージョン識別子。 */
  consentVersion?: string;
}

export interface ConsentResponse {
  accountId: string;
  consentEnrollment: boolean;
  consentPayment: boolean;
  /** 同意/撤回日時（ISO文字列、秒単位）。 */
  consentTs?: string;
  /** 撤回に伴いテンプレートを同期削除したか（要件1-12/10-7）。 */
  templatesDeleted?: boolean;
}

// ============================================================================
// Admin_Console — GET/POST /api/admin （担当C）
// ============================================================================

/** ACTIVE セッションの一覧項目。 */
export interface AdminSessionItem {
  sessionId: string;
  accountId: string;
  enteredAt: string;
  /** 通過履歴（最新20件、要件14-2）。 */
  passHistory: unknown[];
  balance: number;
  /** 有効な利用権の有無。 */
  hasValidPass: boolean;
}

/** 監査ログの一覧項目。 */
export interface AdminAuditItem {
  id: string;
  ts: string;
  eventType: string;
  accountId?: string;
  detail: unknown;
}

export interface AdminGetResponse {
  /** ACTIVE セッション件数（要件14-1）。 */
  activeCount: number;
  /** 識別対象母集団上限（500）。 */
  capacity: number;
  sessions: AdminSessionItem[];
  /** 監査ログ降順・最大1000件（要件14-3）。 */
  auditLogs: AdminAuditItem[];
  /** 上限90%接近警告（要件14-6）。 */
  nearCapacityWarning: boolean;
  /** 上限到達警告（要件14-7）。 */
  atCapacityWarning: boolean;
}

/** 管理操作種別: セッション強制クローズ / 削除走査の手動発火 等。 */
export type AdminAction = "forceClose" | "runRetentionScan";

export interface AdminActionRequest {
  action: AdminAction;
  /** forceClose 対象セッション。 */
  sessionId?: string;
  /** 操作者識別子（監査記録、要件14-5）。 */
  operatorId: string;
}

export interface AdminActionResponse {
  ok: boolean;
  /** 遷移後のセッション状態（forceClose 時）。 */
  sessionState?: SessionState;
  /** 走査で削除したテンプレート件数（runRetentionScan 時）。 */
  deletedCount?: number;
}
