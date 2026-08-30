// Feature: face-auth-onsen-entry, Property 7: 永続化形式のラウンドトリップ逆方向
// Validates: Requirements 13.4
// For any valid persisted form (1..65536 bytes, decodable), decode -> encode
// yields the identical byte string.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { encodeTemplate } from "./encode";
import { decodeTemplate } from "./decode";
import { VECTOR_DIM } from "@/types/vector";

const finiteFloat = fc.float({ noNaN: true, noDefaultInfinity: true, min: -10, max: 10 });
const vectorArb = fc.array(finiteFloat, { minLength: VECTOR_DIM, maxLength: VECTOR_DIM });
const modelVersionArb = fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.length > 0);

describe("Property 7: codec roundtrip backward (decode->encode)", () => {
  it("reproduces the exact persisted byte string", () => {
    fc.assert(
      fc.property(vectorArb, modelVersionArb, (vector, modelVersion) => {
        // Build a valid persisted form via encode (canonical form).
        const encoded = encodeTemplate(vector, modelVersion);
        const { vector: v, modelVersion: mv } = decodeTemplate(encoded);
        const reencoded = encodeTemplate(v, mv);
        expect(reencoded).toBe(encoded);
      }),
      { numRuns: 100 },
    );
  });
});
