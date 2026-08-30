// 【凍結対象】共有型: 照合の利用目的。要件11-1/11-2 で3件に限定。
// "entry"=入場認証 / "payment"=施設内の支払い照合 / "pass"=利用権の検証

export type Purpose = "entry" | "payment" | "pass";

/** 利用目的の許容値一覧。purpose 検証（要件11-2/11-3）に用いる。 */
export const PURPOSES: readonly Purpose[] = ["entry", "payment", "pass"] as const;

/** 任意の値が有効な Purpose かを判定する型ガード。 */
export function isPurpose(value: unknown): value is Purpose {
  return typeof value === "string" && (PURPOSES as readonly string[]).includes(value);
}
