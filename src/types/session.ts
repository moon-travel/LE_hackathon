// 【凍結対象】共有型: 滞在セッションの状態。
// Prisma Session.state（String列）の許容値と一致させる。

export type SessionState = "ACTIVE" | "CLOSED" | "FORCE_CLOSED";

export const SESSION_STATES: readonly SessionState[] = [
  "ACTIVE",
  "CLOSED",
  "FORCE_CLOSED",
] as const;

export function isSessionState(value: unknown): value is SessionState {
  return typeof value === "string" && (SESSION_STATES as readonly string[]).includes(value);
}
