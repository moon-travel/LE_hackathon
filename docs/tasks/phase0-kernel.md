# [Phase0] 共有カーネル（ブロッキング）

Issue: #3 / ブランチ: `feat/phase0-kernel`

全員が依存する土台を確定・凍結する。**完了まで担当A/B/Cはブロック**。

## 作業
- [ ] Next.js初期化（App Router, TS）+ 依存導入（face-api.js, @prisma/client, prisma, fast-check, vitest, ulid）
- [ ] Prismaスキーマ確定（Account/FaceTemplate/Session/Pass/AuditLog）+ migrate + SQLite初期化 【凍結】
- [ ] 共有型定義 `src/types/`（ベクトル型・API型・Purpose・SessionState・codec型）【凍結】
- [ ] 全API Routeの型契約スタブ（501返却）
- [ ] face-api.js プリロード/ウォームアップ/元画像破棄の雛形
- [ ] 凍結宣言 → A/B/Cへ着手通知

## 凍結ルール
`src/types/` と `prisma/schema.prisma` は完了後変更禁止。変更はこの担当に一元依頼。
