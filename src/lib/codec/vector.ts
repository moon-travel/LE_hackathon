// 担当C — codec 内で使う有効ベクトル判定。
//
// 判定基準は凍結定数 VECTOR_DIM に従う（要件13-3）。担当A の `isValidVector`
// （src/lib/auth/distance.ts）と同一の述語だが、codec が auth 層に依存しないよう
// ここに閉じて持つ。基準値はどちらも @/types/vector の VECTOR_DIM 由来で一意。

import { VECTOR_DIM } from "@/types/vector";
import type { FaceVector } from "@/types/vector";

/** 次元数が VECTOR_DIM と一致し、全要素が有限の数値であること（要件13-3）。 */
export function isValidFaceVector(v: unknown): v is FaceVector {
  return (
    Array.isArray(v) &&
    v.length === VECTOR_DIM &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  );
}
