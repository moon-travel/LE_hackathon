// Deterministic synthetic 128-dim vectors for seeding/testing without a camera.
// Each "person" gets a distinct base direction so euclidean distances between
// different people are well above the 0.5 threshold, and a person's own vector
// (optionally jittered) stays well below it.
import { VECTOR_DIM, type FaceVector } from "@/types/vector";

/** A reproducible pseudo-random generator (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Base vector for person `id`. Values in a small range; the per-person seed
 * makes distinct people far apart in L2 space (each dimension differs by ~1).
 */
export function personVector(id: number): FaceVector {
  // Deterministic per-person direction. Using the person's own seed for every
  // dimension makes distinct people diverge across all 128 dims, so their
  // pairwise L2 distance is large (well above threshold).
  const rand = rng(1000 + id * 7919);
  const v: number[] = new Array(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i++) {
    v[i] = rand(); // in [0,1), unique cloud per id
  }
  return v;
}

/**
 * A slightly jittered capture of person `id` (simulates a second photo).
 * Jitter is tiny so distance stays < threshold.
 */
export function personVectorJittered(id: number, seed = 1): FaceVector {
  const base = personVector(id);
  const rand = rng(id * 31 + seed);
  return base.map((x) => x + (rand() - 0.5) * 0.02);
}
