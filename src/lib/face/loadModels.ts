// 担当: 共有 — face-api.js model loading (browser-side).
// Models live under public/models/ and are served statically by Next.js.
// Uses TinyFaceDetector + FaceLandmark68 + FaceRecognition (128-dim descriptor).
"use client";

import * as faceapi from "face-api.js";

const MODEL_URL = "/models";

let loadPromise: Promise<void> | null = null;

/**
 * Load the three nets once. Safe to call repeatedly; the underlying load
 * happens a single time. Requirements 1.6 (10s enroll budget) rely on models
 * being preloaded before capture.
 */
export function loadModels(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
  })();
  return loadPromise;
}

export function modelsLoaded(): boolean {
  return (
    faceapi.nets.tinyFaceDetector.isLoaded &&
    faceapi.nets.faceLandmark68Net.isLoaded &&
    faceapi.nets.faceRecognitionNet.isLoaded
  );
}

export { faceapi };
