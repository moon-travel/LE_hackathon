// 担当B — atomic balance deduction with idempotency. Requirements 5.2, 5.6, 5.9, 6.5.
import { prisma } from "@/lib/db";
import type { SessionTransaction } from "@/types/session";
import { canDeduct } from "./balance";
import { buildIdempotencyKey, findByIdempotencyKey } from "./idempotency";

export type DeductOutcome =
  | { result: "paid"; balance: number; replayed: boolean; transaction: SessionTransaction }
  | { result: "insufficient"; balance: number }
  | { result: "failed"; balance: number };

// ── Pure reducer (property-tested) ───────────────────────────────────
export interface PureState {
  balance: number;
  transactions: SessionTransaction[];
}

/**
 * Pure deduction reducer capturing the atomicity + idempotency + range rules.
 * - Duplicate idempotency key -> replay first result, no new deduction (要件5.6).
 * - balance >= amount -> deduct exactly `amount`, append exactly one tx (要件5.2).
 * - balance < amount -> unchanged, no tx (要件5.9, 6.5).
 * This is what the DB transaction below performs atomically.
 */
export function applyDeduction(
  state: PureState,
  params: { amount: number; terminal: string; idempotencyKey: string; at: string },
): { next: PureState; outcome: DeductOutcome } {
  const existing = findByIdempotencyKey(state.transactions, params.idempotencyKey);
  if (existing) {
    return {
      next: state,
      outcome: { result: "paid", balance: state.balance, replayed: true, transaction: existing },
    };
  }

  if (!canDeduct(state.balance, params.amount)) {
    return { next: state, outcome: { result: "insufficient", balance: state.balance } };
  }

  const tx: SessionTransaction = {
    ts: params.at,
    amount: params.amount,
    terminal: params.terminal,
    idempotencyKey: params.idempotencyKey,
    kind: "payment",
  };
  const next: PureState = {
    balance: state.balance - params.amount,
    transactions: [...state.transactions, tx],
  };
  return { next, outcome: { result: "paid", balance: next.balance, replayed: false, transaction: tx } };
}

// ── DB path (atomic via $transaction) ────────────────────────────────

/**
 * Atomically deduct `amount` from an account's balance and append the
 * transaction to the session, honoring idempotency. All-or-nothing: on any
 * failure nothing changes (要件5.9).
 */
export async function deductBalance(params: {
  accountId: string;
  sessionId: string;
  amount: number;
  terminal: string;
  at?: Date;
}): Promise<DeductOutcome> {
  const at = params.at ?? new Date();
  const key = buildIdempotencyKey({
    terminal: params.terminal,
    amount: params.amount,
    sessionId: params.sessionId,
    at,
  });

  return prisma.$transaction(async (tx) => {
    const account = await tx.account.findUnique({ where: { id: params.accountId } });
    const session = await tx.session.findUnique({ where: { id: params.sessionId } });
    if (!account || !session) {
      return { result: "failed", balance: account?.balance ?? 0 };
    }

    const transactions: SessionTransaction[] = JSON.parse(session.transactions);
    const state: PureState = { balance: account.balance, transactions };
    const { next, outcome } = applyDeduction(state, {
      amount: params.amount,
      terminal: params.terminal,
      idempotencyKey: key,
      at: at.toISOString(),
    });

    if (outcome.result === "paid" && !outcome.replayed) {
      await tx.account.update({
        where: { id: params.accountId },
        data: { balance: next.balance },
      });
      await tx.session.update({
        where: { id: params.sessionId },
        data: { transactions: JSON.stringify(next.transactions) },
      });
    }
    return outcome;
  });
}

/**
 * Atomically add `amount` to balance (charge / auto-charge success path).
 * Clamped by the cap check at the call site; here we just apply it.
 */
export async function creditBalance(accountId: string, amount: number): Promise<number> {
  const updated = await prisma.account.update({
    where: { id: accountId },
    data: { balance: { increment: amount } },
    select: { balance: true },
  });
  return updated.balance;
}
