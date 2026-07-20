# 場所候補検索の本番有効化

対象プロジェクト: `zkquchdaizdjrvlsncbs`

このSupabaseプロジェクトは他機能と共有しているため、`db reset`やデータベース全体の
`db push`は行わない。次の順番を固定する。

1. Google Cloudで請求先を接続し、Places API (New)を有効化する。
2. Places API (New)だけにAPI制限した専用キーを作成する。
3. Supabase SQL Editorでリポジトリ直下の`places.sql`を1回実行する。
4. Edge Function secretsへ次を登録する。
   - `GOOGLE_PLACES_API_KEY`
   - `PLACE_RATE_HASH_SECRET`（32文字以上のランダム値）
5. `jq-place-candidates`をJWT検証なしでデプロイする。
   - `supabase/config.toml`の`verify_jwt = false`を維持する。
6. `Origin: https://jibunq.com`を付け、公開施設の合成座標で1回だけスモークテストする。
7. 成功後にフロントエンドを`gh-pages`へ反映する。

`places.sql`は月4,500回のhard cap、10回/分・100回/日のclient rate limit、
HMAC化済みclient hashの2日超日次削除を設定する。秘密鍵をフロントエンドやGitへ入れない。
