// 自前の訪問カウンター (Supabase / WorkMateと同じプロジェクトを利用)
// 送信内容は固定文字列 { event: 'visit' } のみ。引数を受け取らないことで、
// 読み込んだタイムラインや座標が誤って混入する経路を作らない。
// テーブルが未作成の間は失敗して静かに無視される。

const SB_URL = 'https://zkquchdaizdjrvlsncbs.supabase.co'
const SB_KEY = 'sb_publishable_bPO42kQg7TtPM3im9_LBNA_-6-BSw93'

const isDev = () => location.hostname === 'localhost' || location.hostname === '127.0.0.1'

export function recordVisit() {
  if (isDev()) return
  try {
    fetch(`${SB_URL}/rest/v1/jq_visits`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: '{"event":"visit"}',
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).catch(() => {})
  } catch { /* 計測失敗はアプリに影響させない */ }
}

// ?stats 表示用: 集計をRPCで取得(security definer関数経由、生データは読めない)
export async function fetchSiteStats() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/jq_stats`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    if (r.ok) return await r.json()
  } catch { /* オフライン等 */ }
  return null
}
