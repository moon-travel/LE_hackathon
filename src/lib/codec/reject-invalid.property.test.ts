// Feature: face-auth-onsen-entry, Property 9: 不正な永続化形式の拒否
// Validates: Requirements 13.6
// For any invalid persisted form (0 bytes / >65536 bytes / missing version /
// structurally malformed), decode fails and returns no template.
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decodeTemplate } from "./decode";
import { CodecError, MAX_ENCODED_BYTES } from "@/types/codec";
import { VECTOR_DIM } from "@/types/vector";

const finiteFloat = fc.float({ noNaN: true, noDefaultInfinity: true, min: -10, max: 10 });
const validVector = () =>
  fc.array(finiteFloat, { minLength: VECTOR_DIM, maxLength: VECTOR_DIM });

// Generators of INVALID persisted forms.
const emptyArb = fc.constant("");

const tooLargeArb = fc.constant(
  JSON.stringify({ v: 1, modelVersion: "m", vector: new Array(VECTOR_DIM).fill(0) }) +
    " ".repeat(MAX_ENCODED_BYTES + 1),
);

const missingVersionArb = validVector().map((vector) =>
  JSON.stringify({ modelVersion: "m", vector }),
);

const wrongDimArb = fc
  .integer({ min: 0, max: 300 })
  .filter((n) => n !== VECTOR_DIM)
  .map((n) => JSON.stringify({ v: 1, modelVersion: "m", vector: new Array(n).fill(0) }));

const nonJsonArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => {
    try {
      JSON.parse(s);
      return false;
    } catch {
      return true;
    }
  });

const notObjectArb = fc.oneof(
  fc.constant("123"),
  fc.constant('"a string"'),
  fc.constant("[1,2,3]"),
  fc.constant("null"),
  fc.constant("true"),
);

const invalidArb = fc.oneof(
  emptyArb,
  tooLargeArb,
  missingVersionArb,
  wrongDimArb,
  nonJsonArb,
  notObjectArb,
);

describe("Property 9: reject invalid persisted forms", () => {
  it("throws CodecError and returns no template", () => {
    fc.assert(
      fc.property(invalidArb, (bad) => {
        let threw = false;
        let result: unknown;
        try {
          result = decodeTemplate(bad);
        } catch (e) {
          threw = true;
          expect(e).toBeInstanceOf(CodecError);
        }
        expect(threw).toBe(true);
        expect(result).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
