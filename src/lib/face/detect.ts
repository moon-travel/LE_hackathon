// 【共有カーネル雛形】カメラ画像 → 128次元 descriptor 抽出。
//
// 根幹の制約（要件1-7 / 11-4）:
//   - 顔特徴量算出の完了後、元の顔画像を揮発性メモリ上から破棄する（要件1-7）。
//   - 顔画像を永続ストレージへ書き込まない。サーバーへ送るのは128次元ベクトルと purpose のみ。
//   - 顔処理はブラウザ内で完結し、画像データが端末外へ出ない（要件11-4）。
//
// 呼び出し側は本関数の戻り値（FaceVector）だけをAPIへ送ること。入力画像要素は本関数内で
// 参照を解放し、以降利用しない。

import * as faceapi from "face-api.js";
import { VECTOR_DIM } from "@/types/vector";
import type { FaceVector } from "@/types/vector";

/** detect が受け取り可能な画像入力（ブラウザ）。 */
export type ImageInput = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;

export interface DetectResult {
  /** 128次元 descriptor。none の場合は null。 */
  vector: FaceVector | null;
  /** 検出された顔が0件/複数などの区分。 */
  status: "ok" | "no_face" | "error";
}

/**
 * 画像入力から単一顔を検出し 128次元ベクトルを抽出する。
 * 抽出後、入力画像バッファへの参照を破棄する（要件1-7）。
 *
 * 注意: 実モデルは Phase2 で public/models/ に配置。ここではロジックの型契約を確定する雛形。
 */
export async function detectDescriptor(input: ImageInput): Promise<DetectResult> {
  try {
    const detection = await faceapi
      .detectSingleFace(input, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor();

    // --- 元画像の破棄（要件1-7）: 入力が canvas なら内容をクリアし参照を解放する ---
    disposeImageInput(input);

    if (!detection) {
      return { vector: null, status: "no_face" };
    }

    const vector = Array.from(detection.descriptor) as FaceVector;
    if (vector.length !== VECTOR_DIM) {
      return { vector: null, status: "error" };
    }
    return { vector, status: "ok" };
  } catch {
    disposeImageInput(input);
    return { vector: null, status: "error" };
  }
}

/**
 * 元画像バッファを揮発性メモリ上から破棄する（要件1-7）。
 * canvas は内容をクリアし寸法を0にして解放を促す。
 */
export function disposeImageInput(input: ImageInput): void {
  if (typeof HTMLCanvasElement !== "undefined" && input instanceof HTMLCanvasElement) {
    const ctx = input.getContext("2d");
    ctx?.clearRect(0, 0, input.width, input.height);
    input.width = 0;
    input.height = 0;
  }
  // video / img は呼び出し側が参照を手放すことで解放される。ここでは再利用禁止の意図を明示。
}
