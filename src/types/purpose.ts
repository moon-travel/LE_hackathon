// Purpose limitation types (frozen after Phase 0). Requirements 11.1, 11.2.

/**
 * Allowed matching purposes. Auth_Service rejects any request whose purpose
 * is not one of these three (要件11.2, 11.3).
 * - entry:   入場認証
 * - payment: 施設内の支払い照合
 * - pass:    利用権の検証
 */
export type Purpose = "entry" | "payment" | "pass";

export const ALLOWED_PURPOSES: readonly Purpose[] = ["entry", "payment", "pass"] as const;

export function isPurpose(v: unknown): v is Purpose {
  return typeof v === "string" && (ALLOWED_PURPOSES as readonly string[]).includes(v);
}
