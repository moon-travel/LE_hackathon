// 担当C — Service_Terminal UI（施設内の支払い + 別室利用権の検証）
// _Requirements: 5.1, 7.2, 11.1, 11.4_
//
// 応答は凍結契約 PayResponse（paid + reason + balance + chargeOptions）/ PassResponse に従う。
// 利用権検証は /api/pass が accountId を要求するため、まず /api/auth/identify（purpose="pass"）で
// 顔からアカウントを特定し、その accountId で検証する2段構成にしている。
"use client";

import { useState } from "react";
import { useCamera } from "../useCamera";
import { detectDescriptor } from "@/lib/face/detect";
import { warmup } from "@/lib/face/warmup";
import type { PayResponse, PassResponse, IdentifyResponse } from "@/types/api";

/** 不成立理由の表示文言。担当B の /api/pay が返す reason 区分に対応。 */
const PAY_REASON_LABELS: Record<string, string> = {
  none: "認証できませんでした。再登録をご案内します。",
  ambiguous: "識別が確定できません。係員にお声がけください。",
  insufficient: "残高不足です。チャージが必要です。",
  invalid_amount: "金額が不正です。",
  invalid_purpose: "目的外の照合要求のため拒否しました。",
  no_active_session: "滞在セッションがありません。入場ゲートを通過してください。",
  card_failed: "カード決済が拒否されました。",
  conflict_retry_required: "処理が競合しました。もう一度お試しください。",
};

export default function ServicePage() {
  const { videoRef, ready, error, start } = useCamera();
  const [amount, setAmount] = useState(500);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function onStart() {
    await warmup();
    await start();
    setStatus("顔を向けてください。");
  }

  /** ブラウザ内で顔特徴量を算出する。元画像は detect 側で破棄される（要件1-7）。 */
  async function capture(): Promise<number[] | null> {
    if (!videoRef.current) return null;
    const det = await detectDescriptor(videoRef.current);
    return det.status === "ok" ? det.vector : null;
  }

  async function onPay() {
    setBusy(true);
    setStatus("識別・決済中...");
    const vector = await capture();
    if (!vector) {
      setStatus("顔を検出できませんでした。");
      setBusy(false);
      return;
    }
    const res = await fetch("/api/pay", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vector, purpose: "payment", amount, terminal: "shop-1" }),
    });
    const data = (await res.json()) as PayResponse;
    if (data.paid) {
      setStatus(`支払いが完了しました。残高: ${data.balance} 円`);
    } else {
      const reason = data.reason ?? "unknown";
      const label = PAY_REASON_LABELS[reason] ?? `支払いが成立しませんでした（${reason}）`;
      const options = data.chargeOptions?.length
        ? ` チャージ候補: ${data.chargeOptions.join(" / ")} 円`
        : "";
      const balance = typeof data.balance === "number" ? ` 残高: ${data.balance} 円` : "";
      setStatus(`${label}${balance}${options}`);
    }
    setBusy(false);
  }

  async function onVerifyPass() {
    setBusy(true);
    setStatus("利用権を確認中...");
    const vector = await capture();
    if (!vector) {
      setStatus("顔を検出できませんでした。");
      setBusy(false);
      return;
    }
    // 1) 顔からアカウントを特定する（purpose="pass" は利用権検証に限定、要件11-2）。
    const idRes = await fetch("/api/auth/identify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vector, purpose: "pass" }),
    });
    const id = (await idRes.json()) as IdentifyResponse;
    if (id.result !== "matched" || !id.accountId) {
      setStatus(
        id.result === "ambiguous"
          ? "識別が確定できません。係員にお声がけください。"
          : "認証できませんでした。",
      );
      setBusy(false);
      return;
    }
    // 2) 特定したアカウントの利用権を検証する（回数無制限、要件7-3）。
    const res = await fetch("/api/pass", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify", accountId: id.accountId }),
    });
    const data = (await res.json()) as PassResponse;
    setStatus(data.valid ? "利用権あり。入室を許可します。" : "有効な利用権がありません。");
    setBusy(false);
  }

  return (
    <main>
      <h1>施設内窓口</h1>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ width: "100%", maxWidth: 360, background: "#000", borderRadius: 8 }}
      />
      <div style={{ marginTop: 12 }}>
        {!ready ? (
          <button onClick={onStart}>カメラ開始</button>
        ) : (
          <>
            <label>
              金額:{" "}
              <input
                type="number"
                min={1}
                max={100000}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                style={{ width: 96 }}
              />{" "}
              円
            </label>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={onPay} disabled={busy}>
                顔で支払い
              </button>
              <button onClick={onVerifyPass} disabled={busy}>
                別室利用権を確認
              </button>
            </div>
          </>
        )}
      </div>
      {error && <p style={{ color: "crimson" }}>カメラエラー: {error}</p>}
      {status && <p>{status}</p>}
    </main>
  );
}
