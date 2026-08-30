// 担当C — Template_Codec decode. 要件13-2 / 13-6 / 13-10。

import type { DecodeResult, EncodedTemplate } from "@/types/codec";
import { validateEncoded } from "./validate";

/**
 * 永続化形式からベクトルとバージョン識別子を復元する。
 * 不正な入力には CodecError を投げ、テンプレートを一切返さない（要件13-6）。
 *
 * バージョン識別子を返すので、Auth_Service は対応バージョン一覧と照合できる（要件13-10 / 9-10）。
 */
export function decodeTemplate(data: EncodedTemplate): DecodeResult {
  const shape = validateEncoded(data);
  return { vector: shape.vector, modelVersion: shape.version };
}
