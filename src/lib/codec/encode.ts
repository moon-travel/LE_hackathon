// 担当C — Template_Codec encode. Requirements 13.1, 13.3, 13.5, 13.8.
// Produces a deterministic UTF-8 JSON byte string of the persisted envelope.
import { ENVELOPE_VERSION, type EncodedTemplate, CodecError } from "@/types/codec";
import { isValidFaceVector, type FaceVector, type ModelVersion } from "@/types/vector";

/**
 * Encode a template to its persisted string form. Deterministic: the same
 * (vector, modelVersion) always yields byte-identical output because we build
 * the object with a fixed key order and stringify it with no whitespace,
 * preserving array order and full numeric precision (要件13.5).
 */
export function encodeTemplate(vector: FaceVector, modelVersion: ModelVersion): string {
  if (!isValidFaceVector(vector)) {
    throw new CodecError("invalid_vector");
  }
  // Normalize negative zero to positive zero so the JSON round-trip is exact.
  // JSON.stringify(-0) === "0", which would otherwise decode back to +0 and
  // break the strict roundtrip equality (要件13.3). -0 and +0 are numerically
  // identical, so this canonicalization loses no information.
  const canonical = vector.map((x) => (Object.is(x, -0) ? 0 : x));

  // Object literal key order is insertion order; JSON.stringify preserves it.
  const envelope: EncodedTemplate = {
    v: ENVELOPE_VERSION,
    modelVersion,
    vector: canonical,
  };
  return JSON.stringify(envelope);
}
