# [担当B] アカウント・決済・利用権（前払いとACID）

Issue: #5 / ブランチ: `feat/B-account-payment-pass` / 依存: #3

## 所有ディレクトリ（他担当は触らない）
`src/app/api/pay/` `src/app/api/pass/` `src/app/api/account/` `src/lib/account/` `src/lib/payment-mock/`

## 作業
- [ ] 残高操作: Prisma $transaction（残高チェック→減算→取引記録の原子性）
- [ ] 冪等キー（terminal+amount+sessionId+時刻窓60秒）で二重減算防止
- [ ] 決済モック（charge/cardAuth/refund, 成功失敗切替）
- [ ] `/api/pay` 施設内決済（0件/2件/残高不足分岐, オートチャージ）
- [ ] `/api/account` 生成・チャージ・払い出し（0〜50000円制約）
- [ ] `/api/pass` 利用権発行・検証（営業日終了まで, 回数無制限）
- [ ] プロパティテスト P3/P4/P5/P10（fast-check, 100反復）

対象要件: 2, 5, 6, 7, 12
