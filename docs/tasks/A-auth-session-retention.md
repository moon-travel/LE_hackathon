# [担当A] 認証・セッション・削除（デモ背骨の中核）

Issue: #4 / ブランチ: `feat/A-auth-session-retention` / 依存: #3

## 所有ディレクトリ（他担当は触らない）
`src/app/api/auth/` `src/app/api/entry/` `src/app/api/exit/` `src/lib/auth/` `src/lib/retention/`

## 作業
- [ ] Auth_Service: ユークリッド距離・母集団照合（当日ACTIVE+当日登録, 上限500, 閾値0.5）
- [ ] `/api/auth/identify`（purpose検証, 監査追記）
- [ ] `/api/entry` 入場・再入場（ACTIVE維持, 通過履歴）
- [ ] `/api/exit` 退場（CLOSED化, expireAt=退場+retentionDays）
- [ ] Retention: 同期削除（本体）+ setInterval走査（保険）
- [ ] プロパティテスト P2/P11/P12（fast-check, 100反復）

対象要件: 3, 4, 8, 10
