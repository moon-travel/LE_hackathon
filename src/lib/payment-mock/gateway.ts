// 担当B所有: 決済事業者連携のモック（要件2/6/12）。
// charge（チャージ決済）/ cardAuth（カード登録認証）/ refund（返金）を、
// 成功 / 失敗（拒否）/ タイムアウト / 返金失敗 を注入制御可能に提供する。
// 実際の決済事業者は本 MVP スコープ外。挙動は GatewayBehavior で切り替える。
//
// タイムアウトは「要求送信から30秒以内に結果が得られない」を表す（要件2-3/6-8/12-8）。
// モックでは待たずに { ok:false, reason:"timeout" } を即返し、呼び出し側が残高不変で扱う。

/** ゲートウェイの結果理由区分。 */
export type GatewayReason = "declined" | "timeout" | "refund_failed";

export interface GatewayResult {
  ok: boolean;
  /** 決済事業者側の取引参照（成功時）。 */
  reference?: string;
  /** 不成立の理由（失敗時）。 */
  reason?: GatewayReason;
}

/** カード登録認証の結果。成功時に保存用トークンを発行する（要件2-5）。 */
export interface CardAuthResult {
  ok: boolean;
  /** 決済事業者が発行したトークン（成功時）。カード番号等は含めない（要件2-7）。 */
  token?: string;
  reason?: GatewayReason;
}

/** モックの挙動切り替え。テスト・デモで注入する。 */
export interface GatewayBehavior {
  /** charge の結果切替。既定 "success"。 */
  charge?: "success" | "declined" | "timeout";
  /** cardAuth の結果切替。既定 "success"。 */
  cardAuth?: "success" | "declined" | "timeout";
  /** refund の結果切替。既定 "success"。 */
  refund?: "success" | "declined" | "timeout" | "refund_failed";
}

export interface PaymentGateway {
  /** カード決済（チャージ / 残高不足時オートチャージ）。要件2-2/6-2/6-6/6-8。 */
  charge(cardToken: string, amount: number): Promise<GatewayResult>;
  /** カード登録認証。成功時トークン発行。要件2-5/2-6。 */
  cardAuth(rawCardRef: string): Promise<CardAuthResult>;
  /** 返金（払い出しのカード返金）。要件12-3/12-8。 */
  refund(cardToken: string, amount: number): Promise<GatewayResult>;
}

let counter = 0;
function nextRef(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now()}_${counter}`;
}

/**
 * モックゲートウェイを生成する。behavior で成功/失敗/タイムアウトを注入する。
 * 既定は全て成功（デモ背骨用）。
 */
export function createMockGateway(behavior: GatewayBehavior = {}): PaymentGateway {
  const chargeMode = behavior.charge ?? "success";
  const cardAuthMode = behavior.cardAuth ?? "success";
  const refundMode = behavior.refund ?? "success";

  return {
    async charge(_cardToken: string, _amount: number): Promise<GatewayResult> {
      if (chargeMode === "timeout") return { ok: false, reason: "timeout" };
      if (chargeMode === "declined") return { ok: false, reason: "declined" };
      return { ok: true, reference: nextRef("chg") };
    },

    async cardAuth(_rawCardRef: string): Promise<CardAuthResult> {
      if (cardAuthMode === "timeout") return { ok: false, reason: "timeout" };
      if (cardAuthMode === "declined") return { ok: false, reason: "declined" };
      return { ok: true, token: nextRef("tok") };
    },

    async refund(_cardToken: string, _amount: number): Promise<GatewayResult> {
      if (refundMode === "timeout") return { ok: false, reason: "timeout" };
      if (refundMode === "declined") return { ok: false, reason: "declined" };
      if (refundMode === "refund_failed")
        return { ok: false, reason: "refund_failed" };
      return { ok: true, reference: nextRef("rfd") };
    },
  };
}

/** 既定（全成功）のゲートウェイ。route の既定注入に用いる。 */
export const defaultGateway: PaymentGateway = createMockGateway();
