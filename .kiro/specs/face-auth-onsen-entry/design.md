# Design Document (AWS構成 / A案: Amazon Rekognition採用)

## 0. 前提と割り切り

ハッカソンの時間内で要件をすべて厳密に満たすことは不可能なため、以下を明示的にスコープ外とする。

| 要件 | 割り切り内容 |
|---|---|
| 要件13(Template_Codec自前実装) | 対応しない。特徴量ベクトルはRekognition Collection内部で管理され、外部から取り出せないため、自前エンコード/デコードのラウンドトリップ特性を実装・検証する対象が存在しない。デコード/エンコード相当の処理はRekognition APIの呼び出しに置き換える |
| 要件11.4(第三者への提供禁止) | Rekognition(AWSのマネージドサービス)への画像送信は「自社Template_Store以外への保管」ではなく「特徴量算出の委託」と解釈する。画像バイト自体はRekognitionが保存しないため、実質的にTemplate_Storeに相当するデータの保存場所はRekognition Collection(東京リージョン)のみとなる |
| 端末認証(mTLS等) | ハッカソンでは端末ごとのAPIキー(API Gateway API Key + Usage Plan)で代替。本番相当のmTLS/証明書ベース認証は行わない |
| QLDB相当の暗号学的検証可能な追記専用ログ | QLDBは新規利用不可のため、DynamoDB + IAMポリシーでUpdateItem/DeleteItemを拒否する運用で代替。暗号学的な改ざん検証(ハッシュチェーン等)は行わない |
| 決済事業者連携 | Stripe(テストモード)を想定し、カード情報はStripe側でトークン化(要件2.7に合致)。本番決済網の実連携はしない |

これ以外の要件は下記構成で対応する。

## 1. 全体構成図

```
[来場者/係員端末: ブラウザ]
        │
        ▼
[Next.js on AWS Amplify Hosting] ── Enrollment/Entry/Exit/Service Terminal UI, Admin_Console UI
        │ (Amplify Hostingが払い出すCloudFront経由)
        ▼
[Amazon API Gateway (HTTP API)]
   ├─ /admin/*        → Cognito Authorizer必須
   ├─ /terminal/*      → APIキー(Usage Plan)必須
        │
        ▼
[Lambda (Node.js 20.x, ドメイン単位でLambdalith)]
   ├─ enrollmentFn   : 顔登録/削除、同意記録
   ├─ authFn         : 1:N識別 (Rekognition SearchUsersByImage)  ★Template参照はここのみ
   ├─ sessionFn      : 入退場、滞在セッション管理
   ├─ accountFn      : 残高・カード・チャージ・払い出し
   ├─ paymentFn       : 施設内決済 (authFn呼び出し→accountFn呼び出し)
   ├─ entitlementFn  : 利用権購入・検証
   ├─ retentionFn    : 期限切れテンプレート削除 (EventBridge起動) ★Template参照はここのみ
   ├─ forceCloseFn   : 閉場+60分後の強制クローズ (EventBridge起動)
   └─ adminApiFn     : 一覧表示・監査ログ参照 (Cognito必須)
        │
        ├─→ Amazon Rekognition (Collection, ap-northeast-1) ← 顔特徴量の実体
        ├─→ Amazon DynamoDB (Accounts/Sessions/Consent/TemplateMeta/Transactions/Entitlements/AuditLogs/DailyRegistry)
        ├─→ AWS KMS (CMK: テンプレート関連メタデータ及び個人情報の暗号化)
        ├─→ Amazon EventBridge Scheduler (定期実行)
        └─→ Stripe API (外部, カード決済)

[Amazon Cognito User Pool] ── 係員(Admin_Console)ログイン
```

## 2. Auth_Service の中核設計: Rekognition Collection の運用方法

これが要件適合の最大のポイントになる。Rekognitionの「User」機能(1人物に複数FaceIdを束ねる仕組み)を、要件の「アカウント=複数テンプレート」構造にそのままマッピングする。

### 2.1 マッピング

| 要件上の概念 | Rekognitionの実体 |
|---|---|
| アカウント | Rekognition `UserId` (= アカウントIDを流用) |
| 顔特徴量テンプレート1件 | Rekognition `FaceId` (1つのUserIdに最大5つAssociate) |
| 1:N識別 | `SearchUsersByImage(CollectionId, Image, UserMatchThreshold)` |
| 識別対象母集団 | Collection内に存在するUserの集合 |

### 2.2 母集団を「当日分・500件以内」に絞る方法

Rekognitionには「検索対象をUserIdのサブセットに絞る」パラメータが存在しないため、**Collection自体を日次で使い切る運用**にする。

- 営業日開始時にCollectionを新規作成(`onsen-face-{businessDate}`)、または前営業日終了後に全User削除でクリア
- 顔登録(要件1)時: `IndexFaces` → `CreateUser(UserId=accountId)` → `AssociateFaces` を実行し、`DailyRegistry`テーブル(PK: businessDate, SK: accountId)へ登録。これでCollection内User数 = 当日登録済みアカウント数となり、要件3.2の母集団定義と一致する
- 退場(要件8)時: Userは削除しない(要件4で「CLOSED後も当日中の再入場」があり、当日登録済みなら母集団に残る必要があるため)
- 識別対象母集団上限500件(要件3.2, 5.1, 14.6, 14.7): `DailyRegistry`のitem数をDynamoDB側でカウントし、500件到達時は`enrollmentFn`が新規登録を拒否し、Admin_Console向けに90%/100%警告を`adminApiFn`が算出して返す

### 2.3 1アカウント最大5テンプレート・最高スコア採用(要件9)

- `AssociateFaces`で6件目を追加する前に`ListFaces(UserId)`で件数確認
- 5件に達している場合、`TemplateMeta`テーブルから登録日時最古の`faceId`を特定し、`DisassociateFaces`→`DeleteFaces`で削除してから新規`AssociateFaces`を実行(要件9.4のロールバック要件に対応するため、DynamoDB側の状態更新は削除・追加の両方が成功した後にコミットする)
- `SearchUsersByImage`はUser単位で内部的に全FaceIdのうち最高スコアを返す仕様のため、要件9.5(最高スコア採用)はRekognition側の挙動にそのまま合致する

### 2.4 レイテンシ要件との対応

- 要件3.3(顔画像取得から2秒以内)、要件5.1(撮影完了から3秒以内)、要件9.5(受付から1.5秒以内): `SearchUsersByImage`は500件規模のCollectionであれば数百ms〜1秒程度で応答するのが一般的だが、実測が必須。ハッカソンのデモ環境(実来場者数十名規模)であれば十分に余裕がある
- コールドスタート対策: `authFn`は同時実行数の最低保持(Provisioned Concurrency)をデモ直前に有効化する運用で吸収する(常時有効化はコスト増のため、実演時のみ)

## 3. DynamoDBテーブル設計

全テーブル `ap-northeast-1`、暗号化はKMS CMK(後述)。オンデマンド課金モード。

| テーブル | PK | SK | 主な属性 | 補足 |
|---|---|---|---|---|
| Accounts | accountId | - | balance, cardToken, retentionDays, deletionStatus, createdAt | 要件2, 12 |
| Sessions | sessionId | - | accountId, status(ACTIVE/CLOSED/FORCE_CLOSED), entryTime, exitTime | GSI: accountId-status-index(状態確認), GSI: status-businessDate-index(FORCE_CLOSE一括更新用) |
| PassageHistory | sessionId | timestamp | gateType(ENTRY/EXIT) | 要件4.3、追記件数無制限に対応するため別テーブルに分離 |
| ConsentRecords | accountId | consentType#timestamp | consentItemId, screenVersion, revokedAt | 要件1.2, 1.4 |
| TemplateMeta | accountId | faceId | rekognitionUserId, registeredAt, retentionDeadline, encoderVersion | 要件13の代替。**読み出しIAMはauthFn/retentionFnのロールのみに付与**(要件11.5) |
| DailyRegistry | businessDate | accountId | registeredAt | 母集団カウント用(2.2節) |
| Transactions | accountId | transactionId | amount, type(CHARGE/PAYMENT/WITHDRAW), idempotencyKey, terminalId | 要件5.6の冪等性は`idempotencyKey`に対する条件付き書き込み(`attribute_not_exists`)で保証 |
| Entitlements | accountId | entitlementType | validUntil, status | 要件7 |
| AuditLogs | logId(ULID) | timestamp | actorId, action, target, result, reason | 追記専用、下記IAMポリシーでUpdate/Delete拒否 |

### 追記専用ログの実装(要件14.4, 11.10)

IAMポリシーで、AuditLogsテーブルに対する`dynamodb:UpdateItem`と`dynamodb:DeleteItem`をすべてのLambdaロールに対して明示的に`Deny`する。`PutItem`のみ許可。これにより、コード上のバグで削除・改変を試みても権限レベルで拒否される。1年以上の保管はTTL属性を設定しない(自動削除させない)ことで対応。

## 4. IAM設計の要点(要件11.5対応)

- `authFnRole`: `TemplateMeta`テーブルへの`GetItem`/`Query`、Rekognition `SearchUsersByImage`/`IndexFaces`/`CreateUser`/`AssociateFaces`/`ListFaces`
- `retentionFnRole`: `TemplateMeta`テーブルへの`GetItem`/`Query`/`DeleteItem`、Rekognition `DeleteFaces`/`DeleteUser`/`DisassociateFaces`
- 他の全Lambdaロール(`sessionFn`, `accountFn`, `paymentFn`, `entitlementFn`, `adminApiFn`等)には`TemplateMeta`への`dynamodb:*`権限を一切付与しない。IAMポリシーは許可リスト方式(付与しない=拒否される)のため、要件11.3(目的外参照の拒否)は「そもそも権限がない」形で満たす
- KMS CMKの`kms:Decrypt`も同様に`authFnRole`/`retentionFnRole`のみに許可

## 5. Lambda関数一覧とAPIルート

| ルート | メソッド | Lambda | 認証 | 対応要件 |
|---|---|---|---|---|
| /terminal/enroll | POST | enrollmentFn | APIキー | 1, 9 |
| /terminal/enroll/revoke | POST | enrollmentFn | APIキー | 1.12, 10.7 |
| /terminal/account | POST | accountFn | APIキー | 2 |
| /terminal/account/charge | POST | accountFn | APIキー | 2, 6 |
| /terminal/account/card | POST | accountFn | APIキー | 2 |
| /terminal/account/withdraw | POST | accountFn | APIキー | 12 |
| /terminal/session/entry | POST | sessionFn(→authFn同期呼び出し) | APIキー | 3, 4 |
| /terminal/session/exit | POST | sessionFn(→authFn同期呼び出し) | APIキー | 8 |
| /terminal/payment | POST | paymentFn(→authFn, accountFn呼び出し) | APIキー | 5 |
| /terminal/entitlement/purchase | POST | entitlementFn | APIキー | 7 |
| /terminal/entitlement/verify | POST | entitlementFn(→authFn呼び出し) | APIキー | 7 |
| /admin/sessions | GET | adminApiFn | Cognito | 14.1, 14.2 |
| /admin/audit-logs | GET | adminApiFn | Cognito | 14.3 |
| /admin/sessions/{id}/force-close | POST | adminApiFn(→sessionFn呼び出し) | Cognito | 8.10, 8.11 |
| /admin/gate/manual-open | POST | sessionFn | Cognito | 3.10, 3.12 |

Lambda間呼び出しは直接SDK invoke(同期)ではなく、共通のドメインロジックをLambda Layerとして共有し、同一Lambda内関数呼び出しにする方が推奨。ただしIAM境界を明確にしたい`authFn`/`retentionFn`だけは独立したLambdaとして分離する(境界を跨ぐ呼び出しは同期HTTP/SDK invokeで行う)。

## 6. EventBridge Scheduler

| スケジュール | 頻度 | 対象Lambda | 対応要件 |
|---|---|---|---|
| retention-scan | rate(60 minutes) | retentionFn | 10.5 |
| force-close | 施設閉場時刻+60分のcron(施設ごとに設定) | forceCloseFn | 8.6 |
| daily-collection-reset | 営業日開始前のcron | enrollmentFn(内部関数) | 2.2節の日次Collection管理 |

`retentionFn`は保管期限切れの`TemplateMeta`を`Query`(GSIでretentionDeadline昇順に取得)し、`DeleteFaces`実行後に`TemplateMeta`削除。失敗時は要件10.10に従い60分間隔で最大3回リトライするステートを`TemplateMeta`側に`retryCount`属性として保持する。

## 7. 暗号化・データ保護

- KMS CMK(`onsen-template-key`): `TemplateMeta`, `ConsentRecords`テーブルのSSE暗号化専用。復号権限は`authFnRole`/`retentionFnRole`のみ
- KMS CMK(`onsen-account-key`): `Accounts`, `Transactions`テーブル用。分離することで「顔テンプレート系」と「決済・アカウント系」の鍵アクセスを完全に分離し、要件11.5の趣旨(参照コンポーネントの限定)を鍵管理レベルでも徹底する
- Amplify Hosting/CloudFrontはHTTPS強制、API GatewayもTLS必須(デフォルト)

## 8. フロントエンド(Next.js)構成

- AWS Amplify Hosting(SSR対応)でホスティング
- 画面: Enrollment Terminal UI, Entry/Exit Gate UI(実運用ではカメラ付きキオスク端末、デモでは同一UIで代用), Service Terminal UI(係員操作), Admin Console(Cognitoログイン)
- カメラ映像はブラウザから直接Rekognitionへ送らず、API Gateway経由でLambdaに画像を渡し、Lambda内でRekognition呼び出しを行う(要件11.5のアクセス制御をフロントに漏らさないため)

## 9. IaC: AWS CDK (TypeScript) を採用

理由:
- Next.js/Lambdaと言語をTypeScriptで統一でき、チームの学習コストが下がる
- DynamoDB/EventBridge/Rekognition IAM境界のような複雑な権限設計をコードで明示的に書けて、SAMよりも柔軟
- Amplify Hosting自体はAmplify CLIまたはCDKの`amplify-hosting`相当の構成を併用

### ディレクトリ構成(提案)

```
/infra                 # CDKプロジェクト
  /lib
    template-stack.ts      # Rekognition Collection, TemplateMeta, KMS(template-key)
    account-stack.ts       # Accounts, Transactions, Entitlements, KMS(account-key)
    session-stack.ts       # Sessions, PassageHistory, DailyRegistry
    audit-stack.ts         # AuditLogs, IAM Deny policy
    api-stack.ts           # API Gateway, Cognito, Usage Plan/APIキー
    schedule-stack.ts      # EventBridge Scheduler
  /bin
    app.ts
/functions             # Lambdaソース(Node.js/TypeScript)
  /enrollment
  /auth
  /session
  /account
  /payment
  /entitlement
  /retention
  /force-close
  /admin-api
  /shared               # 共通ロジック(DynamoDB Client, 監査ログ書き込みヘルパー等)
/frontend              # Next.js
  /app
    /enrollment
    /gate
    /service-terminal
    /admin
```

## 10. 未決事項・要確認事項

| 項目 | 内容 |
|---|---|
| Rekognitionの応答レイテンシ実測 | 500件規模での`SearchUsersByImage`応答時間を実機で計測し、要件3.3/5.1/9.5の秒数制約を満たすか確認する必要がある |
| 識別スコア閾値の具体値 | 要件Glossaryで定義される「識別スコア閾値」の数値がまだ未確定。`UserMatchThreshold`にそのまま設定する値を決める必要がある |
| 施設の閉場時刻 | force-closeスケジュールのcron設定に必要。施設運用時間を確定させる必要がある |
| Stripe連携の実際の契約可否 | ハッカソンデモ用にテストモードAPIキーで進める前提。本番相当の契約は別途必要 |
