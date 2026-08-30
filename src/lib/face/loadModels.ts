// 【共有カーネル雛形】face-api.js モデルプリロード。
// TinyFaceDetector + FaceLandmark68 + FaceRecognition をロードする。
// モデルファイルは public/models/ に配置（実ファイルは Phase2 で配置）。
// ブラウザ内で完結（要件11-4: データが端末外に出ない）。

import * as faceapi from "face-api.js";

/** モデル配置先。public/models/ を静的配信する前提。 */
export const MODEL_URL = "/models";

let modelsLoaded = false;

/**
 * 3モデル（TinyFaceDetector / FaceLandmark68 / FaceRecognition）をロードする。
 * 二重ロードを避けるため冪等。ブラウザ環境でのみ呼び出すこと。
 */
export async function loadModels(modelUrl: string = MODEL_URL): Promise<void> {
  if (modelsLoaded) return;
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
    faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
    faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
  ]);
  modelsLoaded = true;
}

/** モデルがロード済みかを返す。 */
export function isModelsLoaded(): boolean {
  return modelsLoaded;
}
