# 顔認証温泉入場・前払い決済システム (Face-Auth Onsen Entry) — MVP

顔を identity key として、入場・施設内決済・退場を一つの滞在セッションで管理するローカル完結 MVP。
Next.js (App Router) + Prisma + SQLite、顔処理はブラウザ内 face-api.js（128次元ベクトル）。

## セットアップ

```bash
npm install
npx prisma migrate dev        # SQLite (prisma/dev.db) を作成
npm run db:seed               # デモ用アカウント4名を投入
```

face-api.js のモデル重みを `public/models/` に配置してください（`public/models/README.md` 参照）。
カメラ入力を使う端末UI（登録/入場/窓口/退場）に必要です。

## 起動

```bash
npm run dev      # http://localhost:3000
```

端末UI:
- `/enroll` 登録端末（同意5項目 → カメラ → 128次元ベクトル生成 → 元画像破棄 → 登録）
- `/entry` 入場ゲート
- `/service` 施設内窓口（顔決済 / 別室利用権検証）
- `/exit` 退場ゲート（退場で顔テンプレート削除）
- `/admin` 管理コンソール（滞在一覧・監査ログ・強制クローズ・削除走査）

## テスト

```bash
npm run test         # vitest（12プロパティ + E2E背骨）
npm run typecheck    # tsc --noEmit
```

## アーキテクチャ

- **ブラウザ**: getUserMedia → face-api.js で 128次元ベクトル生成。元画像は推論後に破棄し、サーバーへは送らない。
- **API Routes**: `/api/{auth/identify,entry,exit,pay,account,pass,consent,enroll,admin}`。
- **Prisma + SQLite**: Account（永続）/ FaceTemplate（短期・自動削除）/ Session（滞在）/ Pass（利用権）/ AuditLog（追記専用）。
- **スケジューラ**: `src/instrumentation.ts` が起動時に保管期限走査（60秒周期）を起動。

## 中核の不変条件（プロパティテストで検証）

| # | 内容 | 要件 |
|---|---|---|
| 1 | 同意項目の独立記録 | 1.4 |
| 2 | 1:N識別の件数判定整合 | 3.4, 3.6, 3.7, 5.5, 5.7 |
| 3 | 残高減算の原子性 | 5.2, 5.9 |
| 4 | 支払いの冪等性 | 5.6 |
| 5 | 残高の範囲不変 (0–50000) | 6.5 |
| 6 | 符号化ラウンドトリップ順方向 | 13.3 |
| 7 | 永続化形式ラウンドトリップ逆方向 | 13.4 |
| 8 | エンコードの決定性 | 13.5 |
| 9 | 不正な永続化形式の拒否 | 13.6 |
| 10 | 利用権判定の冪等 | 7.3 |
| 11 | 退場によるセッション遷移 | 8.1 |
| 12 | 削除後の照合不成立 | 10.4, 10.7 |

仕様: `.kiro/specs/face-auth-onsen-entry/`（requirements / design / tasks）。
