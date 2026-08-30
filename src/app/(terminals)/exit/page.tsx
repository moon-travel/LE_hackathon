// 担当C — Exit_Gate UI. Requirements 8.1, 8.3.
"use client";

import { useState } from "react";
import { useCamera } from "../useCamera";
import { captureDescriptorFromVideo } from "@/lib/face/detect";
import { warmup } from "@/lib/face/warmup";
import type { ExitResponse } from "@/types/api";

const LABELS: Record<string, string> = {
  exited: "退場を確認しました。顔データの保管期限を設定しました。",
  no_active_session: "滞在セッションがありません。ゲートを開放します。",
  auth_failed: "識別できませんでした。係員による手動退場が必要です。",
};

export default function ExitPage() {
  const { videoRef, ready, error, start } = useCamera();
  const [status, setStatus] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function onStart() {
    await warmup();
    await start();
    setStatus("顔をゲートに向けてください。");
  }

  async function onScan() {
    if (!videoRef.current) return;
    setBusy(true);
    setStatus("識別中...");
    const det = await captureDescriptorFromVideo(videoRef.current);
    if (!det.ok) {
      setStatus("顔を検出できませんでした。");
      setBusy(false);
      return;
    }
    const res = await fetch("/api/exit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vector: det.vector, purpose: "entry" }),
    });
    const data = (await res.json()) as ExitResponse;
    setStatus(LABELS[data.result] ?? data.result);
    setBalance(typeof data.balance === "number" ? data.balance : null);
    setBusy(false);
  }

  return (
    <main>
      <h1>退場ゲート</h1>
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
          <button onClick={onScan} disabled={busy}>
            顔で退場
          </button>
        )}
      </div>
      {error && <p style={{ color: "crimson" }}>カメラエラー: {error}</p>}
      {status && <p>{status}</p>}
      {balance !== null && <p>残高: {balance} 円</p>}
    </main>
  );
}
