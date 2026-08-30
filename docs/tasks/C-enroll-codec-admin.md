# [担当C] 登録・同意・符号化・監査UI

Issue: #6 / ブランチ: `feat/C-enroll-codec-admin` / 依存: #3

## 所有ディレクトリ（他担当は触らない）
`src/app/api/enroll/` `src/app/api/consent/` `src/app/api/admin/` `src/app/(terminals)/` `src/lib/codec/` `src/lib/consent/` `src/lib/audit/`

## 作業
- [ ] Template_Codec: 128次元ベクトルのencode/decode/validate（バージョン識別子, 不正形式拒否）
- [ ] Consent: 登録同意/決済同意を独立2項目で記録, 撤回で同期削除
- [ ] `/api/enroll` 登録（最大5件, 6件目は最古削除, 元画像非受領）
- [ ] Admin_Console + 監査ログ（追記専用, ACTIVE一覧, 強制クローズ, 上限警告）
- [ ] 端末UI画面骨格（enroll/entry/service/exit/admin, カメラ→ベクトル→元画像破棄）
- [ ] プロパティテスト P1/P6/P7/P8/P9（fast-check, 100反復）

対象要件: 1, 9, 11, 13, 14
