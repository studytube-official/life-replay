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
| GA4 | 測定ID `G-02RE0K5Q9F`(**暫定でManaCueと共用**。下記「計測」参照) |
| git identity | Haru / tt11hshikata@gmail.com(このリポジトリのローカル設定済み) |

## 技術スタック・構成

React 18 + Vite 5 + Leaflet 1.9 + jszip。TypeScriptなし(素のJSX)。テストなし。
**解析は完全クライアントサイド**(位置データは絶対に外部送信しない = このアプリの信頼の根幹。壊さないこと)。

```
index.html          タイトル/OGP/GA4タグ(gtag, localhostでは無効化)
src/main.jsx        全UI(タイトル画面/スタッツ/実績/リプレイ/場所タブ/実績解除演出/App)
src/parse.js        3形式対応パーサー + ZIP展開 + ハバースイン距離
src/stats.js        スタッツ集計(訪問/カテゴリ/距離/ストリーク/時間帯/月別)
src/categories.js   場所カテゴリ定義・名前キーワード推定・OSMタグ→カテゴリ変換
src/achievements.js 実績28個の定義・XP/レベル計算・称号
src/demo.js         デモデータ生成(東京2.5年分、シード固定で再現性あり)
src/geocode.js      Nominatim逆ジオコーディング(1req/s、localStorageキャッシュ)
src/store.js        IndexedDB永続化(読み込みデータの自動復元)
src/beacon.js       自前訪問カウンター(Supabaseへ匿名イベントPOST)
src/style.css       全スタイル(RPG×夜空テーマ、CSS変数ベース)
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
- **現行形式(①②)に場所名は無い** → Nominatim逆ジオコーディング(無料)+手動ラベルで補完する設計
- Takeout ZIPはそのまま読める(Records.json/Settings.jsonはスキップ)

## 計測(訪問者数)

二重系統:
1. **GA4** `G-02RE0K5Q9F` — **暫定でManaCue(manacue.com、別プロジェクト)と同一プロパティ共用**。ジブンクエスト分はページタイトル/パスで区別。オーナーが専用プロパティを作ったら index.html の2ヶ所のIDを差し替えて再デプロイするのが正: 手順は伝達済みでG-ID待ち
2. **自前カウンター** — `src/beacon.js` がSupabase `jq_visits` テーブルへINSERT(visit/demo_start/zero_start/data_importイベント。位置データは送らない)。集計は `jq_stats()` RPC。アプリURLに `?stats` を付けると右上に累計/24h/7日パネルが出る
   - ⚠️ **`analytics.sql` がまだSupabaseで未実行**(2026-07-08時点)。オーナーがSQL Editorで実行するまで、beaconは静かに失敗し `?stats` は「取得失敗」表示。実行されれば即動く
- オーナーのiPhoneはトラッカーブロックでGAに映らないことがある(既知・実害なし)。新ドメイン公開直後はCTログ監視ボットがGAに乗る(米国ユーザーとして見える。数日で収まる)

## 既知のハマりどころ

- **Supabase無料プランは7日間アクセス無しで自動停止**する。停止するとWorkMate本体も止まる。対策として本リポジトリのGitHub Actionsで週2回ping(keepalive.yml)。停止していたらダッシュボードの「Resume project」で復旧
- IndexedDBはオリジン単位 → ドメイン移行(github.io→jibunq.com)で保存データはリセットされた(仕様)
- PowerShell 5.1環境。`&&`不可、here-stringは崩れやすい(コミットメッセージは `git commit -F ファイル` が安全)
- Xserver側のDNS/ドメイン操作はオーナーのみ(認証情報は渡されていない)

## 実装済み機能(2026-07-08時点 v0.3)

3形式パーサー / ZIP読込 / スタッツ集計(訪問・場所・距離・ストリーク・時間帯/曜日/月別グラフ) / カテゴリ別集計(コンビニ・カフェ等17種) / 実績28個+解除セレモニー演出 / XP・レベル・称号 / Leaflet地図リプレイ(速度切替・シーク・追従・軌跡) / 場所名編集・カテゴリ変更UI / Nominatim名前解決 / デモモード / ゼロスタートモード(記録0でも遊べる+案内バナー) / IndexedDB自動復元(タイトルに「続きから」) / 状況別オンボーディング(使っていた人/オフだった人/デモ) / 訪問計測

## 未完了・ロードマップ

1. **analytics.sql のSupabase実行待ち**(オーナー作業) → 実行後 `?stats` の動作確認
2. **GA4専用プロパティへの分離**(オーナーがG-IDをくれたら index.html 差し替え)
3. **オーナーの実データテスト** — オーナー自身はタイムラインがオフだった(過去データ無し)。今オンにして記録を貯めており、数週間後に実データ(iOS形式)を読み込む予定。実データ特有のエッジケースが出る可能性が高い
4. **デイリーチェックイン機能**(検討済み・未着手) — 月1インポートの間の空白を埋める。Geolocation APIで「今日を刻む」ボタン+ストリーク+チェックイン限定実績の構想
5. **Phase 2: ネイティブ化**(構想) — Capacitor + iOS Visit Monitoringでアプリ自身が記録し、エクスポート不要にする。Mac無し環境なのでGitHub ActionsのmacランナーでビルドしTestFlight配布する想定。Apple Developer Program($99/年)は未契約
6. ZIP以外の細かい改善、実績の追加など

## デザイン方針(オーナーの明確な希望)

- RPGゲーム感 × 綺麗な夜空(星空+オーロラ+金色)テーマ。**「デモの感じがとても良いので大きく変えない」**(本人談)
- フォント: DotGothic16(ピクセル和文)+ Zen Kaku Gothic New + Cinzel
- カラーはstyle.cssの`:root`CSS変数に集約済み
- 演出重視: 実績解除セレモニー(光線回転+ティア色)、光る訪問サークル、XPバーなど

## 品質チェック(変更時)

- `npm run build` が通ること
- デモモード一周(読み込み→スタッツ→実績→リプレイ→場所タブ)
- ゼロスタートモードでも壊れないこと(空データのガードが各所にある)
- 位置データを外部送信するコードを絶対に入れないこと
