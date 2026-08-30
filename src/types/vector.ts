// 【凍結対象】共有型: 顔特徴量ベクトル。design.md「Components and Interfaces」対応。
// face-api.js の FaceRecognitionNet は 128 次元 descriptor を返す。

/** 顔特徴量ベクトル。128 次元の有限数値配列（VECTOR_DIM）。 */
export type FaceVector = number[];

/** 特徴量ベクトルの次元数。face-api.js の FaceRecognition モデル出力に一致（要件13-3）。 */
export const VECTOR_DIM = 128;

/** 特徴量モデルのバージョン識別子（要件13-8）。 */
export type ModelVersion = string;
