// Feature: face-auth-onsen-entry, Property 4: 支払いの冪等性
// Validates: Requirements 5.6
// For any number of identical-key requests, net deduction is one and exactly one
// transaction is recorded; 2nd+ requests return the first result.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyDeduction, type PureState } from "./charge";
import { BALANCE_MAX } from "./balance";

const balanceArb = fc.integer({ min: 0, max: BALANCE_MAX });
const amountArb = fc.integer({ min: 1, max: BALANCE_MAX });
const repeatsArb = fc.integer({ min: 1, max: 6 });

describe("Property 4: payment idempotency", () => {
  it("repeated same-key requests net a single deduction and single tx", () => {
    fc.assert(
      fc.property(balanceArb, amountArb, repeatsArb, (balance, amount, repeats) => {
        // Only meaningful when the first payment can succeed.
        fc.pre(amount <= balance);

        const key = "same-key";
        const at = new Date().toISOString();
        let state: PureState = { balance, transactions: [] };
        const firstTxSnapshot = { balance: 0, txCount: 0 };

        for (let i = 0; i < repeats; i++) {
          const { next, outcome } = applyDeduction(state, {
            amount,
            terminal: "t",
            idempotencyKey: key,
            at,
          });
          state = next;
          if (i === 0) {
            expect(outcome.result).toBe("paid");
            firstTxSnapshot.balance = outcome.result === "paid" ? outcome.balance : -1;
            firstTxSnapshot.txCount = state.transactions.length;
          } else {
            // Replay: returns the first result, no new deduction.
            expect(outcome.result).toBe("paid");
            if (outcome.result === "paid") expect(outcome.replayed).toBe(true);
          }
        }

        // Net effect: exactly one deduction, exactly one transaction.
        expect(state.balance).toBe(balance - amount);
        expect(state.transactions).toHaveLength(1);
        expect(state.transactions[0].idempotencyKey).toBe(key);
      }),
      { numRuns: 100 },
    );
  });
});
