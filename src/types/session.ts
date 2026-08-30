// Session state types (frozen after Phase 0).

/** 滞在セッションの状態。 */
export type SessionState = "ACTIVE" | "CLOSED" | "FORCE_CLOSED";

export const SESSION_STATES: readonly SessionState[] = [
  "ACTIVE",
  "CLOSED",
  "FORCE_CLOSED",
] as const;

/** A single gate crossing recorded in Session.passHistory (要件4.3). */
export interface PassEvent {
  ts: string; // ISO-8601, second precision
  gate: "entry" | "exit";
  manual?: boolean; // 係員手動開放 (要件3.12)
}

/** A single transaction recorded in Session.transactions (要件5.2). */
export interface SessionTransaction {
  ts: string; // ISO-8601
  amount: number; // 円
  terminal: string; // 設置窓口
  idempotencyKey: string;
  kind?: "payment" | "refund" | "charge";
}
