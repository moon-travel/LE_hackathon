// 【凍結対象】共有型: 顔特徴量テンプレートの永続化形式（Template_Codec）。要件13 対応。
// encode: FaceVector + ModelVersion -> 永続化形式（JSON 文字列）
// decode: 永続化形式 -> FaceVector + ModelVersion
// バージョン識別子を復元可能な形で含める（要件13-8）。エンコードは決定的（要件13-5）。

import type { FaceVector, ModelVersion } from "./vector";

/** 符号化前の論理テンプレート（メモリ表現）。 */
export interface FaceTemplatePlain {
  /** 128 次元の有限数値配列。 */
  vector: FaceVector;
  /** 特徴量モデルのバージョン識別子。 */
  modelVersion: ModelVersion;
}

/**
 * 永続化形式データ。JSON 文字列として保存される。
 * 制約: バイト長は 1 バイト以上 65536 バイト以下（要件13-4/13-6）。
 * 0 バイト / 65536 超 / バージョン欠落 / 構造不適合はデコード時に拒否する。
 */
export type EncodedTemplate = string;

/** 永続化形式の下限バイト長（含む）。要件13-4/13-6。 */
export const ENCODED_MIN_BYTES = 1;

/** 永続化形式の上限バイト長（含む）。要件13-4/13-6。 */
export const ENCODED_MAX_BYTES = 65536;

/**
 * 永続化形式の JSON 構造（EncodedTemplate をパースした形）。
 * version はバージョン識別子（欠落は不正、要件13-6）。
 */
export interface EncodedTemplateShape {
  version: ModelVersion;
  vector: FaceVector;
}

/** デコード結果。復元テンプレートとバージョン識別子（要件13-2）。 */
export interface DecodeResult {
  vector: FaceVector;
  modelVersion: ModelVersion;
}
