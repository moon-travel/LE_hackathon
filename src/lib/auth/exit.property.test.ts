// Feature: face-auth-onsen-entry, Property 11: 退場によるセッション遷移
// Validates: Requirements 8.1
// For any ACTIVE session, applying exit yields CLOSED with the exit time recorded,
// and the retention expiry equals exitTime + retentionDays.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { applyExitTransition } from "./sessionTransition";
import { computeExpireAt } from "./exit";

// A minimal session shape for the transition function.
const sessionArb = fc.record({
  id: fc.uuid(),
  accountId: fc.uuid(),
  state: fc.constant("ACTIVE" as const),
  enteredAt: fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
});

const exitTimeArb = fc.date({ min: new Date("2020-01-01"), max: new Date("2030-06-01") });
const retentionArb = fc.integer({ min: 1, max: 90 });

describe("Property 11: exit transitions ACTIVE -> CLOSED", () => {
  it("sets CLOSED, records exit time, and computes expireAt = exit + retentionDays", () => {
    fc.assert(
      fc.property(sessionArb, exitTimeArb, retentionArb, (session, exitedAt, retentionDays) => {
        const next = applyExitTransition(session, exitedAt);
        expect(next.state).toBe("CLOSED");
        expect(next.exitedAt.getTime()).toBe(exitedAt.getTime());

        const expireAt = computeExpireAt(exitedAt, retentionDays);
        const expected = new Date(exitedAt);
        expected.setDate(expected.getDate() + retentionDays);
        expect(expireAt.getTime()).toBe(expected.getTime());
        // Expiry is strictly after exit for positive retention.
        expect(expireAt.getTime()).toBeGreaterThan(exitedAt.getTime());
      }),
      { numRuns: 100 },
    );
  });
});
