// Feature: face-auth-onsen-entry, Property 2: 1:N識別の件数判定整合
// Validates: Requirements 3.4, 3.6, 3.7, 5.5, 5.7
// For any population and probe, the verdict (none/matched/ambiguous) corresponds
// exactly to the count of accounts whose score is below the threshold.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { identify, type Candidate } from "./identify";
import { euclideanDistance } from "./distance";
import { SCORE_THRESHOLD, VECTOR_DIM, type FaceVector } from "@/types/vector";

const finiteFloat = fc.float({ noNaN: true, noDefaultInfinity: true, min: -5, max: 5 });
const vectorArb = (): fc.Arbitrary<FaceVector> =>
  fc.array(finiteFloat, { minLength: VECTOR_DIM, maxLength: VECTOR_DIM });

const candidateArb = (): fc.Arbitrary<Candidate> =>
  fc.record({
    accountId: fc.uuid(),
    templates: fc.array(vectorArb(), { minLength: 1, maxLength: 5 }),
  });

describe("Property 2: 1:N identification count/verdict consistency", () => {
  it("verdict matches the below-threshold account count", () => {
    fc.assert(
      fc.property(
        vectorArb(),
        fc.array(candidateArb(), { minLength: 0, maxLength: 20 }),
        (probe, population) => {
          // Ensure unique account ids so counts are unambiguous.
          const seen = new Set<string>();
          const uniquePop = population.filter((c) => {
            if (seen.has(c.accountId)) return false;
            seen.add(c.accountId);
            return true;
          });

          // Independently compute how many accounts fall below threshold.
          const belowCount = uniquePop.filter((c) => {
            const best = Math.min(
              ...c.templates.map((t) => euclideanDistance(probe, t)),
            );
            return best < SCORE_THRESHOLD;
          }).length;

          const outcome = identify(probe, "entry", uniquePop);

          if (belowCount === 0) {
            expect(outcome.result).toBe("none");
            expect(outcome.accountId).toBeUndefined();
          } else if (belowCount === 1) {
            expect(outcome.result).toBe("matched");
            expect(outcome.accountId).toBeDefined();
            expect(outcome.score).toBeLessThan(SCORE_THRESHOLD);
          } else {
            expect(outcome.result).toBe("ambiguous");
            expect(outcome.accountId).toBeUndefined();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
