// 担当C — Exit_Gate UI. _Requirements: 8.1, 8.5_
//
// 応答は凍結契約 ExitResponse（released + exitedAt + reason）に従って解釈する。
// 退場は削除の契機ではなく、保管期限の設定契機である（要件8-2 / 10-1）。
"use client";

import { useState } from "react";
import { useCamera } from "../useCamera";
import { detectDescriptor } from "@/lib/face/detect";
import { warmup } from "@/lib/face/warmup";
import type { ExitResponse } from "@/types/api";

/** 不開放理由の表示文言。担当A の /api/exit が返す reason 区分に対応。 */
const REASON_LABELS: Record<string, string> = {
  none: "識別できませんでした。係員による手動退場が必要です。",
  ambiguous: "識別が確定できません。係員にお声がけください。",
  timeout: "タイムアウト。もう一度お試しください。",
};

export default function ExitPage() {
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
    const det = await detectDescriptor(videoRef.current);
    if (det.status !== "ok" || det.vector === null) {
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
    if (data.released) {
      const at = data.exitedAt ? `（${new Date(data.exitedAt).toLocaleString("ja-JP")}）` : "";
      setStatus(`退場を確認しました${at}。顔データの保管期限を設定しました。`);
    } else {
      const reason = data.reason ?? "unknown";
      setStatus(REASON_LABELS[reason] ?? `退場できません（${reason}）`);
    }
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
    </main>
  );
}
