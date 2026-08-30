// 担当C — Service_Terminal UI (売店決済 + 別室利用権検証). Requirements 5.1, 7.2.
"use client";

import { useState } from "react";
import { useCamera } from "../useCamera";
import { captureDescriptorFromVideo } from "@/lib/face/detect";
import { warmup } from "@/lib/face/warmup";
import type { PayResponse, PassResponse } from "@/types/api";

const PAY_LABELS: Record<string, string> = {
  paid: "支払いが完了しました。",
  insufficient: "残高不足です。チャージが必要です。",
  auth_failed: "認証失敗。再登録をご案内します。",
  ambiguous: "識別が確定できません。",
  failed: "支払いが成立しませんでした。",
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

  async function capture(): Promise<number[] | null> {
    if (!videoRef.current) return null;
    const det = await captureDescriptorFromVideo(videoRef.current);
    return det.ok ? det.vector : null;
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
    const label = PAY_LABELS[data.result] ?? data.result;
    setStatus(
      data.result === "paid"
        ? `${label} 残高: ${data.balance} 円`
        : data.result === "insufficient"
          ? `${label} 不足額: ${data.shortfall} 円`
          : label,
    );
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
    const res = await fetch("/api/pass", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "verify", vector, purpose: "pass" }),
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
