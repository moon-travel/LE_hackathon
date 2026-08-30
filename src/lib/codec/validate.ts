// 担当C — Template_Codec validation. 要件13-4 / 13-6 / 13-7。
// 拒否対象: 0 バイト / 上限バイト長超過 / バージョン識別子欠落 / 構造不適合。
// エラーにはベクトル値も元データも含めない（要件13-7）。

import { ENCODED_MIN_BYTES, ENCODED_MAX_BYTES } from "@/types/codec";
import type { EncodedTemplate, EncodedTemplateShape } from "@/types/codec";
import { CodecError } from "./errors";
import { isValidFaceVector } from "./vector";

const utf8 = new TextEncoder();

/** UTF-8 として符号化したときのバイト長。 */
export function byteLength(data: string): number {
  return utf8.encode(data).length;
}

/**
 * 永続化形式を検証し、パース済みの構造を返す。不正なら CodecError を投げる。
 * バイト長（要件13-4）を先に見て、その後に構造を見る（要件13-6）。
 */
export function validateEncoded(data: EncodedTemplate): EncodedTemplateShape {
  if (typeof data !== "string") {
    throw new CodecError("malformed");
  }
  const bytes = byteLength(data);
  if (bytes < ENCODED_MIN_BYTES) throw new CodecError("empty");
  if (bytes > ENCODED_MAX_BYTES) throw new CodecError("too_large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    throw new CodecError("malformed");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new CodecError("malformed");
  }
  const obj = parsed as Record<string, unknown>;

  // 要件13-6: バージョン識別子の欠落は不正。
  if (typeof obj.version !== "string" || obj.version.length === 0) {
    throw new CodecError("missing_version");
  }
  if (!isValidFaceVector(obj.vector)) {
    throw new CodecError("malformed");
  }
  return { version: obj.version, vector: obj.vector };
}
