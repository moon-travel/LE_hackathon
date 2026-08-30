// 担当C — Template_Codec encode. 要件13-1 / 13-3 / 13-5 / 13-8。
//
// 永続化形式は凍結契約 src/types/codec.ts に従う:
//   EncodedTemplate      = JSON 文字列
//   EncodedTemplateShape = { version: ModelVersion; vector: FaceVector }
// バージョン識別子は version キーとして永続化形式そのものに含めるため、復号時に復元できる（要件13-8）。

import type { EncodedTemplate, EncodedTemplateShape } from "@/types/codec";
import type { FaceVector, ModelVersion } from "@/types/vector";
import { CodecError } from "./errors";
import { isValidFaceVector } from "./vector";

/**
 * テンプレートを永続化形式（JSON 文字列）へ符号化する。
 *
 * 決定的（要件13-5）: 同じ (vector, modelVersion) からは常にバイト列まで同一の出力を得る。
 * キー順をリテラルの記述順で固定し、空白なしで stringify し、配列順と数値精度を保つため。
 */
export function encodeTemplate(
  vector: FaceVector,
  modelVersion: ModelVersion,
): EncodedTemplate {
  if (!isValidFaceVector(vector)) {
    throw new CodecError("invalid_vector");
  }
  if (typeof modelVersion !== "string" || modelVersion.length === 0) {
    // バージョン識別子を含められない入力は符号化しない（要件13-8）。
    throw new CodecError("missing_version");
  }
  // -0 を +0 に正規化する。JSON.stringify(-0) === "0" のため、正規化しないと
  // encode→decode の厳密一致（要件13-3）が -0 で崩れる。-0 と +0 は数値として
  // 等しいので、この正規化で情報は失われない。
  const canonical = vector.map((x) => (Object.is(x, -0) ? 0 : x));
  // オブジェクトリテラルのキー順は記述順。JSON.stringify はそれを保持する。
  const shape: EncodedTemplateShape = { version: modelVersion, vector: canonical };
  return JSON.stringify(shape);
}
