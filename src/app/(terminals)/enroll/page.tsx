// 担当C — Enrollment_Terminal UI. Requirements 1.1, 1.7, 11.1, 11.4.
// Shows the 5-item consent screen, captures a face IN-BROWSER, converts to a
// 128-dim vector, discards the raw image, and posts only the vector.
"use client";

import { useState } from "react";
import { useCamera } from "../useCamera";
import { captureDescriptorFromVideo } from "@/lib/face/detect";
import { warmup } from "@/lib/face/warmup";
import type { EnrollResponse } from "@/types/api";

const CONSENT_VERSION = "v1";

export default function EnrollPage() {
  const { videoRef, ready, error, start, stop } = useCamera();
  const [consentEnrollment, setConsentEnrollment] = useState(false);
  const [consentPayment, setConsentPayment] = useState(false);
  const [retentionDays, setRetentionDays] = useState(7);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EnrollResponse | null>(null);

  async function onStart() {
    setStatus("カメラとモデルを準備中...");
    await warmup();
    await start();
    setStatus("カメラ準備完了。顔を枠に入れて登録してください。");
  }

  async function onEnroll() {
    if (!videoRef.current) return;
    if (!consentEnrollment) {
      setStatus("顔登録への同意が必要です。");
      return;
    }
    setBusy(true);
    // Up to 3 attempts (要件1.9).
    let vector: number[] | null = null;
    for (let attempt = 1; attempt <= 3 && !vector; attempt++) {
      setStatus(`顔を検出中... (試行 ${attempt}/3)`);
      const det = await captureDescriptorFromVideo(videoRef.current);
      if (det.ok) vector = det.vector;
    }
    if (!vector) {
      setStatus("顔特徴量を算出できませんでした。係員にお声がけください。");
      setBusy(false);
      return;
    }
    setStatus("登録中...");
    const res = await fetch("/api/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        vector,
        consentEnrollment,
        consentPayment,
        consentVersion: CONSENT_VERSION,
        retentionDays,
      }),
    });
    const data = (await res.json()) as EnrollResponse;
    setResult(data);
    setStatus(data.ok ? "登録が完了しました。" : `登録失敗: ${data.error ?? ""}`);
    // Stop the camera; the raw frames are already discarded (要件1.7).
    stop();
    setBusy(false);
  }

  return (
    <main>
      <h1>顔登録端末</h1>

      <section style={{ border: "1px solid #ccc", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <h2 style={{ fontSize: "1rem" }}>同意事項</h2>
        <ul style={{ fontSize: ".85rem", color: "#444" }}>
          <li>取得する情報: 顔特徴量テンプレート（128次元の数値）</li>
          <li>利用目的: 入場認証 / 施設内の支払い照合 / 利用権の検証</li>
          <li>顔画像は保存しません（特徴量算出後に即時破棄）</li>
          <li>保管期間: 退場時刻から下記日数（既定7日）</li>
          <li>同意の撤回: 登録端末でいつでも可能（撤回で顔データを削除）</li>
        </ul>
        <label style={{ display: "block", marginTop: 8 }}>
          <input
            type="checkbox"
            checked={consentEnrollment}
            onChange={(e) => setConsentEnrollment(e.target.checked)}
          />{" "}
          顔登録に同意する（必須）
        </label>
        <label style={{ display: "block", marginTop: 4 }}>
          <input
            type="checkbox"
            checked={consentPayment}
            onChange={(e) => setConsentPayment(e.target.checked)}
          />{" "}
          顔決済利用に同意する（任意）
        </label>
        <label style={{ display: "block", marginTop: 8 }}>
          保管期間（日, 1-90）:{" "}
          <input
            type="number"
            min={1}
            max={90}
            value={retentionDays}
            onChange={(e) => setRetentionDays(Number(e.target.value))}
            style={{ width: 64 }}
          />
        </label>
      </section>

      <video
        ref={videoRef}
        playsInline
        muted
        style={{ width: "100%", maxWidth: 360, background: "#000", borderRadius: 8 }}
      />

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        {!ready ? (
          <button onClick={onStart}>カメラ開始</button>
        ) : (
          <button onClick={onEnroll} disabled={busy || !consentEnrollment}>
            顔を登録
          </button>
        )}
      </div>

      {error && <p style={{ color: "crimson" }}>カメラエラー: {error}</p>}
      {status && <p>{status}</p>}
      {result?.ok && (
        <p style={{ color: "green" }}>
          アカウントID: {result.accountId}（テンプレート {result.templateCount} 件
          {result.evictedOldest ? " / 最古を1件削除" : ""}）
        </p>
      )}
    </main>
  );
}
