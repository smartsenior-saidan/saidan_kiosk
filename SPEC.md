# デジタル祭壇（Saidan Kiosk）— 技術仕様書

社内技術者への引き継ぎ用。**2026-08-07 時点の実装をコードから起こしたもの**で、設計当初の構想ではなく現状を記述する。

### 先行資料の扱い

過去の仕様書が2つある。**どちらも現在の実装を説明していない。**

| 資料 | 内容 | 扱い |
|---|---|---|
| `SAIDAN_MULTITENANT_SPEC.md` | 本システムの設計時の構想。Firestore の階層構造が実装と異なる（サブコレクション前提） | 2026-07-22 のコミット `4108668` で削除済み。`git show 4108668^:SAIDAN_MULTITENANT_SPEC.md` で復元可。**データモデルは参照しないこと** |
| 「R&D デジタル祭壇システム（納骨堂）開発仕様書 11-25」（docx） | **WordPress + ACF/CPT による別案**。Kinsta ホスティング、`syomyoji-kyoto.org`、SearchWP/FacetWP | **採用されていない**。本コードベースは WordPress を一切使わない。要件の出典としてのみ有効（§11） |

後者は技術構成こそ別物だが、**業務要件の一次資料**として価値がある。実装状況の対応は §11 にまとめた。

---

## 1. これは何か

霊園・寺院に設置するタッチ端末で、来館者が故人を検索し、電子墓誌（写真・略歴・家系）を閲覧する。1つのコードベースを複数の霊園（テナント）で共有し、テナントごとに背景・テーマ・データを切り替える。

**構成要素は3つ。** いずれも静的サイトで、ビルド工程を持たない（後述 §9.1）。

| 名前 | 配信先 | 用途 | 認証 |
|---|---|---|---|
| キオスク | `kiosk.saidans.org` | 来館者向け。検索と閲覧 | なし |
| 管理画面 | `admin.saidans.org` | 霊園スタッフ向け。故人の登録・編集 | Firebase Auth |
| 納骨堂ガイド | （**別リポジトリ**） | 東京霊園専用のサイネージ。本リポジトリからは分離済み（§10.3） | なし |

バックエンドは Firebase（Firestore + Storage + Auth）1プロジェクト `smartsenior-kiosk`（リージョン `asia-northeast1`）。サーバーサイドのコードは存在せず、ブラウザから直接 Firestore を読み書きする。**したがってセキュリティルールが唯一のアクセス制御である。**

---

## 2. リポジトリ構成

```
admin/          管理画面（Cloudflare Pages プロジェクト①、ルート = admin/）
  index.html    コンソール本体（単一ページ、セクション切替）
  login.html    ログイン
  js/firebase.js  Firebase 初期化・共通ヘルパ・COLLECTIONS 定義
  js/admin.js     コンソールの全ロジック（約1900行）
  js/login.js     認証とテナント判定
  js/i18n.js      日本語/英語の文言（既定は日本語）
  css/

kiosk/          キオスク（Cloudflare Pages プロジェクト②、ルート = kiosk/）
  index.html    ウェルカム + 検索
  profile.html  電子墓誌（個人）
  family.html   家族一覧
  slideshow.html 写真スライドショー
  thankyou.html 参拝終了 → 10秒後にホーム
  js/config.js    端末のテナント確定（最初に走る）
  js/search.js    あいまい検索（かな折りたたみ + Levenshtein）
  js/tenant-bg.js テナントごとの背景・テーマ適用
  js/profile.js   墓誌の描画

scripts/        端末キッティング用 PowerShell（Intune で配布）
firestore.rules / storage.rules  アクセス制御（後述 §5）
firebase.json   ルールのデプロイ設定のみ。Hosting は未使用
```

**デプロイ**：`main` への push で Cloudflare Pages が自動ビルド。`admin/` と `kiosk/` はそれぞれ別の Pages プロジェクトで、同一リポジトリの別ディレクトリをルートに指定している（各ディレクトリの `_redirects` がその証拠）。**Firestore/Storage のルールは Pages では配信されない**。§9.2 参照。

---

## 3. テナントの考え方

テナント = 霊園・寺院の1施設。識別子は `tenant_id`（例 `kodaira_memorial`, `tokyo_reien`）。**アンダースコア区切りの小文字**。

この文字列は以下すべてで一致していなければならない。1つでもずれると、エラーは出ないまま検索結果が空になる。

- Firestore `tenants/{tenant_id}` のドキュメントID
- 各データの `tenant_id` フィールド
- `admins/{uid}.tenant_id`
- Storage のフォルダ名
- キオスク端末の起動URL `?site={tenant_id}`
- CSS テーマ `kiosk/css/tenants/{tenant_id}.css`（任意）

### 端末側の確定順序

`kiosk/js/config.js` が最初に走り、次の優先順で決める。結果を `window.__ENV__.TENANT_ID` に入れる。

1. URLクエリ `?site=` （localStorage に保存され、以後も使われる）
2. localStorage / sessionStorage
3. `DEFAULT_TENANT` 定数

> ⚠️ `DEFAULT_TENANT` は現在 `"memorial-1"` で、**存在しないテナント**。`?site=` 無しで起動すると何も表示されない。運用は `scripts/settenantid/*.ps1` が `?site=` 付きで起動タスクを登録して回避している。§10.1

### 管理画面側の確定順序

`admin/js/firebase.js` がモジュール読み込み時に `sessionStorage.ss_tenant_id` から**一度だけ**読む（`const TENANT_ID`）。ログイン時に `admins/{uid}.tenant_id` から書き込まれる。

以後すべてのクエリに `where("tenant_id", "==", TENANT_ID)` が付き（`tenantQuery()`）、新規作成は `withTenant()` が `tenant_id` を自動で刻む。**テナント切替がページリロードを伴うのはこのため**（§4.3）。

---

## 4. データモデル（Firestore）

コレクション名の定義は `admin/js/firebase.js` の `COLLECTIONS`。**すべてトップレベルのコレクション**で、テナントごとのサブコレクションではない。

### 4.1 `deceased_individuals/{personId}` — 故人

管理画面のフォームが書き込む全フィールド（`readForm()`）。

| フィールド | 型 | 備考 |
|---|---|---|
| `tenant_id` | string | `withTenant()` が自動付与 |
| `first_name` / `last_name` | string | 必須 |
| `first_name_kana` / `last_name_kana` | string | ひらがな。**キオスク検索の主キー**（§6.2） |
| `kaimyo` | string | 戒名。旧データは `posthumous_name` |
| `birth_date` / `death_date` | string | `YYYY-MM-DD` |
| `manual_age` | number \| null | 生年不明時の享年 |
| `plot_section` / `plot_row` / `plot` | string | 区画。`plot` は前2つを `-` で連結した後方互換用 |
| `biography` | string | 100文字上限（`maxlength`。既存の長いデータは切り詰められない） |
| `related_persons` | string[] | 相互リンク。**キオスクの家族ナビはこれを読む** |
| `background_url` / `background_path` | string \| null | 故人ごとの背景（プリセットから選択） |
| `created_at` / `updated_at` | timestamp | |

`presentation_url` を持つ場合、キオスクは通常レイアウトを描画せずそのURLを埋め込む（`profile.js`）。管理画面にこの入力欄はない。

### 4.2 `deceased_individuals/{personId}/media/{mediaId}` — 写真・動画・音楽

| フィールド | 値 |
|---|---|
| `file_type` | `photo` \| `video` \| `audio` |
| `role` | `cover`（遺影、1枚）\| `gallery` |
| `storage_url` / `storage_path` | Storage の実体 |
| `display_order` | cover は `-1`、gallery は連番 |

### 4.3 `deceased_families/{familyId}` — 家（先祖）

| フィールド | 型 |
|---|---|
| `name` | string（`山田家`。末尾の「家」は保存時に自動付与） |
| `member_ids` | string[] |
| `tenant_id`, `created_at`, `updated_at` | |

**家の所属は2箇所で二重管理されている。** `families.member_ids` が記録、`persons.related_persons` がキオスクの実際のナビゲーション経路。両方を同時に更新しないとキオスクが壊れる。この同期は `admin.js` の `syncFamilyMembership()` が担う。

同関数は**選択が変わっていないときは何も書かない**。家の仕組み以前に作られた故人は `related_persons` を持つが `families` に属さないため、毎回書き直すとリンクが消えるからである。

### 4.4 `tenants/{tenant_id}` — テナント設定

キオスクが起動時に読む。すべて任意で、無ければ既定値。

| フィールド | 効果 |
|---|---|
| `name` | 管理画面ヘッダーの表示名。無ければ ID を整形して表示 |
| `accent_color` | `#rrggbb`。CSS変数 `--color-accent` を上書き |
| `font_family` | Google Fonts 名 |
| `features` | `{ slideshow: true, ... }` → `html.feat-{key}` クラスが付き、CSSだけで機能をON/OFFできる。**未定義は OFF** |
| `strings` | `{ i18nキー: "文言" }` → `data-i18n` を持つ要素の文言を上書き |

### 4.5 `admins/{uid}` — スタッフ

**ドキュメントIDは Firebase Auth の UID。** アプリからは書き込めない（ルールで `allow write: if false`）。Firebase コンソールで作成する。

| フィールド | 値 |
|---|---|
| `tenant_id` | 担当施設。**必須**。ログイン直後に表示される施設を決める |
| `role` | `admin`（既定）\| `super`（全施設に書き込み可、§5.2） |
| `display_name` | 表示名 |

### 4.6 `kiosk_devices`

`COLLECTIONS.devices` として定義されているが、**読み書きするコードは存在しない**。未使用。

### 4.7 表示用ID（Firestore には保存しない）

一覧で見せる `KDR-I0001-01` 形式のIDは、`admin.js` が毎回その場で採番している（`tenantCode()` + 家/個人の並び順）。**永続的な識別子ではなく、データが増減すると番号がずれる。** 外部と突き合わせる用途には使えない。

---

## 5. 認証とアクセス制御

### 5.1 ログインの流れ

`admin/js/login.js`

1. メール+パスワード、または Google でサインイン
2. `admins/{uid}` を読む
3. `tenant_id` が無ければ**即サインアウト**して拒否（共有の demo テナントに落とさないため）
4. `sessionStorage` に `ss_tenant_id` / `ss_role` / `ss_display_name` を入れ、`index.html` へ

**Google でサインインできること自体は権限を意味しない。** `admins` レコードが無いアカウントは弾かれる。ただし Firebase Auth 側にはユーザーが作られるため、コンソールのユーザー一覧には無関係なアカウントが増える。

セッションは `browserSessionPersistence`。ブラウザを閉じると切れる（共有端末対策）。

### 5.2 スーパー管理者

`admins/{uid}.role == "super"` の場合のみ、全テナントへの書き込みが許可される。判定は `firestore.rules` / `storage.rules` の両方にある `ownsTenant()` 内で、**書き込みのたびにサーバー側で `admins` を読み直す**。クライアントの改ざんでは偽装できず、権限剥奪は即時反映される。

管理画面ではヘッダーの施設名がプルダウンに変わり、切り替えると `sessionStorage` を書き換えてページをリロードする。`TENANT_ID` が読み込み時に確定する定数のため、リロードなしの切替はできない（中途半端な状態で新規登録すると別施設に紐づく事故が起きる）。

> **`firestore.rules` と `storage.rules` は必ず同時に直すこと。** 過去に Firestore 側だけ更新した結果、故人ドキュメントは保存されるのに写真アップロードだけ拒否される（`storage/unauthorized`）不具合を出している。

### 5.3 読み取りは保護されていない（重要）

キオスクは未認証で Firestore を読むため、`deceased_individuals` / `deceased_families` / `tenants` は **`allow read: if true`**。

結果として:

- ある霊園の管理者が `sessionStorage.ss_tenant_id` を書き換えれば、**他霊園の故人データを閲覧できる**（編集はできない）
- Firebase の設定値（クライアントに埋め込まれた公開情報）を知っていれば、ログインせずに全テナントのデータが読める

テナント同士が別法人であることを踏まえると要対応。キオスクを未認証のまま動かす前提を変えずに読み取りを絞る案（匿名認証＋端末クレーム、Cloud Functions 経由など）は未検討・未実装。

---

## 6. キオスク

### 6.1 画面遷移

```
index.html（ウェルカム）
  → 検索（同一ページ内）
    → profile.html（個人の墓誌）
    → family.html（家族一覧）→ profile.html
      → slideshow.html
  → thankyou.html（参拝終了）→ 10秒カウントダウン → index.html
```

「参拝終了」ボタンは `thankyou.html?site=` へ遷移するだけの通常のリンク。**Web側の再デプロイで変更でき、端末に触れる必要はない。**

### 6.2 検索（`kiosk/js/search.js`）

Firestore に全文検索が無いため、**テナントの全故人を1回取得してクライアント側で照合する**。結果はページを開いている間キャッシュされる（`_personCache`）。

> ⚠️ キオスク端末はブラウザを開きっぱなしにするため、**管理画面で追加した故人がすぐ出ないことがある**。端末のリロードで解消する。

照合の要点:

- **入力はひらがな限定**。検索欄は `readonly` + `inputmode="none"` で、画面上のかなキーボードからのみ入力する（幅700px以下ではネイティブIMEを許可）
- カタカナ→ひらがな、濁点・半濁点の除去、小書き文字の拡大を行ってから比較（`foldKana`）。「やまた」で「やまだ」が引ける
- 日本語入力は**前方一致**。部分一致にすると1文字で全件ヒットするため
- 照合対象は姓名の漢字とかな。**かなが未入力の故人は、かな検索で絶対に見つからない**
- スコア 1.2 以下は除外。結果はあいうえお順で表示

### 6.3 背景とテーマ（`kiosk/js/tenant-bg.js`）

優先順位:

1. 故人ごとの背景（`person.background_url`）
2. 施設共通（Storage `{tenant_id}/background.{jpg|jpeg|png|webp}` — **この順で探し最初に見つかったものを使う**）
3. なし

背景画像は**明るい前提**でCSSが組まれている（文字色が濃色固定）。暗い画像を入れると文字が読めなくなる。

---

## 7. Storage のレイアウト

| パス | 内容 | 書き込み |
|---|---|---|
| `{tenant_id}/background.png` | 施設共通の背景 | コンソール手動 |
| `{tenant_id}/backgrounds/background1〜5.{ext}` | 施設専用の故人背景プリセット | コンソール手動 |
| `individuals_backgrounds/background1〜5.{ext}` | 全施設共通のプリセット（上のフォールバック） | ルールで禁止 |
| `{tenant_id}/{personId}/{timestamp}-{filename}` | 遺影・ギャラリー | 管理画面 |

プリセットは**5枚固定**。6枚目を置いても読まれない。施設専用が存在すれば共通より優先される（`resolveBgPreset()`）。

---

## 8. 端末のキッティング（`scripts/`）

Windows タブレットを Intune で管理し、PowerShell スクリプトを配布する。

| ファイル | 役割 |
|---|---|
| `kiosk-launch-install.ps1` | ドライバ導入、Edge キオスク起動タスク登録、検出マーカー書き込み |
| `kiosk-launch-uninstall.ps1` | 上記の取り消し |
| `kiosk-launch-detect.ps1` | Intune のアプリ検出。**健全性**を見る（後述） |
| `kiosk-lockdown.ps1` / `-undo.ps1` | エッジスワイプ無効化などのレジストリ設定 |
| `nfcsetup.ps1` | NFC/QR リーダーの常駐プログラム導入。**Python を文字列として埋め込んでいる** |
| `settenantid/{tenant}-setID.ps1` | 施設ごとに複製し、`?site=` 付きの起動タスクを登録 |

**注意点**

- スクリプト内に日本語・絵文字を入れない（過去に Intune で文字化け障害）
- 例外を投げないこと。throw すると Intune が「未検出」（`0x87D1041C`）と判定する

### 8.1 検出ルールと「更新が届かない」問題

Intune は配信前に必ず検出スクリプトを実行し、**「インストール済み」と判定した端末ではインストールコマンドを一切実行しない**。

`kiosk-launch-detect.ps1` が確認するのは**健全性**である。

- `python.exe` と `kiosk_reader.py` が存在するか
- スケジュールタスク（NFC / Edge）が登録され、無効化されていないか
- Python の依存パッケージが実際に `import` できるか

これは以前の実装への対策として入っている。かつては `HKLM\SOFTWARE\SmartSenior\KioskLaunch\Version` の有無だけで判定していたが、この値が `finally` ブロックで必ず書かれるため、**インストールが半分失敗しても「済み」と報告され**、Edge はあるが NFC が動かない端末が生まれた。現在は実際に機能しているかを見るため、故障した端末は Intune が自動的に再インストールして自己修復する。

> ⚠️ **ただしバージョンは見ていない。** `kiosk_reader.py` の中身が旧版でも、ファイルさえあれば全項目が真になる。つまり **`.intunewin` を作り直してアップロードしても、正常に動いている端末には配信されない**（壊れている端末にだけ配信される）。

更新を全端末に行き渡らせる方法:

1. **Intune のスーパーセデンス（置換）** — 旧アプリを置き換える対象として宣言する。検出結果に関わらず入れ替わる。多数の端末を一括更新する正攻法
2. **端末上で直接実行** — `nfcsetup.ps1` を実行、または `kiosk_reader.py` を差し替えてリーダーを再起動。1〜2台向け
3. **検出にバージョン判定を足す（恒久対策・未実装）** — 「健全 **かつ** 版が一致」を条件にする。インストーラは既に `Version` を書いているので、リリースごとに値を上げて検出側で照合すればよい。健全性チェックは残すこと（上記の教訓）

---

## 9. 規約

### 9.1 ビルド工程を持たない

npm もバンドラも無い。ブラウザが ES モジュールを直接読む。Firebase SDK は CDN（`gstatic.com`）から読み込む。

### 9.2 デプロイ経路は2つある

| 対象 | 方法 |
|---|---|
| HTML/CSS/JS | `main` に push → Cloudflare Pages が自動ビルド |
| `firestore.rules` / `storage.rules` | **`firebase deploy --only firestore:rules,storage`**（別経路。push だけでは反映されない） |

### 9.3 キャッシュバスティング

Cloudflare Pages はクエリ文字列を無視してキャッシュすることがある。**JS/CSS を変更したら参照側の `?v=` を必ず上げる**。

```
index.html → admin.js?v=N → i18n.js?v=M, firebase.js?v=K
```

上げ忘れると、新しい HTML と古い JS/CSS が混ざって描画が崩れる（実際に発生済み）。ブラウザ側は Ctrl+Shift+R で回避できる。

**キオスクはさらに Service Worker のキャッシュがある。** `kiosk/sw.js` の `CACHE = 'smartsenior-vNN'` を上げないと、端末は古いアプリシェルを使い続ける。キオスク側のファイルを変更したら**この定数も必ず上げる**こと。管理画面には Service Worker は無い。

### 9.4 表示名の組み立て

姓名は必ず `personName(p)` を通す（`admin.js`）。`姓 名` の順を決める唯一の場所。テンプレート内で直接連結しない。

---

## 10. 既知の課題

### 10.1 `DEFAULT_TENANT` が実在しない

`kiosk/js/config.js` の `"memorial-1"` は存在しないテナント。`?site=` 無しで起動した端末、または localStorage を消した端末は何も表示できない。`kiosk/TENANTS.md` にも整合させるよう注記が残ったまま。

### 10.2 バックアップが無い（2026-08-07 時点）

- Firestore の**自動バックアップ未設定**、**PITR 無効**、保持期間1時間（既定値）
- 削除保護 無効
- Storage のバージョニングは未確認

**管理画面から故人を削除すると、写真ごと即座に消え、復元手段がない。** 有効化は課金を伴うため未実施。

### 10.3 納骨堂ガイドは分離済み（依存は残る）

`columbarium/` は東京霊園専用のサイネージ（STB設置）で、祭壇とは別製品。2026-08-05 のコミット `13e0d5f` で本リポジトリから削除され、GitHub Organization `digital-signage` の独立リポジトリへ移設された。

**組織は分かれたが、データの依存は残っている。** 納骨堂ガイドは本システムと同じ Firebase プロジェクトの `deceased_individuals`（`tenant_id == "tokyo_reien"`）を読み取り専用で参照する。

> ⚠️ **`deceased_individuals` のフィールド名を変更・削除すると、納骨堂サイネージが無言で壊れる。** ビルドは通り、画面上は人が見つからなくなるだけ。スキーマを変更する際は必ず先方リポジトリを確認し、変更後に納骨堂キオスクの動作を確認すること。本リポジトリ側には向こうへの参照が一切無いため、気付く手掛かりが無い。

### 10.4 その他

- **カード抜去時に「ありがとうございました」画面を飛ばす** — 原因は `nfcsetup.ps1` に埋め込まれた Python がホームへ直接遷移していること（`README.md` の TODO 参照）
- `role` フィールドは `super` 以外に効果が無い。閲覧専用アカウントは作れない
- `biography` の100文字制限は新規入力のみ。既存の長いデータはそのまま保存できる
- 英語表示（EN）は文言が一部古い。日本語が正

---

## 11. 旧仕様書（納骨堂 11-25 版）との対応

添付の docx は **WordPress 案**であり、技術構成は採用されなかった。以下は同資料が挙げる業務要件に対する、現在の実装状況。**引き継ぎ時に「未実装の約束」を把握するための表**であり、実装済みを保証するものではない。

### 11.1 採用されなかった技術判断

| 旧案 | 現行 |
|---|---|
| WordPress（Kinsta Managed）+ ACF/CPT | 静的 HTML + Firebase。CMS もサーバーサイドも無し |
| タクソノミー `family` / CPT `deceased` | Firestore のフラットなコレクション（§4） |
| SearchWP / FacetWP | クライアント側のあいまい検索（§6.2） |
| URL `/family/{slug}/{short_id}/` | `profile.html?person={docId}&site={tenant_id}` |
| Kinsta 自動バックアップ | **バックアップ無し**（§10.2）。旧案が前提にしていた安全網が失われている |
| PWA・オフラインキャッシュ | **実装済み**。`kiosk/sw.js` がアプリシェル（HTML/CSS/JS/アイコン）をキャッシュし、短時間の回線断に耐える。キャッシュ名 `smartsenior-v66` を更新時に上げる運用 |

### 11.2 要件の実装状況

| 旧仕様書の要件 | 現状 |
|---|---|
| **ハイブリッド検索**（既定は検索画面、ICカードはかざすだけ） | **実装済み**。検索は `search.js`、NFC は `nfcsetup.ps1` が Edge を DevTools 経由で遷移させる |
| 姓・名のひらがな／漢字をインデックス化 | **実装済み**。ただし全件取得後のクライアント照合で、インデックスではない。ひらがな未入力の故人はかな検索に出ない（§6.2） |
| **検索結果に施主を表示** | **未実装**。故人データに施主・喪主・連絡先のフィールドが存在しない。存命者の個人情報にあたるため、キオスクでの表示可否から検討が必要 |
| 個別レイアウト（背景・ボタン・アイコン） | **部分実装**。背景・アクセント色・フォント・機能フラグ・文言をテナント単位で差し替え可（§4.4）。故人単位は背景のみ |
| **家紋画像** | **未実装**。旧案では family タームのメタ。現行の `deceased_families` に画像フィールドは無い |
| 写真スライド | **実装済み**（`slideshow.html`） |
| **BGM** | **実装済み**。`file_type: audio` のメディアの**1件目**を墓誌ページで再生（再生/停止ボタン付き、`profile.js`）。複数登録しても2件目以降は使われない |
| 場所案内情報 | **部分実装**。本システムは区画（`plot_section` / `plot_row`）の文字表示のみ。地図案内は別リポジトリの納骨堂ガイドの機能（§10.3） |
| **納骨堂の管理ページ**（使用状況をリアルタイム表示、Excel の代替） | **未実装**。管理画面は故人の登録・編集のみ。区画の空き状況・契約状況を扱う機能は無い |
| **遺骨 QR コード管理**（`short_id` 不変ID） | **部分実装**。QR は発行できるが、埋め込まれるのは **Firestore の自動生成ドキュメントID**。旧案の `short_id`（人が読める不変ID）とは別物。管理画面に出る `KDR-I0001` 形式のIDは**表示のたびに採番し直す非永続な番号**で、QR には使われていない（§4.7） |
| **ご遺族とのコミュニケーション機能**（足あと帳、メール、遺族向けカード） | **未実装**。該当するコレクションも画面も無い |
| **メンテナンス遠隔操作**（Intune / TeamViewer） | **部分実装**。Intune によるアプリ配布は稼働中（§8）。TeamViewer 連携は本リポジトリに無い |
| 会員機能・多言語・献花／法事申込 | **未実装**（旧案でもフェーズ2以降） |

### 11.3 引き継ぎ時に確認すべき点

- **QR の永続性**：旧案は「`short_id` を固定して QR を長期安定させる」ことを重視していた。現行は Firestore の自動IDを使っており、**故人ドキュメントを削除して作り直すと QR が無効になる**。運用上これが許容されるか要確認
- **施主の扱い**：管理画面の「この家に含める故人（任意）」は登録済みの**故人**を選ぶ欄で、施主を入れる場所ではない。旧仕様書の「施主の表示」を実現するには、存命者の情報を扱う設計判断（保存場所・キオスクでの非表示）から必要
- **バックアップ**：旧案は Kinsta の自動バックアップを前提にしていた。現行にその代替が無い（§10.2）
