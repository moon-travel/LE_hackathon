// Feature: face-auth-onsen-entry, Property 5: 残高の範囲不変
// Validates: Requirements 6.5
//
// For any 操作列について、残高は常に0〜50000の範囲に収まり、超過支払い（残高不足）は
// 減算も立替もしない。
//
// 純ロジック（computeNewBalance）で検証（DB非依存）。判断2: 残高更新は applyDelta 一点に集約され、
// その範囲検証は computeNewBalance が担う。ここでモデルとして任意操作列を適用する。
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeNewBalance, BalanceRangeError } from "./balance";
import { BALANCE_MAX, BALANCE_MIN } from "./constants";

/** 操作: チャージ(+delta) または 支払い(-delta)。金額は整数円。 */
type Op = { kind: "charge" | "pay"; amount: number };

const opArb: fc.Arbitrary<Op> = fc.record({
  kind: fc.constantFrom<"charge" | "pay">("charge", "pay"),
  amount: fc.integer({ min: 1, max: 60_000 }),
});

describe("Property 5: 残高の範囲不変", () => {
  it("任意の操作列を適用しても残高は常に0〜50000に収まり、超過支払いは減算しない", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: BALANCE_MIN, max: BALANCE_MAX }),
        fc.array(opArb, { minLength: 0, maxLength: 50 }),
        (initial, ops) => {
          let balance = initial;
          for (const op of ops) {
            const delta = op.kind === "charge" ? op.amount : -op.amount;
            try {
              const next = computeNewBalance(balance, delta);
              // 適用できた場合、必ず範囲内
              expect(next).toBeGreaterThanOrEqual(BALANCE_MIN);
              expect(next).toBeLessThanOrEqual(BALANCE_MAX);
              // 支払いなら立替せず（減算後も0以上）、ちょうど amount 減算
              if (op.kind === "pay") {
                expect(next).toBe(balance - op.amount);
                expect(next).toBeGreaterThanOrEqual(0);
              }
              balance = next;
            } catch (e) {
              // 範囲外は拒否され残高不変（減算も立替もしない）
              expect(e).toBeInstanceOf(BalanceRangeError);
            }
            // どの分岐でも常に範囲内
            expect(balance).toBeGreaterThanOrEqual(BALANCE_MIN);
            expect(balance).toBeLessThanOrEqual(BALANCE_MAX);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("残高不足の支払いは拒否され残高が変わらない", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: BALANCE_MAX }),
        fc.integer({ min: 1, max: 60_000 }),
        (balance, amount) => {
          if (amount > balance) {
            expect(() => computeNewBalance(balance, -amount)).toThrow(
              BalanceRangeError,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
