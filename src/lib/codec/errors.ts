// 担当C — Template_Codec のエラー型。
//
// 凍結対象の src/types/codec.ts には例外型を置かない方針のため、codec モジュール側で定義する。
// 要件13-7: エラー情報に顔特徴量ベクトルの値・元データを一切含めない。reason は区分のみを持つ。

/** 永続化形式が不正である理由の区分（要件13-6）。 */
export type CodecErrorReason =
  /** 0 バイト（要件13-4/13-6）。 */
  | "empty"
  /** 上限バイト長超過（要件13-4/13-6）。 */
  | "too_large"
  /** バージョン識別子の欠落（要件13-6）。 */
  | "missing_version"
  /** JSON として壊れている / 構造不適合（要件13-6）。 */
  | "malformed"
  /** 符号化しようとしたベクトルが無効（次元数不一致・非有限値）。 */
  | "invalid_vector";

/**
 * 永続化形式の符号化・復号に失敗したことを表す例外。
 *
 * 要件13-7 のため、メッセージには reason 区分だけを載せ、ベクトル値や入力データは載せない。
 */
export class CodecError extends Error {
  constructor(public readonly reason: CodecErrorReason) {
    super(`codec error: ${reason}`);
    this.name = "CodecError";
  }
}
