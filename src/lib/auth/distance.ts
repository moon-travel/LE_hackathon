// Auth_Service: 128次元ユークリッド距離と識別の定数。
// _Requirements: 3.2, 3.4, 3.6, 3.7, 5.1, 9.5_

import { VECTOR_DIM } from "@/types/vector";
import type { FaceVector } from "@/types/vector";

/**
 * 識別スコア閾値。design.md により「ユークリッド距離 0.5 未満で一致」と確定。
 *
 * 要件文（3-4/5-2/9-5）は「識別スコアが閾値以上なら一致」と書かれているが、距離は小さいほど
 * 似ているため不等号が逆になる。本実装は距離ベースで `distance < THRESHOLD` を一致条件とする。
 * 境界値 0.5 ちょうどは**不一致**（未満なので）。
 *
 * 表示用スコアは `1 - distance` として算出するため、`score > 0.5 ⟺ distance < 0.5` となり、
 * 要件文の「スコアが閾値（0.5）以上」という表現とも整合する。
 *
 * 参考: face-api.js の慣例的な既定値は 0.6。0.5 はそれより厳しく、他人受入を抑える代わりに
 * 本人拒否が増える。デモで本人拒否が目立つ場合はここだけを調整する。
 */
export const MATCH_THRESHOLD = 0.5;

/** 識別対象母集団上限（要件3-2 / 5-1 / 14-6 / 14-7 が参照する共通値）。 */
export const POPULATION_LIMIT = 500;

/**
 * 有効な顔特徴量ベクトルか判定する。
 * 次元数が VECTOR_DIM と一致し、全要素が有限の数値であること（要件13-3の「有効な」定義）。
 */
export function isValidVector(v: unknown): v is FaceVector {
  return (
    Array.isArray(v) &&
    v.length === VECTOR_DIM &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}

/**
 * 128次元ユークリッド距離。
 * 次元数が一致しない場合は比較不能なので例外を投げる（呼び出し前に isValidVector で弾く想定）。
 */
export function euclideanDistance(a: FaceVector, b: FaceVector): number {
  if (a.length !== b.length) {
    throw new Error(`vector dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * 距離から表示用スコアへの変換。要件11-6 によりベクトル値そのものは応答に含めないため、
 * 端末に返せるのはこのスコアだけになる。
 */
export function distanceToScore(distance: number): number {
  return 1 - distance;
}
