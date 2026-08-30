// 担当A — Auth_Service. Euclidean distance between two 128-dim vectors.
import { VECTOR_DIM, type FaceVector } from "@/types/vector";

/**
 * Euclidean (L2) distance between two feature vectors. Smaller = more similar.
 * Throws if dimensions differ from the model's defined dimension.
 */
export function euclideanDistance(a: FaceVector, b: FaceVector): number {
  if (a.length !== VECTOR_DIM || b.length !== VECTOR_DIM) {
    throw new Error(`vectors must be ${VECTOR_DIM}-dim`);
  }
  let sum = 0;
  for (let i = 0; i < VECTOR_DIM; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}
