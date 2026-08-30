// 特徴量モデルのバージョン識別子と Auth_Service の対応バージョン一覧。
// _Requirements: 9.10, 13.8_
//
// 要件9-10: デコードされたバージョン識別子が対応バージョン一覧に含まれない場合、
// 当該テンプレートのみを 1:N 識別の母集団から除外し、同一アカウントの対応版は残す。
//
// 【担当C向け】/api/enroll でテンプレートを保存する際は CURRENT_MODEL_VERSION を書き込むこと。
// 別の文字列を書くと対応バージョン外として母集団から除外され、その顔では認証できなくなる。

import type { ModelVersion } from "@/types/vector";

/** 現行の特徴量モデル。face-api.js の FaceRecognitionNet（128次元 descriptor）。 */
export const CURRENT_MODEL_VERSION: ModelVersion = "face-api.js/faceRecognitionNet@0.22";

/** Auth_Service が 1:N 識別に用いることのできるバージョン一覧（要件9-10）。 */
export const SUPPORTED_MODEL_VERSIONS: readonly ModelVersion[] = [CURRENT_MODEL_VERSION] as const;

export function isSupportedModelVersion(v: string): boolean {
  return SUPPORTED_MODEL_VERSIONS.includes(v);
}
