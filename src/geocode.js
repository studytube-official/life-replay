import { osmToCategory } from './categories.js'

// Nominatim (OpenStreetMap) 逆ジオコーディング — 無料・APIキー不要
// 利用規約: 最大1リクエスト/秒 → 1100msスロットリング + localStorageキャッシュ
// 現行のGoogleエクスポートに場所名が無いための補完機能(任意実行)。

const CACHE_KEY = 'lr_geo_cache_v1'

function loadCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {} } catch { return {} }
}
function saveCache(c) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)) } catch { /* 容量超過は無視 */ }
}

// places: [{key, lat, lng}] 訪問回数の多い順に上位だけ渡すこと
// onProgress(done, total, label)
export async function resolvePlaces(places, onProgress, maxCount = 40) {
  const cache = loadCache()
  const results = {}
  const targets = places.slice(0, maxCount)
  let done = 0
  for (const p of targets) {
    const ck = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
    let hit = cache[ck]
    if (!hit) {
      try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${p.lat}&lon=${p.lng}&zoom=18&accept-language=ja`
        const res = await fetch(url, { headers: { Accept: 'application/json' } })
        if (res.ok) {
          const j = await res.json()
          hit = {
            name: j.name || (j.address && (j.address.amenity || j.address.shop || j.address.building)) || j.display_name?.split(',')[0] || null,
            cls: j.category || j.class || null,
            type: j.type || null,
          }
          cache[ck] = hit
          saveCache(cache)
        }
      } catch { /* オフライン等は無視して続行 */ }
      await new Promise((r) => setTimeout(r, 1100)) // レート制限遵守
    }
    if (hit && hit.name) {
      results[p.key] = { name: hit.name, category: osmToCategory(hit.cls, hit.type) || undefined }
    }
    done++
    onProgress?.(done, targets.length, hit?.name || '')
  }
  return results
}
