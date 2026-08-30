import type { ReactNode } from "react";

export default function TerminalsLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui", maxWidth: 560, margin: "0 auto", padding: "1.5rem" }}>
      <nav style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <a href="/">ホーム</a>
        <a href="/enroll">登録</a>
        <a href="/entry">入場</a>
        <a href="/service">窓口</a>
        <a href="/exit">退場</a>
        <a href="/admin">管理</a>
      </nav>
      {children}
    </div>
  );
}
