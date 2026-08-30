// 担当: 共有 — face-api.js warmup. Runs one dummy inference so the first real
// capture doesn't pay the model init cost (design 割り切り: 初回数秒回避).
"use client";

import { loadModels, faceapi } from "./loadModels";

let warmed = false;

/**
 * Ensure models are loaded and run a single throwaway inference on a blank
 * canvas. Idempotent.
 */
export async function warmup(): Promise<void> {
  if (warmed) return;
  await loadModels();

  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  try {
    await faceapi
      .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();
  } catch {
    // Blank canvas may yield no face; the point is to init the graph, not to detect.
  }
  warmed = true;
}
