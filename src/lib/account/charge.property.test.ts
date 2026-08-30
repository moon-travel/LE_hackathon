// Feature: face-auth-onsen-entry, Property 3: 残高減算の原子性
// Validates: Requirements 5.2, 5.9
// For any balance and amount: on success exactly `amount` is deducted and exactly
// one transaction is recorded; on failure balance is unchanged and no tx added.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyDeduction, type PureState } from "./charge";
import { BALANCE_MAX } from "./balance";

const balanceArb = fc.integer({ min: 0, max: BALANCE_MAX });
const amountArb = fc.integer({ min: 1, max: 100000 });

describe("Property 3: atomic balance deduction", () => {
  it("success deducts exactly amount + 1 tx; failure leaves state untouched", () => {
    fc.assert(
      fc.property(balanceArb, amountArb, fc.string(), (balance, amount, terminal) => {
        const state: PureState = { balance, transactions: [] };
        const { next, outcome } = applyDeduction(state, {
          amount,
          terminal,
          idempotencyKey: `k-${balance}-${amount}`,
          at: new Date().toISOString(),
        });

        if (amount <= balance) {
          expect(outcome.result).toBe("paid");
          expect(next.balance).toBe(balance - amount);
          expect(next.transactions).toHaveLength(1);
          expect(next.transactions[0].amount).toBe(amount);
        } else {
          expect(outcome.result).toBe("insufficient");
          expect(next.balance).toBe(balance);
          expect(next.transactions).toHaveLength(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});
