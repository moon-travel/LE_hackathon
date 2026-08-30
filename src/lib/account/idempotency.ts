// 担当B — payment idempotency key. Requirements 5.6.
// A duplicate payment request is identified by (terminal, amount, sessionId,
// time-window). Requests within 60s that share the tuple collapse to one.
import type { SessionTransaction } from "@/types/session";

export const IDEMPOTENCY_WINDOW_MS = 60_000;

/**
 * Build an idempotency key. The time component is bucketed to the 60s window so
 * that two requests within the same window (and same terminal/amount/session)
 * produce the same key (要件5.6).
 */
export function buildIdempotencyKey(params: {
  terminal: string;
  amount: number;
  sessionId: string;
  at?: Date;
}): string {
  const at = params.at ?? new Date();
  const bucket = Math.floor(at.getTime() / IDEMPOTENCY_WINDOW_MS);
  return `${params.terminal}|${params.amount}|${params.sessionId}|${bucket}`;
}

/**
 * Find an existing transaction with the same idempotency key in a session's
 * transaction list. Returns it if present (the "first result" to replay, 要件5.6).
 */
export function findByIdempotencyKey(
  transactions: SessionTransaction[],
  key: string,
): SessionTransaction | undefined {
  return transactions.find((t) => t.idempotencyKey === key);
}
