// 担当: 共有 — extract a 128-dim descriptor from a camera frame IN THE BROWSER,
// then discard the source image. The raw image is never persisted and never
// sent to the server (要件1.7 元画像破棄, 要件11.4 端末外に出さない).
"use client";

import { loadModels, faceapi } from "./loadModels";
import { VECTOR_DIM, type FaceVector } from "@/types/vector";

export type DetectResult =
  | { ok: true; vector: FaceVector }
  | { ok: false; reason: "no_face" | "bad_dimension" };

/**
 * Detect one face in the given source and return its 128-dim descriptor.
 *
 * The caller passes a live video/image/canvas element. After computing the
 * descriptor we do NOT retain any pixel data — the returned value is only the
 * numeric vector. Callers should also stop the camera stream / clear canvases
 * they own once this resolves.
 */
export async function detectDescriptor(
  source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement,
): Promise<DetectResult> {
  await loadModels();

  const detection = await faceapi
    .detectSingleFace(source, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return { ok: false, reason: "no_face" };
  }

  // Float32Array(128) -> plain number[] so it serializes as JSON cleanly.
  const vector = Array.from(detection.descriptor) as FaceVector;

  if (vector.length !== VECTOR_DIM) {
    return { ok: false, reason: "bad_dimension" };
  }

  return { ok: true, vector };
}

/**
 * Capture a single frame from a running <video> onto a throwaway canvas,
 * compute the descriptor, and immediately clear the canvas pixels.
 * The canvas is local to this function and discarded on return (要件1.7).
 */
export async function captureDescriptorFromVideo(
  video: HTMLVideoElement,
): Promise<DetectResult> {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 320;
  canvas.height = video.videoHeight || 240;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "no_face" };

  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    return await detectDescriptor(canvas);
  } finally {
    // Discard the raw frame from the volatile canvas (要件1.7 揮発性メモリ破棄).
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
  }
}
