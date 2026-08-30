// API request/response contracts (frozen after Phase 0).
// Maps to design.md "Components and Interfaces". All terminal UIs and API routes
// integrate through these types only.

import type { FaceVector } from "./vector";
import type { Purpose } from "./purpose";
import type { SessionState } from "./session";

// ── Auth_Service: POST /api/auth/identify ─────────────────────────────
export interface IdentifyRequest {
  vector: FaceVector; // number[128]
  purpose: Purpose;
}

export type IdentifyResult = "matched" | "none" | "ambiguous";

export interface IdentifyResponse {
  result: IdentifyResult;
  accountId?: string; // present only when result === "matched"
  score?: number; // euclidean distance of the matched account (smaller = closer)
}

// ── Session_Service: POST /api/entry ──────────────────────────────────
export interface EntryRequest {
  vector: FaceVector;
  purpose: "entry";
  manualAccountId?: string; // 係員手動開放 (要件3.12)
}

export type EntryResult =
  | "entered" // new ACTIVE session created
  | "reentered" // existing ACTIVE session kept, gate opened (要件3.9, 4.2)
  | "no_pass" // identified but no valid bathing ticket (要件3.8)
  | "auth_failed" // none matched (要件3.6)
  | "ambiguous" // 2+ matched (要件3.7)
  | "timeout"; // identify exceeded 2s (要件3.11)

export interface EntryResponse {
  result: EntryResult;
  accountId?: string;
  sessionId?: string;
  gateOpen: boolean;
}

// ── Session_Service: POST /api/exit ───────────────────────────────────
export interface ExitRequest {
  vector: FaceVector;
  purpose: "entry"; // exit gate reuses entry-purpose identification
  manualAccountId?: string;
}

export type ExitResult =
  | "exited" // ACTIVE -> CLOSED, exit time recorded, expireAt set (要件8.1, 8.2)
  | "no_active_session" // opened, inconsistency logged (要件8.4)
  | "auth_failed"; // could not identify (要件8.5)

export interface ExitResponse {
  result: ExitResult;
  accountId?: string;
  sessionId?: string;
  gateOpen: boolean;
  balance?: number; // shown at exit gate (要件8.3)
}

// ── Account_Service: POST /api/pay ────────────────────────────────────
export interface PayRequest {
  vector: FaceVector;
  purpose: "payment";
  amount: number; // 1..100000 円 (要件5.1)
  terminal: string; // 設置窓口
  sessionId?: string; // idempotency scope (要件5.6)
}

export type PayResult =
  | "paid"
  | "insufficient" // balance < amount -> charge flow (要件5.8, 6.1)
  | "auth_failed" // none (要件5.5)
  | "ambiguous" // 2+ (要件5.7)
  | "failed"; // transaction rollback (要件5.9)

export interface PayResponse {
  result: PayResult;
  accountId?: string;
  balance?: number; // post-deduction balance (要件5.3)
  amount?: number;
  shortfall?: number; // when insufficient (要件6.1)
}

// ── Account_Service: POST /api/account ────────────────────────────────
export type AccountAction =
  | "create"
  | "charge"
  | "registerCard"
  | "payout"
  | "setAutoCharge"
  | "get";

export interface AccountRequest {
  action: AccountAction;
  accountId?: string;
  amount?: number; // charge / payout amount
  cardToken?: string; // for registerCard mock result
  autoChargeEnabled?: boolean;
  autoChargeAmount?: number;
  payoutMethod?: "card" | "cash";
  retentionDays?: number; // 顧客指定保管期間 1..90 (要件10.2)
}

export interface AccountResponse {
  ok: boolean;
  accountId?: string;
  balance?: number;
  cardRegistered?: boolean;
  message?: string;
  error?: string;
}

// ── Account_Service: POST /api/pass ───────────────────────────────────
export type PassAction = "issue" | "verify";

export interface PassRequest {
  action: PassAction;
  accountId?: string; // for issue
  vector?: FaceVector; // for verify (via identify)
  purpose?: "pass";
}

export interface PassResponse {
  ok: boolean;
  valid?: boolean; // verify result (要件7.2)
  passId?: string;
  expiresAt?: string;
  alreadyExists?: boolean; // 既存有効利用権あり (要件7.7)
  error?: string;
}

// ── Consent_Service: POST /api/consent ────────────────────────────────
export type ConsentAction = "record" | "revoke";

export interface ConsentRequest {
  action: ConsentAction;
  accountId?: string; // revoke / update existing
  consentEnrollment: boolean; // 顔登録への同意 (要件1.4)
  consentPayment: boolean; // 顔決済利用への同意 (要件1.4)
  consentVersion?: string; // 同意画面バージョン (要件1.2)
}

export interface ConsentResponse {
  ok: boolean;
  accountId?: string;
  consentEnrollment?: boolean;
  consentPayment?: boolean;
  consentTs?: string;
  deletedTemplates?: number; // on revoke (要件1.12, 10.7)
  error?: string;
}

// ── Enrollment: POST /api/enroll ──────────────────────────────────────
export interface EnrollRequest {
  vector: FaceVector; // browser-computed; raw image never sent (要件1.7, 11.4)
  accountId?: string; // present for re-enrollment (追加登録, 要件9.2)
  consentEnrollment: boolean;
  consentPayment: boolean;
  consentVersion?: string;
  retentionDays?: number; // 顧客指定保管期間 (要件10.2)
}

export interface EnrollResponse {
  ok: boolean;
  accountId?: string;
  templateId?: string;
  templateCount?: number; // <= 5 (要件9.3)
  evictedOldest?: boolean; // 6件目で最古削除 (要件9.4)
  balance?: number;
  error?: string;
}

// ── Admin_Console: GET/POST /api/admin ────────────────────────────────
export interface ActiveSessionView {
  sessionId: string;
  accountId: string;
  enteredAt: string;
  passHistory: { ts: string; gate: "entry" | "exit" }[]; // latest 20 (要件14.2)
  balance: number;
  hasValidPass: boolean;
}

export interface AuditLogView {
  id: string;
  ts: string;
  eventType: string;
  accountId?: string;
  detail: Record<string, unknown>; // never contains vector values (要件11.10, 14.4)
}

export interface AdminSnapshot {
  activeCount: number;
  populationCap: number;
  nearCapacity: boolean; // >= 90% (要件14.6)
  atCapacity: boolean; // == cap (要件14.7)
  activeSessions: ActiveSessionView[];
  auditLog: AuditLogView[]; // descending, <= 1000 (要件14.3)
}

export type AdminAction = "snapshot" | "forceClose" | "runRetentionScan";

export interface AdminRequest {
  action: AdminAction;
  sessionId?: string; // for forceClose
  operatorId?: string; // 操作者識別子 (要件14.5)
}

export interface AdminResponse {
  ok: boolean;
  snapshot?: AdminSnapshot;
  newState?: SessionState;
  deletedTemplates?: number; // retention scan result
  error?: string;
}
