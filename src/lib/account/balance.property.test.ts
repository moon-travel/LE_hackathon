// Feature: face-auth-onsen-entry, Property 5: 残高の範囲不変
// Validates: Requirements 6.5
// For any sequence of operations, balance stays within [0, 50000], and an
// over-balance payment neither deducts nor advances (no negative, no overdraft).
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyDeduction, creditBalance, type PureState } from "./charge";
import { BALANCE_MAX, BALANCE_MIN, chargeFits } from "./balance";

// A pure credit that respects the cap (mirrors the route's cap check + creditBalance).
function pureCredit(balance: number, amount: number): number {
  const { ok } = chargeFits(balance, amount);
  return ok ? balance + amount : balance;
}

type Op = { kind: "pay"; amount: number } | { kind: "charge"; amount: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("pay" as const), amount: fc.integer({ min: 1, max: 60000 }) }),
  fc.record({ kind: fc.constant("charge" as const), amount: fc.integer({ min: 1, max: 60000 }) }),
);

describe("Property 5: balance range invariant", () => {
  it("balance always within [0, 50000]; overdraft never occurs", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: BALANCE_MAX }),
        fc.array(opArb, { minLength: 0, maxLength: 30 }),
        (start, ops) => {
          let state: PureState = { balance: start, transactions: [] };
          let keySeq = 0;

          for (const op of ops) {
            if (op.kind === "charge") {
              state = { ...state, balance: pureCredit(state.balance, op.amount) };
            } else {
              const before = state.balance;
              const { next, outcome } = applyDeduction(state, {
                amount: op.amount,
                terminal: "t",
                idempotencyKey: `k${keySeq++}`,
                at: new Date().toISOString(),
              });
              state = next;
              if (outcome.result === "insufficient") {
                // Over-balance payment: no deduction, no overdraft (要件6.5).
                expect(state.balance).toBe(before);
              }
            }
            expect(state.balance).toBeGreaterThanOrEqual(BALANCE_MIN);
            expect(state.balance).toBeLessThanOrEqual(BALANCE_MAX);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Keep creditBalance import meaningful for type-checking parity with the DB path.
void creditBalance;
