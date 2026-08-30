// Feature: face-auth-onsen-entry, Property 12: 削除後の照合不成立
// Validates: Requirements 10.4, 10.7
// For any account whose templates are synchronously deleted, identifying with
// the very vector used for that account no longer matches it. Deletion is
// modeled as removal of the account's templates from the identification
// population (which is exactly what deleteTemplatesForAccount does in the DB).
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { identify, type Candidate } from "@/lib/auth/identify";
import { VECTOR_DIM, type FaceVector } from "@/types/vector";

const finiteFloat = fc.float({ noNaN: true, noDefaultInfinity: true, min: -5, max: 5 });
const vectorArb = (): fc.Arbitrary<FaceVector> =>
  fc.array(finiteFloat, { minLength: VECTOR_DIM, maxLength: VECTOR_DIM });

describe("Property 12: no match after synchronous deletion", () => {
  it("the deleted account is never returned for its own enrolled vector", () => {
    fc.assert(
      fc.property(
        vectorArb(),
        fc.array(vectorArb(), { minLength: 0, maxLength: 10 }),
        (targetVector, otherVectors) => {
          const targetId = "target-account";

          // Population BEFORE deletion: target enrolled with its exact vector.
          const before: Candidate[] = [
            { accountId: targetId, templates: [targetVector] },
            ...otherVectors.map((v, i) => ({
              accountId: `other-${i}`,
              templates: [v],
            })),
          ];
          // Sanity: before deletion, probing with the exact vector matches target
          // (distance 0 < threshold) unless another account is also within
          // threshold (then ambiguous) — either way target is a candidate.
          const beforeOutcome = identify(targetVector, "entry", before);
          expect(["matched", "ambiguous"]).toContain(beforeOutcome.result);

          // AFTER synchronous deletion: target's templates removed from population.
          const after: Candidate[] = before.filter((c) => c.accountId !== targetId);
          const afterOutcome = identify(targetVector, "entry", after);

          // The deleted account can never be the matched result (要件10.4, 10.7).
          expect(afterOutcome.accountId).not.toBe(targetId);
        },
      ),
      { numRuns: 100 },
    );
  });
});
