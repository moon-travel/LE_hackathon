// 【共有カーネル雛形】face-api.js ウォームアップ。
// 初回推論はモデル初期化で数百ms〜数秒かかる。ダミー画像で一度推論し初回遅延を回避する。
// design「割り切りとリスク」: 起動時プリロード + ダミー推論でウォームアップ。

import * as faceapi from "face-api.js";
import { loadModels, isModelsLoaded } from "./loadModels";

/**
 * ダミー入力で一度推論を走らせ、モデルを温める。
 * モデル未ロードなら先にロードする。ブラウザ環境でのみ呼び出すこと。
 */
export async function warmup(): Promise<void> {
  if (!isModelsLoaded()) {
    await loadModels();
  }
  // 小さなダミー canvas で1回推論し初回遅延を吸収する。
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  await faceapi
    .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();
}
