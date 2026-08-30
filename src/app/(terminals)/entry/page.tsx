// 担当C — Entry_Gate UI. Requirements 3.1, 4.2.
"use client";

import { useState } from "react";
import { useCamera } from "../useCamera";
import { captureDescriptorFromVideo } from "@/lib/face/detect";
import { warmup } from "@/lib/face/warmup";
import type { EntryResponse } from "@/types/api";

const LABELS: Record<string, string> = {
  entered: "入場を許可しました（ゲート開放）",
  reentered: "再入場を許可しました（セッション維持）",
  no_pass: "有効な入浴券がありません。購入が必要です。",
  auth_failed: "認証失敗。登録端末での再登録をご案内します。",
  ambiguous: "識別が確定できません。係員にお声がけください。",
  timeout: "タイムアウト。もう一度お試しください。",
};

export default function EntryPage() {
  const { videoRef, ready, error, start } = useCamera();
  const [status, setStatus] = useState("");
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
      setStatus("顔を検出できませんでした。もう一度お試しください。");
      setBusy(false);
      return;
    }
    const res = await fetch("/api/entry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vector: det.vector, purpose: "entry" }),
    });
    const data = (await res.json()) as EntryResponse;
    setStatus(LABELS[data.result] ?? data.result);
    setBusy(false);
  }

  return (
    <main>
      <h1>入場ゲート</h1>
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
            顔で入場
          </button>
        )}
      </div>
      {error && <p style={{ color: "crimson" }}>カメラエラー: {error}</p>}
      {status && <p>{status}</p>}
    </main>
  );
}
