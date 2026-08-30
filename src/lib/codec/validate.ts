// 担当C — Template_Codec validation. Requirements 13.4, 13.6, 13.7.
// Rejects: 0 bytes / >65536 bytes / missing version / structurally malformed.
// Never includes vector values or raw data in the error (要件13.7).
import {
  MIN_ENCODED_BYTES,
  MAX_ENCODED_BYTES,
  ENVELOPE_VERSION,
  CodecError,
  type EncodedTemplate,
} from "@/types/codec";
import { isValidFaceVector } from "@/types/vector";

const utf8 = new TextEncoder();

/** Byte length of a UTF-8 encoded string. */
export function byteLength(data: string): number {
  return utf8.encode(data).length;
}

/**
 * Validate persisted-form data and return the parsed envelope, or throw a
 * CodecError. Enforces byte bounds first, then structure (要件13.6).
 */
export function validateEncoded(data: string): EncodedTemplate {
  const bytes = byteLength(data);
  if (bytes < MIN_ENCODED_BYTES) throw new CodecError("empty");
  if (bytes > MAX_ENCODED_BYTES) throw new CodecError("too_large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new CodecError("malformed");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CodecError("malformed");
  }

  const obj = parsed as Record<string, unknown>;

  // Envelope version + model version must be present (要件13.6 バージョン欠落).
  if (typeof obj.v !== "number" || obj.v !== ENVELOPE_VERSION) {
    throw new CodecError("missing_version");
  }
  if (typeof obj.modelVersion !== "string" || obj.modelVersion.length === 0) {
    throw new CodecError("missing_version");
  }
  if (!isValidFaceVector(obj.vector)) {
    throw new CodecError("malformed");
  }

  return { v: obj.v, modelVersion: obj.modelVersion, vector: obj.vector };
}
