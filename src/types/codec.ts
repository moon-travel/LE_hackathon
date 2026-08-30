// Template_Codec persisted-form types (frozen after Phase 0). Requirements 13.2, 13.4, 13.6, 13.8.

import type { FaceVector, ModelVersion } from "./vector";

/**
 * The persisted form of a face template. Encoded to a UTF-8 JSON string whose
 * byte length must be within [1, 65536] (要件13.4, 13.6).
 */
export interface EncodedTemplate {
  /** Format version of the persisted envelope itself (distinct from modelVersion). */
  v: number;
  /** Feature-model version identifier, restorable on decode (要件13.8). */
  modelVersion: ModelVersion;
  /** The 128-dim vector. */
  vector: FaceVector;
}

/** Lower/upper byte-length bounds for a valid persisted form (要件13.4, 13.6). */
export const MIN_ENCODED_BYTES = 1;
export const MAX_ENCODED_BYTES = 65536;

/** Current envelope format version. */
export const ENVELOPE_VERSION = 1;

/** Result of a decode operation (要件13.2). */
export interface DecodeResult {
  vector: FaceVector;
  modelVersion: ModelVersion;
}

/** Error thrown/returned on invalid persisted form. Carries no vector data (要件13.7). */
export class CodecError extends Error {
  constructor(
    public readonly reason:
      | "empty"
      | "too_large"
      | "missing_version"
      | "malformed"
      | "invalid_vector",
  ) {
    super(`codec error: ${reason}`);
    this.name = "CodecError";
  }
}
