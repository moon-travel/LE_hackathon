# [担当A] 認証・セッション・削除 — 要件整理と設計

Issue: #4 / ブランチ: `feat/A-auth-session-retention` / 依存: #3 (フェーズ0 共有カーネル)
対象要件: 要件3（入場認証とセッション開始）、要件4（再入場）、要件8（退場とセッション終了）、要件10（保管期間と自動削除）
担当プロパティ: Property 2 / 11 / 12

準拠: `.kiro/specs/face-auth-onsen-entry/requirements.md` / `design.md`（ローカル完結版）/ `tasks.md`
tasks.md フェーズ1 タスク7〜12 が本ドキュメントの実装範囲。

---

## 0. 着手条件

フェーズ0（tasks.md タスク1〜6）が未着手。`package.json` / `prisma/schema.prisma` / `src/types/` が未生成のため実装不可。
凍結宣言（タスク6）を待つ。

**スキーマへの追加要求はなし。** design.md の Data Models（Account / FaceTemplate / Session / Pass / AuditLog）で
要件3/4/8/10 は実装できる。当初「`FaceTemplate.businessDate` が必要」と考えたが、要件3.2の「当日登録済み」は
`FaceTemplate.createdAt` の日付比較で導出できるため不要。要件10.8/10.10 も 5.3節の方針でフィールド追加なしに満たせる。

---

## 1. 責務境界

### 所有（他担当は触らない）

| パス | 内容 | tasks.md |
|---|---|---|
| `src/lib/auth/distance.ts` | 128次元ユークリッド距離 | 7.1 |
| `src/lib/auth/identify.ts` | 母集団構築・1:N識別・purpose検証 | 7.1 |
| `src/lib/auth/identify.property.test.ts` | Property 2 | 7.2 |
| `src/lib/auth/exit.property.test.ts` | Property 11 | 10.1 |
| `src/app/api/auth/identify/route.ts` | identify エンドポイント | 8 |
| `src/app/api/entry/route.ts` | 入場・再入場 | 9 |
| `src/app/api/exit/route.ts` | 退場 | 10 |
| `src/lib/retention/deleteTemplate.ts` | 同期削除（本体） | 11.1 |
| `src/lib/retention/scanner.ts` | setInterval走査（保険） | 11.1 |
| `src/lib/retention/deleteTemplate.property.test.ts` | Property 12 | 11.2 |

### 他担当から借りるもの（呼ぶだけ。実装は相手側）

| 依存先 | 必要なもの | 用途 | 担当 |
|---|---|---|---|
| `src/lib/audit/` | 追記関数 | 要件8.4/8.5/10.6/11.10 の監査追記 | C |
| `src/lib/account/` | 当日有効な入浴券の判定 | 要件3.8 / 4.7 | B |
| `src/lib/account/` | 残高取得 | 要件8.3 の退場時残高表示 | B |
| `src/types/` | `Purpose` / `SessionState` / `FaceVector` / API型 | 全体 | フェーズ0 |

C/Bの実体が揃う前に開発が止まらないよう、A側は `src/lib/auth/deps.ts` に上記の型シグネチャのみ再宣言し、
差し替え可能にしておく（フェーズ0の型契約が出た時点でそれをimportに置換）。

### Aの担当外

- 要件3.5/3.13、要件8.3のUI表示 → 端末UIはC担当。APIは判定結果と理由コードを返すのみ
- 要件8.6〜8.9（閉場+猶予の自動FORCE_CLOSED）、要件8.10/8.11（Admin手動CLOSED）→ Admin/スケジューラはC担当。
  ただし `expireAt` 算定関数は `src/lib/retention/` から公開し、FORCE_CLOSED経路からも呼ばせる（要件8.8）

---

## 2. Auth_Service 設計（`src/lib/auth/`）

### 2.1 距離と閾値

要件文は「識別スコアが閾値**以上**なら一致」（要件3.4, 5.2, 9.5）と書かれているが、
design.md はユークリッド距離・**閾値0.5未満**で確定している。距離は小さいほど似ているので不等号は逆になる。
実装定義を以下に固定する。

```
distance(a, b) = sqrt(Σ (a_i - b_i)^2)        // 128次元
一致条件        : distance < 0.5               // 未満（境界0.5は不一致）
アカウント代表  : min(distance) over 最大5件   // 要件9.5「最高スコア採用」の距離版
```

境界の扱いに注意。`< 0.5` であり `<= 0.5` ではない。Property 2 は境界値 0.5 ちょうどを不一致側として検証する。
face-api.js の慣例的な既定値は 0.6 で、0.5 はそれより厳しい（他人受入を抑える代わりに本人拒否が増える）。
デモで本人拒否が目立つ場合の調整余地を残すため、閾値は `src/lib/auth/identify.ts` の定数1箇所に置く。

### 2.2 母集団 — purposeで範囲が変わる

要件3.2（入場）と要件5.1（決済）で母集団の定義が異なる。同一関数で切り替える。

| purpose | 母集団 | 根拠 |
|---|---|---|
| `"entry"` | 当日ACTIVEセッション保持アカウント ∪ 当日登録済みアカウント | 要件3.2 |
| `"payment"` | ACTIVEセッション保持アカウントのみ | 要件5.1 |
| `"pass"` | ACTIVEセッション保持アカウントのみ | 要件7.2（施設内判定のため） |

- 件数上限 500（要件3.2 / 5.1 / 14.6 / 14.7 が同一値を参照）
- 「当日登録済み」は `FaceTemplate.createdAt` が当日のもの
- `modelVersion` が非対応のテンプレートは**そのテンプレートのみ**除外し、同一アカウントの対応版は残す（要件9.10）
- 削除済みテンプレートは同一DBを引くため即座に母集団から外れる（要件10.11の「60秒以内」は構造的に満たす）

### 2.3 判定分岐

`distance < 0.5` を満たす**アカウント**の件数 n で分岐する（テンプレート件数ではない）。

| n | result | 挙動 | 要件 |
|---|---|---|---|
| 0 | `none` | 認証失敗・再登録案内 | 3.6, 5.5, 9.10 |
| 1 | `matched` | accountId を返す | 3.4, 5.2 |
| ≥2 | `ambiguous` | 係員対応。セッション生成せず残高も動かさない | 3.7, 5.7 |

### 2.4 purpose検証とタイムアウト

- `purpose` が `"entry" | "payment" | "pass"` 以外なら照合を実行せず 400（要件11.2, 11.3）。
  拒否も監査追記の対象（要件元・判定結果・拒否事由。ベクトル値は記録しない。要件11.10, 14.4）
- 要件3.3（2秒）/ 要件9.5（1.5秒）に対し、`identify()` 内で 1.5秒で打ち切り `timeout` を返す。
  呼び出し側は要件3.11に従い無効な識別要求として扱いゲートを開けない。
  ネットワーク往復がないため通常は数ms〜数十msで返る見込み

---

## 3. API 契約

型はフェーズ0の `src/types/api.ts`（凍結）が正。以下は要件から導いた必要項目。

### POST /api/auth/identify

```
入力: { vector: number[128], purpose: "entry" | "payment" | "pass" }
出力: { result: "matched" | "none" | "ambiguous" | "timeout", accountId?, score?, candidateCount?, populationSize? }
400 : purpose不正（要件11.2/11.3）/ 次元数不一致・非有限値
```

要件11.6準拠のため、応答にベクトル要素を一切含めない。`score` は表示用（距離から導出）で判定には用いない。

### POST /api/entry

```
入力（顔）  : { vector: number[128], purpose: "entry" }
入力（手動）: { manual: true, accountId, operatorId }        要件3.12
出力: { open: true,  sessionId, reentry: boolean }
    | { open: false, reason: "none" | "ambiguous" | "no_valid_pass" | "timeout" }
```

処理順:

1. `identify({ purpose: "entry" })`
2. `none` / `ambiguous` / `timeout` → 各理由で拒否。**いずれもセッション非生成**（要件3.6, 3.7, 3.11）
3. 当日有効な入浴券なし → `no_valid_pass`、セッション非生成（要件3.8, 4.7）
4. 既存ACTIVEセッションあり → **新規生成せずACTIVEを維持**し `reentry: true` で開放（要件3.9, 4.1, 4.2）
5. 既存なし（初回 / CLOSED / FORCE_CLOSED後）→ ACTIVEで新規1件生成、入場時刻を秒精度で記録（要件3.4, 4.4）
6. 開放時に `Session.passHistory` へ `{gate:"ENTRY", at}` を時刻昇順で追記（要件4.3）
7. `manual: true` は識別を経ずACTIVE生成し、手動開放である旨と操作者を記録（要件3.12）

要件4.6により**再試行回数を制限しない**。連続失敗はUI通知（要件3.13）のためにカウントするだけで、拒否条件にしない。

### POST /api/exit

```
入力: { vector: number[128] }
出力: { open: true,  sessionId, state: "CLOSED", exitedAt, balance, expireAt }
    | { open: true,  inconsistent: true }                      要件8.4
    | { open: false, reason: "unidentified" }                  要件8.5
```

処理順:

1. `identify({ purpose: "entry" })`
2. ACTIVEセッションあり → `CLOSED` に更新、識別時刻を秒精度の `exitedAt` として記録（要件8.1）
3. `computeExpireAt()` で当該アカウントの全テンプレートに `expireAt` を設定（要件8.2）
4. `passHistory` へ `{gate:"EXIT", at}` 追記、残高を応答に含める（要件4.3, 8.3）
5. ACTIVEセッションなし → **ゲートは開ける**。状態は一切変更せず、accountId・識別時刻・直近セッション状態を
   セッション不整合として監査記録（要件8.4）
6. 識別不成立が同一来場者で3回連続 → ゲート閉鎖維持、未識別退場試行を監査記録（要件8.5）

要件8.4（識別できたがACTIVEなし→開ける）と要件8.5（識別できない→閉鎖維持）は逆の挙動になる。
閉じ込め防止と不正退場防止のトレードオフを要件がこう裁定しているので、そのまま実装する。

---

## 4. Retention 設計（`src/lib/retention/`）

### 4.1 保管期限算定

```
computeExpireAt(exitedAt, retentionDays) = exitedAt + retentionDays * 86_400_000 ms
retentionDays = Account.retentionDays（既定7、顧客指定1〜90）
```

CLOSED（要件8.2）と FORCE_CLOSED（要件8.8）で同一関数を使う。FORCE_CLOSED の `exitedAt` は閉場時刻。
範囲外の `retentionDays` は算定側でも例外にして二重に防ぐ（入力検証本体はC担当、要件10.3）。

### 4.2 削除の二重化

| 経路 | 契機 | 要件 |
|---|---|---|
| 同期削除（本体）`deleteTemplate.ts` | 同意撤回・利用者削除要求の時点で即delete | 10.7, 1.12 |
| 走査（保険）`scanner.ts` | setInterval デモ1分周期 + 手動発火で `expireAt <= now` を即削除 | 10.4, 10.5 |

要件上は「24時間以内」なので同期削除は要件を満たす（より厳しい側）。
走査はプロセス内 `setInterval` で起動し、開発時のHMR再実行による多重起動を防ぐためグローバルシングルトンでguardする。

### 4.3 要件10.8（ACTIVE中の削除要求は延期）— フィールド追加なしで実現

削除要求時に `expireAt = now` を書き込み、走査側で「当該アカウントにACTIVEセッションがあればスキップ」とする。
これで ACTIVE中は延期され、CLOSED/FORCE_CLOSED 遷移後の最初の走査（最大1分）で削除される。
`deletePending` フラグを新設せずに済むため、凍結スキーマを変更しなくてよい。

要件10.10（削除失敗時の最大3回リトライ）は単一プロセス前提なので走査側のメモリ上でカウントする。

### 4.4 削除の制約

- 削除対象は `FaceTemplate` のみ。`Account.balance` / `cardToken` / `Pass` / 取引記録は触らない（要件2.9, 10.9）
- 削除時に「削除日時・accountId・契機（期限経過 | 利用者要求）」を監査記録。テンプレート内容は記録しない（要件10.6）

---

## 5. 担当プロパティ（design.md 準拠 / fast-check `{numRuns:100}`）

各テストに `Feature: face-auth-onsen-entry, Property N: ...` のタグコメントを付す。

### Property 2: 1:N識別の件数判定整合

> *For any* 母集団と入力ベクトルについて、閾値未満の件数と none / matched / ambiguous の判定が厳密に対応する。

**Validates: Requirements 3.4, 3.6, 3.7, 5.5, 5.7**
実装: `src/lib/auth/identify.property.test.ts`

生成方針: 母集団件数 0〜500、1アカウントあたりテンプレート1〜5件、距離を閾値の上下に散らす、
境界値 `distance === 0.5` を必ず含める（不一致側に落ちること）。
検証: 閾値未満のアカウント数 n に対し n=0→`none`、n=1→`matched`、n≥2→`ambiguous` が例外なく成立。
アカウント代表距離が最小距離であること。

### Property 11: 退場によるセッション遷移

> *For any* ACTIVE セッションについて、退場を適用すると CLOSED になり退場時刻が記録される。

**Validates: Requirements 8.1**
実装: `src/lib/auth/exit.property.test.ts`

生成方針: 任意の入場時刻・退場時刻・通過履歴長。
検証: 遷移後 state が必ず `CLOSED`、`exitedAt` が非null かつ秒精度で識別時刻と一致。
併せて `expireAt = exitedAt + retentionDays` の算定（要件8.2）も同テスト内で確認する。

### Property 12: 削除後の照合不成立

> *For any* 同期削除後のアカウントについて、削除で用いたベクトルで identify しても当該アカウントに一致しない。

**Validates: Requirements 10.4, 10.7**
実装: `src/lib/retention/deleteTemplate.property.test.ts`

生成方針: アカウント数1〜10、各1〜5テンプレート、削除契機（期限経過 / 利用者要求）、セッション状態。
検証: 削除完了後の identify で当該アカウントが結果に現れない。
併せて削除後も残高・カードトークン・利用権・取引記録が削除前と一致すること（要件10.9）、
ACTIVE中の削除要求は延期されテンプレートが残ること（要件10.8）を確認する。

---

## 6. 要確認事項

### 6.1 【要判断】退場時に同期削除するのか、`expireAt` を置くだけなのか — 要件と衝突している

design.md の Retention_Service は「同期削除（本体）= **退場**・同意撤回・利用者要求の時点で該当FaceTemplate即delete」
と書き、デモ背骨のシーケンス図も退場直後に同期削除を置いている。
一方 tasks.md タスク10 は退場で `expireAt = 退場時刻 + retentionDays` を設定するとしている。

両方やると `expireAt`（既定7日後）が無意味になり、**要件10.1/10.2（保管期間は退場時刻起点で1〜90日）に違反する**。
退場した瞬間に顔データが消えるのは、保管期間という要件の中核概念そのものを潰してしまう。

推奨: 退場は `expireAt` 設定のみ（要件8.2どおり）。デモの「顔が消える」は退場画面に置いた
**明示的な削除操作**（= 要件10.7の利用者要求、要件10.12の確認操作つき）で見せる。
タップが1回増えるだけで、デモ背骨「退場→顔が消える→同じ顔で再入場失敗」は成立し、要件違反も起きない。
むしろ「利用者が自分の意思で消せる」ことを見せられるので、主張としても強い。

この判断はフェーズ0凍結より前に確定させたい（`/api/exit` の応答型に削除結果を含めるかが変わる）。

### 6.2 その他

| 項目 | 内容 | 決定者 |
|---|---|---|
| 閾値の不等号 | design.mdは「0.5未満」。要件文の「スコア≥閾値」との読み替え（2.1節）をB/Cとも共有したい。`identify` は3担当が使う | 全体 |
| 要件8.6〜8.9 の実行主体 | 閉場+猶予の自動FORCE_CLOSEDが未割当。Aは `computeExpireAt` を公開するのみ | 全体 |
| 閉場時刻・営業日境界 | 上記スケジュールと要件3.2「当日」判定の境界に必要 | 全体 |
| B/Cへの依存関数 | 入浴券判定・残高取得・監査追記のシグネチャ確定 | B, C |
| `Session.passHistory` がJson | 要件4.3の件数上限なしは満たせるが、read-modify-write が並行すると追記が失われる。単一プロセスSQLiteのMVPでは許容する認識で合っているか | フェーズ0 |
