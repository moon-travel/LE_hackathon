// Feature: face-auth-onsen-entry, Property 1: 同意項目の独立記録
// Validates: Requirements 1.4
// For all combinations of (enrollment, payment) consent, each value is stored
// exactly as given and neither influences the other.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { buildConsentRecord } from "./record";

describe("Property 1: independent recording of consent items", () => {
  it("preserves each consent value without cross-influence", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.string({ minLength: 1, maxLength: 10 }),
        (enrollment, payment, version) => {
          const rec = buildConsentRecord(enrollment, payment, version);
          // Each stored value equals its own input, regardless of the other.
          expect(rec.consentEnrollment).toBe(enrollment);
          expect(rec.consentPayment).toBe(payment);
          expect(rec.consentVersion).toBe(version);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("changing one input never changes the other's stored value", () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (enrollment, payment) => {
        const a = buildConsentRecord(enrollment, payment, "v1");
        const flippedPayment = buildConsentRecord(enrollment, !payment, "v1");
        const flippedEnroll = buildConsentRecord(!enrollment, payment, "v1");
        // Flipping payment leaves enrollment untouched, and vice versa.
        expect(flippedPayment.consentEnrollment).toBe(a.consentEnrollment);
        expect(flippedEnroll.consentPayment).toBe(a.consentPayment);
      }),
      { numRuns: 100 },
    );
  });
});
