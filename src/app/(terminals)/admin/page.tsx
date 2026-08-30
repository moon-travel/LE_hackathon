// 担当C — Admin_Console UI. Requirements 14.1, 14.2, 14.3, 14.6, 14.7, 14.8.
"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AdminGetResponse,
  AdminActionResponse,
  ApiError,
} from "@/types/api";

export default function AdminPage() {
  const [snap, setSnap] = useState<AdminGetResponse | null>(null);
  const [msg, setMsg] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin", { method: "GET" });
    if (!res.ok) return;
    setSnap((await res.json()) as AdminGetResponse);
  }, []);

  // Refresh active count every 5s (要件14.1).
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  async function forceClose(sessionId: string) {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "forceClose", sessionId, operatorId: "admin-ui" }),
    });
    if (res.ok) {
      setMsg(`強制クローズしました (${sessionId})`);
    } else {
      setMsg(`失敗: ${((await res.json()) as ApiError).error}`);
    }
    refresh();
  }

  async function runScan() {
    const res = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "runRetentionScan", operatorId: "admin-ui" }),
    });
    if (res.ok) {
      const data = (await res.json()) as AdminActionResponse;
      setMsg(`削除走査: ${data.deletedCount ?? 0} 件削除`);
    } else {
      setMsg(`失敗: ${((await res.json()) as ApiError).error}`);
    }
    refresh();
  }

  return (
    <main>
      <h1>管理コンソール</h1>
      {snap && (
        <>
          <p>
            滞在中: <strong>{snap.activeCount}</strong> / {snap.capacity}
            {snap.atCapacityWarning && <span style={{ color: "crimson" }}> ⚠ 上限到達（介入が必要）</span>}
            {!snap.atCapacityWarning && snap.nearCapacityWarning && (
              <span style={{ color: "darkorange" }}> ⚠ 上限接近</span>
            )}
          </p>
          <button onClick={runScan}>削除走査を手動実行</button>
          {msg && <p>{msg}</p>}

          <h2 style={{ fontSize: "1rem" }}>ACTIVE セッション</h2>
          <table style={{ width: "100%", fontSize: ".8rem", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>入場時刻</th>
                <th>残高</th>
                <th>利用権</th>
                <th>通過</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {snap.sessions.map((s) => (
                <tr key={s.sessionId} style={{ borderTop: "1px solid #eee" }}>
                  <td>{new Date(s.enteredAt).toLocaleTimeString()}</td>
                  <td style={{ textAlign: "center" }}>{s.balance}</td>
                  <td style={{ textAlign: "center" }}>{s.hasValidPass ? "有" : "—"}</td>
                  <td style={{ textAlign: "center" }}>{s.passHistory.length}</td>
                  <td>
                    <button onClick={() => forceClose(s.sessionId)}>強制クローズ</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 style={{ fontSize: "1rem" }}>監査ログ（新しい順）</h2>
          <ul style={{ fontSize: ".75rem", color: "#444", maxHeight: 240, overflow: "auto" }}>
            {snap.auditLogs.slice(0, 100).map((l) => (
              <li key={l.id}>
                {new Date(l.ts).toLocaleTimeString()} [{l.eventType}]{" "}
                {l.accountId ? `acct=${l.accountId.slice(0, 6)} ` : ""}
                {JSON.stringify(l.detail)}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
