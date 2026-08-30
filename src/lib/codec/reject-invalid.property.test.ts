// Feature: face-auth-onsen-entry, Property 9: 不正な永続化形式の拒否
// Validates: Requirements 13.6
// 不正な永続化形式（0バイト / 上限超過 / バージョン欠落 / 構造不適合）に対し、
// 復号は失敗しテンプレートを一切返さない。
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { decodeTemplate } from "./decode";
import { CodecError } from "./errors";
import { ENCODED_MAX_BYTES } from "@/types/codec";
import { VECTOR_DIM } from "@/types/vector";

const finiteFloat = fc.float({ noNaN: true, noDefaultInfinity: true, min: -10, max: 10 });
const validVector = () =>
  fc.array(finiteFloat, { minLength: VECTOR_DIM, maxLength: VECTOR_DIM });

// 不正な永続化形式のジェネレータ。永続化形式は { version, vector }（凍結契約）。
const emptyArb = fc.constant("");
const tooLargeArb = fc.constant(
  JSON.stringify({ version: "m", vector: new Array(VECTOR_DIM).fill(0) }) +
    " ".repeat(ENCODED_MAX_BYTES + 1),
);
// version キーそのものが欠落している（要件13-6）。
const missingVersionArb = validVector().map((vector) => JSON.stringify({ vector }));
// version が空文字列でも識別子として復元不能なので不正。
const emptyVersionArb = validVector().map((vector) =>
  JSON.stringify({ version: "", vector }),
);
const wrongDimArb = fc
  .integer({ min: 0, max: 300 })
  .filter((n) => n !== VECTOR_DIM)
  .map((n) => JSON.stringify({ version: "m", vector: new Array(n).fill(0) }));
const nonJsonArb = fc.string({ minLength: 1, maxLength: 50 }).filter((s) => {
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
  emptyVersionArb,
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
