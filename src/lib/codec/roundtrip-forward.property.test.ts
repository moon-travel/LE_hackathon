// Feature: face-auth-onsen-entry, Property 6: テンプレート符号化のラウンドトリップ順方向
// Validates: Requirements 13.3
// For any valid 128-dim template, encode -> decode returns identical values + modelVersion.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { encodeTemplate } from "./encode";
import { decodeTemplate } from "./decode";
import { VECTOR_DIM } from "@/types/vector";

const finiteFloat = fc.float({ noNaN: true, noDefaultInfinity: true, min: -10, max: 10 });
const vectorArb = fc.array(finiteFloat, { minLength: VECTOR_DIM, maxLength: VECTOR_DIM });
const modelVersionArb = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.length > 0);

describe("Property 6: codec roundtrip forward (encode->decode)", () => {
  it("preserves every element and the model version with no error", () => {
    fc.assert(
      fc.property(vectorArb, modelVersionArb, (vector, modelVersion) => {
        const encoded = encodeTemplate(vector, modelVersion);
        const decoded = decodeTemplate(encoded);
        expect(decoded.modelVersion).toBe(modelVersion);
        // Compare by numeric value (canonicalizing -0 to 0). -0 and 0 are
        // numerically identical; the codec stores a canonical +0 (要件13.3).
        const canonical = vector.map((x) => (Object.is(x, -0) ? 0 : x));
        expect(decoded.vector).toEqual(canonical);
      }),
      { numRuns: 100 },
    );
  });
});
