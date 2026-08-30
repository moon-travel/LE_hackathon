// 担当B — payment provider mock. Requirements 2.2, 2.3, 2.5, 6.2, 6.6, 6.8, 12.8.
// Charge / card auth / refund stubs. Return immediate success by default; a mode
// switch lets the demo force decline, timeout, or refund failure.

export type GatewayMode = "success" | "decline" | "timeout" | "refund_fail";

let mode: GatewayMode = "success";

/** Set the mock behavior (demo control). */
export function setGatewayMode(m: GatewayMode): void {
  mode = m;
}
export function getGatewayMode(): GatewayMode {
  return mode;
}

export interface GatewayResult {
  ok: boolean;
  reason?: "declined" | "timeout" | "refund_failed";
  token?: string; // for cardAuth
}

/** Card charge (top-up). 要件6.2, 6.6, 6.8. */
export async function charge(amount: number): Promise<GatewayResult> {
  void amount;
  if (mode === "decline") return { ok: false, reason: "declined" };
  if (mode === "timeout") return { ok: false, reason: "timeout" };
  return { ok: true };
}

/** Card registration -> provider token. 要件2.5. */
export async function cardAuth(): Promise<GatewayResult> {
  if (mode === "decline") return { ok: false, reason: "declined" };
  if (mode === "timeout") return { ok: false, reason: "timeout" };
  return { ok: true, token: `tok_${Math.random().toString(36).slice(2, 10)}` };
}

/** Refund to card (payout). 要件12.8. */
export async function refund(amount: number): Promise<GatewayResult> {
  void amount;
  if (mode === "refund_fail") return { ok: false, reason: "refund_failed" };
  if (mode === "timeout") return { ok: false, reason: "timeout" };
  return { ok: true };
}
