// Feature: face-auth-onsen-entry, Property 10: 利用権判定の冪等
// Validates: Requirements 7.3
// For any pass within its validity window, verifying any number of times at any
// instant before expiry always returns valid.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { isPassValid } from "./pass";

describe("Property 10: pass verification is idempotent within validity", () => {
  it("always valid at any instant before expiry, for any repeat count", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date("2020-01-01"), max: new Date("2030-01-01") }),
        fc.integer({ min: 1, max: 90 }), // days of validity ahead
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 1, maxLength: 10 }),
        (base, daysAhead, offsetsPct) => {
          const expiresAt = new Date(base);
          expiresAt.setDate(expiresAt.getDate() + daysAhead);
          const pass = { status: "VALID", expiresAt };

          const windowMs = expiresAt.getTime() - base.getTime();
          for (const pct of offsetsPct) {
            // Any instant strictly before expiry.
            const at = new Date(base.getTime() + Math.floor((windowMs * pct) / 100) - 1);
            if (at.getTime() >= expiresAt.getTime()) continue;
            expect(isPassValid(pass, at)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
