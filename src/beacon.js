// 自前の訪問カウンター (Supabase / WorkMateと同じプロジェクトを利用)
// GAが広告ブロッカーで止められても数えられる第一級のバックアップ。
// 送る内容: イベント名・言語・リファラのみ。位置データは送らない。
// テーブルが未作成の間は失敗して静かに無視される。

const SB_URL = 'https://zkquchdaizdjrvlsncbs.supabase.co'
const SB_KEY = 'sb_publishable_bPO42kQg7TtPM3im9_LBNA_-6-BSw93'

const isDev = () => location.hostname === 'localhost' || location.hostname === '127.0.0.1'

export function beacon(event, meta) {
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
      body: JSON.stringify({
        event,
        lang: navigator.language || null,
        ref: document.referrer || null,
        meta: meta && Object.keys(meta).length ? meta : null,
      }),
      keepalive: true,
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
    })
    if (r.ok) return await r.json()
  } catch { /* オフライン等 */ }
  return null
}
