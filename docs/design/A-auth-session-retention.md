# [担当A] 認証・セッション・削除 — 要件整理と設計

Issue: #4 / ブランチ: `feat/A-auth-session-retention` / 依存: #3 (Phase0 共有カーネル)
対象要件: 要件3（入場認証とセッション開始）、要件4（再入場）、要件8（退場とセッション終了）、要件10（保管期間と自動削除）

参照: `.kiro/specs/face-auth-onsen-entry/requirements.md`

---

## 0. 現況と着手条件

Phase0（#3）は計画docのみで、`package.json` / `prisma/schema.prisma` / `src/types/` が未生成。
凍結対象が存在しないため実装着手不可。本ドキュメントは着手前に確定させるべき事項をまとめたもの。

**Phase0 凍結前に本ドキュメントの2章（スキーマ要求）を反映してもらう必要がある。**
凍結後は変更依頼が一元化されるため、A担当の必要フィールドが欠けた状態で凍結されると入退場フローが組めない。

---

## 1. 責務境界

### 所有（他担当は触らない）

| パス | 内容 |
|---|---|
| `src/lib/auth/` | Auth_Service（ユークリッド距離・母集団構築・1:N識別） |
| `src/app/api/auth/` | `/api/auth/identify` |
| `src/app/api/entry/` | `/api/entry`（入場・再入場） |
| `src/app/api/exit/` | `/api/exit`（退場） |
| `src/lib/retention/` | Retention_Service（保管期限算定・同期削除・走査） |

### 他担当から借りるもの（read-onlyまたは関数呼び出しのみ。実装は相手側）

| 依存先 | 必要なもの | 用途 | 担当 |
|---|---|---|---|
| `src/lib/audit/` | `appendAudit(entry)` | 要件8.4/8.5/10.6/11.10 の監査追記 | C |
| `src/lib/codec/` | `decodeTemplate(bytes)` → `Float64Array(128)` / `validate()` | 母集団テンプレートの復元 | C |
| `src/lib/account/` | `hasValidBathPass(accountId, businessDate)` | 要件3.8 の当日有効入浴券判定 | B |
| `src/lib/account/` | `getBalance(accountId)` | 要件8.3 の退場時残高表示 | B |
| `src/types/` | `Purpose` / `SessionState` / `FaceDescriptor` / API型 | 全体 | Phase0 |

Phase0のスタブ（501返却）段階では、上記のうち `decodeTemplate` / `hasValidBathPass` / `getBalance` / `appendAudit` を
A側でローカルなフォールバック実装なしに扱うと開発が止まる。**Phase0で最小の実体（throwではなく素朴な実装）を用意してもらう**か、
A側で `src/lib/auth/__contracts__.ts` に型のみ再宣言して差し替え可能にする。後者を初期方針とする。

### 明確にAの担当外

- 要件3.5（ゲート物理開閉のUI表示）、要件3.13（係員呼出通知の表示）→ 端末UIはC担当。APIは判定結果と `reason` を返すのみ
- 要件8.6〜8.9（閉場+60分の自動 FORCE_CLOSED）→ 実行主体が未割当。**ただし退場時刻からの `expireAt` 算定（要件8.8）はAの `src/lib/retention/` が関数として公開し、実行側から呼ばせる**
- 要件8.10/8.11（Admin_Consoleからの手動CLOSED）→ Admin APIはC担当。同上で算定関数を公開する

---

## 2. Phase0 凍結スキーマへの要求

要件3/4/8/10を満たすために最低限必要なフィールド。これが無いと実装できない。

### Prisma models

```prisma
model Account {
  id            String   @id                  // ULID
  retentionDays Int      @default(7)          // 要件10.1/10.2: 基本7日, 顧客指定1〜90日
  createdAt     DateTime
  // balance, cardToken 等はB担当が追加
  templates FaceTemplate[]
  sessions  Session[]
}

model FaceTemplate {
  id           String    @id
  accountId    String
  vector       Bytes                          // 要件1.8: 平文で外部に出さない。codec経由でのみ復元
  codecVersion String                         // 要件13.8 / 9.10: 非対応バージョンは母集団から除外
  registeredAt DateTime                       // 要件9.4: 最古判定の基準
  seq          Int                            // 要件9.4: registeredAt同値時の登録順タイブレーク
  businessDate String                         // 要件3.2: 「当日登録済み」母集団の判定に必須
  expireAt     DateTime?                      // 要件8.2: 退場時に算定。未退場ならnull
  deletePending Boolean  @default(false)      // 要件10.8: ACTIVE中の削除要求を延期
  retryCount   Int       @default(0)          // 要件10.10: 削除失敗リトライ最大3回

  @@index([expireAt])                         // 要件10.5: 期限走査
  @@index([accountId])
}

model Session {
  id           String   @id
  accountId    String
  state        String                          // ACTIVE | CLOSED | FORCE_CLOSED
  businessDate String                          // 要件3.2/8.6
  entryTime    DateTime
  exitTime     DateTime?
  manualEntry  Boolean  @default(false)        // 要件3.12
  passages     Passage[]

  @@index([accountId, state])                  // 要件3.9: ACTIVE存在確認
  @@index([state, businessDate])               // 要件3.2母集団 / 要件8.6一括更新
}

model Passage {
  id        String   @id
  sessionId String
  gateType  String                             // ENTRY | EXIT
  at        DateTime
  @@index([sessionId, at])                     // 要件4.3: 時刻昇順・件数上限なし
}
```

**要点3つ**

1. `FaceTemplate.businessDate` — 要件3.2の母集団は「当日ACTIVE ∪ **当日登録済み**」。登録日が持てないと母集団が作れない
2. `FaceTemplate.seq` — 要件9.4は `registeredAt` 同値時に「登録順が先の1件」を削除と規定。DateTime だけでは決定的にならない
3. `Passage` を `Session` と別テーブルに — 要件4.3が追記件数無制限を要求するため、Sessionへの配列埋め込み不可

### `src/types/`

```ts
// 要件11.1/11.2: この3値以外の照合要求は拒否
export type Purpose = 'ENTRY_AUTH' | 'PAYMENT_MATCH' | 'PASS_VERIFY';
export type SessionState = 'ACTIVE' | 'CLOSED' | 'FORCE_CLOSED';
export type GateType = 'ENTRY' | 'EXIT';

export const DESCRIPTOR_DIM = 128;
export type FaceDescriptor = Float64Array;   // 長さ128, 全要素有限（要件13.3の「有効な」定義）
```

---

## 3. Auth_Service 設計（`src/lib/auth/`）

### 3.1 スコアと閾値の向き — 要件文との読み替えを明文化する

要件は一貫して「**識別スコアが識別スコア閾値以上**なら一致」（要件3.4, 5.2, 9.5, 9.10）と書かれている。
一方でチーム決定は「ユークリッド距離・閾値0.5」。距離は小さいほど似ているので、**不等号の向きが逆**になる。

実装上の定義を以下に固定する。

```
distance(a, b) = sqrt(Σ (a_i - b_i)^2)      // 128次元
一致条件        : distance <= 0.5            // = THRESHOLD
アカウントの代表: min(distance) over 最大5件のテンプレート   // 要件9.5「最高スコア採用」の距離版
```

要件文の「スコア≥閾値」は「距離≤0.5」と等価として扱う。API応答には `distance` を返し、
互換のため `score = 1 - distance`（表示用）も返すが、判定には `distance` のみを用いる。
face-api.js の慣例的な既定値は 0.6 で、0.5 はそれより厳しい設定（他人受入を抑え、本人拒否は増える）。
デモで本人拒否が目立つ場合は 0.55〜0.6 への調整余地があるため、閾値は定数1箇所に置く。

### 3.2 母集団の構築 — purposeで範囲が変わる

要件3.2 と 要件5.1 は母集団の定義が異なる。同一関数で切り替える。

| purpose | 母集団 | 根拠 |
|---|---|---|
| `ENTRY_AUTH` | 当日ACTIVEセッションを持つアカウント ∪ 当日登録済みアカウント | 要件3.2 |
| `PAYMENT_MATCH` | ACTIVEセッションを持つアカウントのみ | 要件5.1 |
| `PASS_VERIFY` | ACTIVEセッションを持つアカウントのみ | 要件7.2（施設内での判定のため） |

共通制約:

- 件数上限 500（`POPULATION_LIMIT`）。要件3.2 / 5.1 / 14.6 / 14.7 が同一の値を参照
- `codecVersion` が非対応のテンプレートは**そのテンプレートのみ**除外し、同一アカウントの対応版は残す（要件9.10）
- 削除済みテンプレートは即座に母集団から外れる（同一DBを引くため、要件10.11の「60秒以内」は自動的に満たす）

### 3.3 判定分岐

`distance <= 0.5` を満たすアカウントの件数 n で分岐する。

| n | 結果 | 要件 |
|---|---|---|
| 0 | `NO_MATCH` — 再登録案内 | 3.6, 5.5, 9.10 |
| 1 | 一致確定 → accountId を返す | 3.4, 5.2 |
| ≥2 | `AMBIGUOUS` — 係員対応。セッション生成せず残高も動かさない | 3.7, 5.7 |

### 3.4 タイムアウト

要件3.3（画像取得から2秒）、要件9.5（受付から1.5秒）、要件5.1（撮影完了から3秒）。
`identify()` 内で `Promise.race` により **1.5秒**で打ち切り、`TIMEOUT` を返す。
呼び出し側（/api/entry）は要件3.11に従い、TIMEOUTを無効な識別要求として扱いゲートを開けない。

### 3.5 purpose検証（要件11.2）

`identify()` の入口で `purpose` が上記3値のいずれかであることを検証。不一致なら照合を実行せず
`PURPOSE_NOT_ALLOWED` を返し、要件11.10に従い監査ログへ「要求元・判定結果・拒否事由」を記録する。
テンプレートの値そのものは監査ログに入れない（要件14.4, 13.7）。

---

## 4. API 契約

### POST /api/auth/identify

```ts
// Request
{ purpose: Purpose; descriptor: number[] /* len 128 */; businessDate: string /* YYYY-MM-DD */ }

// 200
| { matched: true;  accountId: string; distance: number; score: number; populationSize: number }
| { matched: false; reason: 'NO_MATCH' | 'AMBIGUOUS'; candidateCount: number; populationSize: number }
// 403 { error: 'PURPOSE_NOT_ALLOWED' }        要件11.2
// 408 { error: 'TIMEOUT' }                     要件3.11
// 422 { error: 'INVALID_DESCRIPTOR' }          次元数不一致・非有限値
```

要件11.6準拠のため、応答にテンプレート値・ベクトル要素を一切含めない。

### POST /api/entry

```ts
// Request（顔認証）    { descriptor: number[]; gateId: string; businessDate: string }
// Request（係員手動）  { manual: true; accountId: string; gateId: string; businessDate: string; operatorId: string }

// 200
| { open: true;  sessionId: string; reentry: boolean; passageCount: number }
| { open: false; reason: 'NO_MATCH' | 'AMBIGUOUS' | 'NO_VALID_PASS' | 'TIMEOUT'; message: string; consecutiveFailures: number }
```

処理順:

1. `identify({ purpose: 'ENTRY_AUTH' })`
2. n=0 → `NO_MATCH` / n≥2 → `AMBIGUOUS` / TIMEOUT → `TIMEOUT`。いずれもセッション非生成（要件3.6, 3.7, 3.11）
3. `hasValidBathPass()` false → `NO_VALID_PASS`、セッション非生成（要件3.8, 4.7）
4. 既存ACTIVEセッションあり → **新規生成せずACTIVEを維持**し `reentry: true` で開放（要件3.9, 4.1, 4.2）
5. 既存なし（初回 / CLOSED / FORCE_CLOSED後）→ ACTIVEで新規1件生成、`entryTime` を秒精度で記録（要件3.4, 4.4）
6. 開放時は `Passage(gateType: 'ENTRY')` を追記（要件4.3）
7. `manual: true` の場合は識別を経ずACTIVE生成、`manualEntry` と `operatorId` を記録（要件3.12）
8. 連続失敗回数を `gateId` 単位でカウントし応答に含める。3回で係員呼出（表示はUI側、要件3.13）

`consecutiveFailures` は要件4.6により**再試行回数を制限しない**。カウントは通知のためだけに使い、拒否条件にしない。

### POST /api/exit

```ts
// Request { descriptor: number[]; gateId: string }

// 200
| { open: true;  sessionId: string; state: 'CLOSED'; exitTime: string; balance: number; expireAt: string }
| { open: true;  inconsistent: true; message: string }                          要件8.4
| { open: false; reason: 'UNIDENTIFIED'; consecutiveFailures: number }           要件8.5
```

処理順:

1. `identify({ purpose: 'ENTRY_AUTH' })`（退場も入場認証目的の範囲内。母集団はACTIVE∪当日登録）
2. ACTIVEセッションあり → `state='CLOSED'`、識別時刻を秒精度の `exitTime` として記録（要件8.1）
3. 続けて `computeExpireAt()` を呼び、当該アカウントの全テンプレートに `expireAt` を設定（要件8.2）
4. `Passage(gateType: 'EXIT')` 追記、`getBalance()` を応答に含める（要件4.3, 8.3）
5. ACTIVEセッションなし → **ゲートは開ける**。状態は一切変更せず、accountId・識別時刻・直近セッション状態をセッション不整合として監査記録（要件8.4）
6. 識別不成立が同一来場者で3回連続 → ゲート閉鎖維持、未識別退場試行を監査記録（要件8.5）

要件8.4の「識別できたがACTIVEが無い場合はゲートを開ける」は、要件8.5の「識別できない場合は閉鎖維持」と
逆の挙動になる。閉じ込め防止と不正退場防止のトレードオフを要件がこう裁定しているので、そのまま実装する。

---

## 5. Retention 設計（`src/lib/retention/`）

### 5.1 保管期限算定

```
computeExpireAt(exitTime, retentionDays) = exitTime + retentionDays * 86_400_000 ms
retentionDays = Account.retentionDays（既定7、顧客指定は1〜90にクランプせず範囲外は呼び出し前に拒否）
```

CLOSED（要件8.2）と FORCE_CLOSED（要件8.8）で同一関数を使う。FORCE_CLOSED の場合 `exitTime` は閉場時刻。
範囲外の `retentionDays` の入力検証（要件10.3）は登録端末側（C担当）だが、
算定関数側でも 1〜90 を外れた値は例外にして二重に防ぐ。

### 5.2 削除の二重化

| 経路 | 契機 | 要件 |
|---|---|---|
| 同期削除（本体） | 来場者の削除要求確定時／同意撤回時に即座に削除 | 10.7, 1.12 |
| `setInterval` 走査（保険） | 60分以内の間隔で `expireAt <= now` を全件検出し削除 | 10.4, 10.5 |

同期削除を本体に置くのは、デモで「削除 → 即座に再入場失敗」を見せるため。
走査だけだと最大60分待つことになり、デモ背骨（入場→外出→再入場→別室→退場→削除→再入場失敗）が成立しない。
要件上は「24時間以内」なので同期削除は要件を満たす（より厳しい側）。

走査は Next.js のプロセス内 `setInterval` で起動する。サーバーレス環境では動作保証がないが、
ハッカソンのローカル/単一プロセス実行前提なので許容する。多重起動を防ぐため
グローバルシングルトンで guard する（開発時のHMR再実行で複数走るのを避ける）。

### 5.3 削除の制約

- **ACTIVEセッション中は削除しない**。`deletePending=true` を立てて延期し、CLOSED/FORCE_CLOSED遷移後に削除（要件10.8）
- 削除対象は `FaceTemplate` のみ。`Account.balance` / `cardToken` / `Pass` / `Transaction` は触らない（要件2.9, 10.9）
- 削除時に「削除日時・accountId・契機（EXPIRED | USER_REQUEST）」を監査記録。テンプレート内容は記録しない（要件10.6）
- 削除失敗時は `retryCount` を加算し60分間隔で最大3回。3回失敗で削除待ち維持のまま管理者通知（要件10.10）

---

## 6. プロパティテスト P2 / P11 / P12（fast-check, 各100反復）

### 番号付けについての注意

リポジトリ内に P1〜P12 の正典リストが存在しない。`.kiro/specs/.../tasks.md` は Property 1〜5 の
別体系（P1=テンプレート件数、P2=残高範囲、…）を定義しており、チーム分担の P1〜P12 とは番号が一致しない。
分担docから逆算すると A=P2/P11/P12、B=P3/P4/P5/P10、C=P1/P6/P7/P8/P9 で12個が過不足なく埋まるため、
**要件番号順に並べた12個の体系**と解釈し、A担当分を以下に定義する。
正典リストが出てきたら定義を差し替える。

### P2: 再入場不変条件

> ACTIVEセッションが存在する間、同一アカウントによる入場通過を任意回数（1〜N回）行っても、
> (a) すべての通過判定結果は1回目と一致して開放となり、
> (b) 当該アカウントのSessionレコードは常に1件のみでstateはACTIVEを維持し、
> (c) Passageは通過ごとに正確に1件増加してatは昇順であり、件数に上限が現れない。

Validates: 要件3.9, 4.1, 4.2, 4.3
生成する任意値: 通過回数（1〜50）、通過間隔、ゲートID列

### P11: 保管期限算定の正確性と単調性

> 任意の退場時刻 t と保管日数 d ∈ [1,90] について、
> (a) 算定される expireAt は t + d日 に厳密一致し（誤差なし）、
> (b) d1 < d2 ⟹ expireAt(t,d1) < expireAt(t,d2) が成り立ち（単調性）、
> (c) CLOSED経路と FORCE_CLOSED経路で同一の t, d を与えた結果は一致する。

Validates: 要件8.2, 8.8, 10.1, 10.2
生成する任意値: 退場時刻（うるう年・月末・DST境界を含む）、d ∈ [1,90]、未指定時の既定7

### P12: 削除後の照合不成立と付随データ保持

> 任意のアカウント集合と削除操作列について、
> (a) 削除完了後は当該アカウントのdescriptorで identify しても matched=false となり（母集団から除外）、
> (b) 削除後も balance / cardToken / Pass / Transaction は削除前と完全に一致し、
> (c) ACTIVEセッションを持つアカウントへの削除要求は延期され、テンプレートは残存し、
>     セッション終了後の削除で初めて (a) が成立する。

Validates: 要件10.4, 10.8, 10.9, 10.11
生成する任意値: アカウント数（1〜10）、テンプレート数（1〜5）、セッション状態、削除契機

---

## 7. 未決事項

| 項目 | 内容 | 必要な決定者 |
|---|---|---|
| Phase0スキーマ | 2章のフィールド（特に `FaceTemplate.businessDate` / `seq`、`Passage` テーブル分離）を凍結前に反映 | Phase0担当 |
| P1〜P12 正典リスト | 番号定義がリポジトリに無い。6章の解釈で進めるが、正典があれば提示してほしい | 全体 |
| 閾値0.5の向き | 要件文「スコア≥閾値」と距離ベース判定の読み替え（3.1節）を全担当で合意したい。B/Cも同じ `identify` を使う | 全体 |
| 要件8.6〜8.9 の実行主体 | 閉場+60分の自動FORCE_CLOSEDが誰の担当か未割当。Aは `computeExpireAt` を公開するのみ | 全体 |
| 閉場時刻 | 上記cron設定と営業日境界の定義に必要 | 全体 |
| B/Cへの依存関数 | `hasValidBathPass` / `getBalance` / `appendAudit` / `decodeTemplate` のシグネチャ確定 | B, C |
