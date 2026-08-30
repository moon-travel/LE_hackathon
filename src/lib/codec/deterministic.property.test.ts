// Feature: face-auth-onsen-entry, Property 8: エンコードの決定性
// Validates: Requirements 13.5
// For any valid template, encoding it multiple times yields byte-identical output.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { encodeTemplate } from "./encode";
import { VECTOR_DIM } from "@/types/vector";

const finiteFloat = fc.float({ noNaN: true, noDefaultInfinity: true, min: -10, max: 10 });
const vectorArb = fc.array(finiteFloat, { minLength: VECTOR_DIM, maxLength: VECTOR_DIM });
const modelVersionArb = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.length > 0);

describe("Property 8: encode determinism", () => {
  it("produces identical bytes across repeated encodes", () => {
    fc.assert(
      fc.property(
        vectorArb,
        modelVersionArb,
        fc.integer({ min: 2, max: 5 }),
        (vector, modelVersion, times) => {
          const first = encodeTemplate(vector, modelVersion);
          for (let i = 1; i < times; i++) {
            expect(encodeTemplate(vector, modelVersion)).toBe(first);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
