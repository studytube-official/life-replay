# ジブンクエスト (JIBUN QUEST) — エージェント引き継ぎ書

Googleマップのロケーション履歴を読み込み、毎日の移動をRPG風に可視化するWebアプリ。
実績バッジ・XPレベル・地図リプレイがコア体験。オーナーは日本人(オーストラリア在住、非エンジニア寄り)。
**回答・コミュニケーションは日本語で。** 許可を求めて止まらず、最後まで自走するスタイルを好む。

## URL・インフラ一覧

| 項目 | 値 |
|---|---|
| 本番URL | https://jibunq.com (2026-07-08取得、Xserverドメイン、期限2027-07-08) |
| 旧URL | https://studytube-official.github.io/life-replay/ → jibunq.comへ自動転送 |
| GitHub | https://github.com/studytube-official/life-replay (公開リポジトリ) |
| ホスティング | GitHub Pages(**gh-pagesブランチ**から配信、Actionsではなくブランチ方式) |
| DNS | Xserverドメイン管理。NS=ns1-3.xdomain.ne.jp、A×4=185.199.108-111.153、www CNAME=studytube-official.github.io |
| DB(計測用) | Supabase プロジェクト `zkquchdaizdjrvlsncbs`(**WorkMateと共用**) |
| git identity | Haru / tt11hshikata@gmail.com(このリポジトリのローカル設定済み) |

## 技術スタック・構成

React 18 + Vite 8 + Leaflet 1.9 + jszip + Fontsource。TypeScriptなし(素のJSX)。Node標準テストあり。
**解析・保存・地図表示はクライアントサイド**。唯一の例外として、場所タブで利用者が「候補を探す」を明示的に押した時だけ、選択地点1件の座標をSupabase Edge Function経由でGoogle Placesへ送る。自動検索・一括検索・全履歴送信は禁止。

```
index.html          タイトル/OGP
vite.config.js      本番だけ位置データ通信を制限するCSPを注入 + dev設定
src/main.jsx        全UI(タイトル画面/スタッツ/実績/リプレイ/場所タブ/実績解除演出/App)
src/parse.js        3形式対応パーサー + ZIP展開 + 追加更新/重複排除 + ハバースイン距離
src/stats.js        スタッツ集計(訪問/カテゴリ/距離/ストリーク/時間帯/月別)
src/categories.js   場所カテゴリ定義・名前キーワード推定
src/achievements.js 実績28個の定義・XP/レベル計算・称号
src/demo.js         デモデータ生成(東京2.5年分、シード固定で再現性あり)
src/store.js        IndexedDB永続化(読み込みデータの自動復元)
src/beacon.js       自前訪問カウンター(Supabaseへ固定のvisit文字列だけPOST)
src/place-suggestions.js 明示操作時だけ施設候補を取得するフロント通信・正規化
src/style.css       全スタイル(RPG×夜空テーマ、CSS変数ベース)
test/parse.test.js  追加更新・全データ型の重複排除テスト
supabase/functions/jq-place-candidates Google Placesプロキシ(秘密鍵・上限管理)
places.sql          施設検索の月間/短時間上限と2日超HMAC削除を管理するSQL
analytics.sql       Supabaseに貼るカウンター用SQL(→「計測」参照)
public/CNAME        jibunq.com(ビルドでdist/へ入る。消すとカスタムドメインが外れる)
.github/workflows/keepalive.yml  Supabase自動停止防止(週2回ping)
```

## 開発環境の注意(Windows)

- **node/npmはPATHに無い。** 同梱Nodeを使う: `C:\Users\ssasu\workmate\.tools\node-v22.16.0-win-x64\node.exe`(npm.cmdも同フォルダ)
- devサーバー: port 5175(`npm run dev`)
- vite base は `'/'`(カスタムドメインのルート配信。サブパスに戻さないこと)

## デプロイ手順(gh-pagesブランチ方式)

```
1. npm run build                     # dist/ に出力(dist/CNAME が入ることを確認)
2. git worktree add %TEMP%\lr-ghpages gh-pages
3. gh-pages側を空にして dist/* をコピー、.nojekyll を作成
4. commit & push origin gh-pages
5. git worktree remove
```
- **CNAMEファイルと.nojekyllを毎回含める**こと(消えるとドメイン設定が外れる)
- 反映は数分。まれにPages buildが「errored」や長時間「building」になる → `POST /repos/studytube-official/life-replay/pages/builds` で再ビルド要求できる
- GitHub API認証: gh CLIは無い。Windows資格情報マネージャーの `git:https://github.com` のトークン(CredRead APIで取得可、studytube-official / repo+workflowスコープ)

## Googleタイムラインのデータ形式(調査済みの前提知識)

- 2024年以降、タイムラインデータは端末内のみ。**自動取得APIは存在しない**(手動エクスポートが唯一の入口)
- 3形式対応済み: ①Android端末エクスポート `Timeline.json`(semanticSegmentsラップ、座標は`"35.1°, 139.2°"`文字列) ②iOS `location-history.json`(フラット配列、`geo:`URI、数値が文字列、placeIDと大文字表記) ③旧Takeout `timelineObjects`(E7整数座標、**唯一場所名あり**)
- **現行形式(①②)に場所名は無い** → HOME/WORK分類・端末内の手動ラベルに加え、利用者が地点ごとに任意でGoogle Places候補を1回検索できる
- Takeout ZIPはそのまま読める(Records.json/Settings.jsonはスキップ)
- iOS公式導線: Google Maps→設定→個人的なコンテンツ→タイムライン データをエクスポート→ファイルに保存
- Android公式導線: 端末の設定→位置情報→位置情報サービス→タイムライン→タイムライン データをエクスポート
- Webだけでは上記エクスポート操作を自動化できない。iOS共有シートから直接受けるには将来のネイティブShare Extensionが必要

## 計測(訪問者数)

**自前カウンターだけ**。GA4は第三者スクリプトがページ内の位置データへ技術的にアクセスできるためv0.4で削除した。
- `src/beacon.js` は引数を受け取らず、Supabase `jq_visits` へ固定の `{event:'visit'}` だけをPOST。言語・リファラ・metaも送らない
- `analytics.sql` のRLSも `event='visit'` かつ他列nullだけ許可し、公開キーで位置データを保存できないよう制限
- 集計は `jq_stats()` RPC。アプリURLに `?stats` を付けると右上に累計/24h/7日パネルが出る
- ⚠️ **`analytics.sql` がまだSupabaseで未実行**(2026-07-10時点)。オーナーがSQL Editorで実行するまで静かに失敗する

## 既知のハマりどころ

- **Supabase無料プランは7日間アクセス無しで自動停止**する。停止するとWorkMate本体も止まる。対策として本リポジトリのGitHub Actionsで週2回ping(keepalive.yml)。停止していたらダッシュボードの「Resume project」で復旧
- IndexedDBはオリジン単位 → ドメイン移行(github.io→jibunq.com)で保存データはリセットされた(仕様)
- PowerShell 5.1環境。`&&`不可、here-stringは崩れやすい(コミットメッセージは `git commit -F ファイル` が安全)
- Xserver側のDNS/ドメイン操作はオーナーのみ(認証情報は渡されていない)

## 実装済み機能(2026-07-19時点 v0.7)

3形式パーサー / ZIP読込 / 最新データ追加(訪問・移動・経路すべて重複排除) / OS別の公式エクスポート案内 / スタッツ集計(訪問・場所・距離・ストリーク・時間帯/曜日/月別グラフ) / カテゴリ別集計(コンビニ・カフェ等17種) / 実績28個+解除セレモニー演出 / XP・レベル・称号 / Leafletオフライン冒険マップ(速度切替・シーク・追従・軌跡、外部タイルなし) / 場所名編集・カテゴリ変更UI / オフライン場所命名アシスト(番号地図・最近の訪問日時・平均滞在・前後地点・名前付き地点からの距離と方角・未確認フィルター) / 明示クリック式の周辺施設候補検索(全体月4,500回hard cap・候補は一時表示) / 候補選択→カテゴリ確認の2タップAI分析用紐付け(保存はPlace IDと利用者確認カテゴリのみ) / HOME・WORKの端末内名称補完 / デモモード / ゼロスタートモード / IndexedDB自動復元 / 訪問計測

## 未完了・ロードマップ

1. **Google Places候補検索の外部設定待ち** — Google CloudでPlaces API (New)と請求先を有効化、APIキーをEdge secretへ登録、`places.sql`実行、Edge Functionをデプロイ。キーをフロントへ入れない
2. **analytics.sql のSupabase実行待ち**(オーナー作業) → 実行後 `?stats` の動作確認
3. **オーナーの実データテスト** — 数週間後に実データ(iOS形式)を読み込み、エッジケースと追加更新を確認
4. **デイリーチェックイン機能**(検討済み・未着手) — Geolocation APIで「今日を刻む」ボタン+ストリーク+限定実績の構想。ただし位置は端末内だけで扱う
5. **Phase 2: ネイティブ化**(構想) — Capacitor + iOS Share ExtensionでエクスポートJSONを共有シートから直接受信。将来はVisit Monitoringでアプリ自身が記録。Apple Developer Program($99/年)は未契約
6. 細かい改善、実績の追加など

## デザイン方針(オーナーの明確な希望)

- RPGゲーム感 × 綺麗な夜空(星空+オーロラ+金色)テーマ。**「デモの感じがとても良いので大きく変えない」**(本人談)
- フォント: DotGothic16(ピクセル和文)+ Zen Kaku Gothic New + Cinzel。Fontsourceからビルドへ同梱し、Google Fontsへ通信しない
- カラーはstyle.cssの`:root`CSS変数に集約済み
- 演出重視: 実績解除セレモニー(光線回転+ティア色)、光る訪問サークル、XPバーなど

## 品質チェック(変更時)

- `npm test` と `npm run build` が通ること
- デモモード一周(読み込み→スタッツ→実績→リプレイ→場所タブ)
- ゼロスタートモードでも壊れないこと(空データのガードが各所にある)
- 通常処理では位置データを外部送信しない。候補検索だけは明示クリック時の選択座標1件に限定し、自動・再試行・先読み・一括検索を入れない
- 候補検索はSupabase Edge Function経由に限定する。座標・候補・Googleレスポンスをサーバーへ保存/ログ出力せず、Googleキーをクライアントへ置かない
- 候補選択後もGoogleの施設名・住所・カテゴリを永続化しない。保存を許可するのはGoogle Place IDと、利用者が明示確認したアプリ内カテゴリだけ
- Google Places呼び出しは全体で月4,500回を原子的にhard cap。1操作=1回、失敗時の自動再試行なし
- `vite.config.js` が本番ビルドへ注入するCSPを緩めない。ブラウザからの通信先は既存Supabaseだけ
- ビルド成果物に `nominatim` / `cartocdn` / `googletagmanager` / `fonts.googleapis` が含まれないこと
