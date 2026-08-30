// Shared vector types (frozen after Phase 0). Requirements 13.2, 13.8.

/** face-api.js FaceRecognitionNet produces a 128-dim descriptor. */
export const VECTOR_DIM = 128;

/** A face feature template: a fixed-length numeric vector. */
export type FaceVector = number[];

/** Feature-model version identifier, embedded in persisted templates (要件13.8). */
export type ModelVersion = string;

/** Default model version tag for the local face-api.js pipeline. */
export const CURRENT_MODEL_VERSION: ModelVersion = "face-api.js@0.22.2/faceRecognitionNet";

/** Identification score threshold. Euclidean distance below this = same person (要件3.4). */
export const SCORE_THRESHOLD = 0.5;

/** 1:N identification population cap (識別対象母集団上限, 要件3.2). */
export const POPULATION_CAP = 500;

/** Max templates per account (要件9.3). */
export const MAX_TEMPLATES_PER_ACCOUNT = 5;

/** A valid template has exactly VECTOR_DIM finite numeric elements, no gaps (要件13.3). */
export function isValidFaceVector(v: unknown): v is FaceVector {
  return (
    Array.isArray(v) &&
    v.length === VECTOR_DIM &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}
