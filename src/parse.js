// ---------------------------------------------------------------
// Googleロケーション履歴パーサー
// 対応形式:
//  A) Android 端末エクスポート (Timeline.json): { semanticSegments: [...] }
//  B) iOS 端末エクスポート (location-history.json): トップレベルがフラット配列
//  C) 旧 Google Takeout (Semantic Location History/2019_JANUARY.json 等):
//     { timelineObjects: [ { placeVisit | activitySegment } ] } ※場所名あり
// すべて端末内(ブラウザ内)で完結。外部送信なし。
// ---------------------------------------------------------------

// 座標文字列/オブジェクトを {lat, lng} に正規化
export function parseLatLng(v) {
  if (v == null) return null
  if (typeof v === 'object') {
    if (typeof v.latitudeE7 === 'number' && typeof v.longitudeE7 === 'number') {
      return { lat: v.latitudeE7 / 1e7, lng: v.longitudeE7 / 1e7 }
    }
    if (v.latLng != null) return parseLatLng(v.latLng)
    if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
      return { lat: v.latitude, lng: v.longitude }
    }
    return null
  }
  if (typeof v !== 'string') return null
  // "geo:35.65,139.83" / "35.65°, 139.83°" / "35.65, 139.83"
  const s = v.replace(/^geo:/, '').replace(/[°]/g, '')
  const m = s.split(',').map((x) => parseFloat(x.trim()))
  if (m.length >= 2 && Number.isFinite(m[0]) && Number.isFinite(m[1])) {
    return { lat: m[0], lng: m[1] }
  }
  return null
}

function ts(v) {
  if (v == null) return null
  if (typeof v === 'number') return v
  const n = Date.parse(v)
  return Number.isFinite(n) ? n : null
}
const num = (v) => (typeof v === 'string' ? parseFloat(v) : v)

// --- 統一モデル ---
// visit:    { start, end, lat, lng, placeId, name, address, semanticType }
// path:     [{ time, lat, lng }]
// activity: { start, end, type, distanceMeters, from:{lat,lng}, to:{lat,lng} }

function emptyResult() {
  return { visits: [], paths: [], activities: [], sourceFormats: new Set(), errors: [] }
}

// --- A/B: semanticSegments 形式 (Android=ラップ / iOS=フラット配列) ---
function parseSegment(seg, out) {
  const start = ts(seg.startTime)
  const end = ts(seg.endTime)
  if (seg.visit) {
    const tc = seg.visit.topCandidate || {}
    const loc = parseLatLng(tc.placeLocation)
    if (loc && start != null && end != null) {
      out.visits.push({
        start, end,
        lat: loc.lat, lng: loc.lng,
        placeId: tc.placeId || tc.placeID || null,
        name: null, address: null,
        semanticType: normalizeSemanticType(tc.semanticType),
      })
    }
  } else if (seg.timelinePath && Array.isArray(seg.timelinePath)) {
    const pts = []
    for (const p of seg.timelinePath) {
      const loc = parseLatLng(p.point)
      if (!loc) continue
      let t = ts(p.time)
      if (t == null && p.durationMinutesOffsetFromStartTime != null && start != null) {
        t = start + num(p.durationMinutesOffsetFromStartTime) * 60000
      }
      pts.push({ time: t ?? start ?? 0, lat: loc.lat, lng: loc.lng })
    }
    if (pts.length) out.paths.push(pts)
  } else if (seg.activity) {
    const a = seg.activity
    const from = parseLatLng(a.start)
    const to = parseLatLng(a.end)
    if (start != null && end != null && (from || to)) {
      out.activities.push({
        start, end,
        type: (a.topCandidate && a.topCandidate.type) || 'UNKNOWN',
        distanceMeters: num(a.distanceMeters) || 0,
        from, to,
      })
    }
  }
}

// --- C: 旧Takeout timelineObjects 形式 ---
function parseTimelineObject(obj, out) {
  if (obj.placeVisit) {
    const pv = obj.placeVisit
    const loc = parseLatLng(pv.location) || parseLatLng(pv.centerLatE7 != null ? { latitudeE7: pv.centerLatE7, longitudeE7: pv.centerLngE7 } : null)
    const d = pv.duration || {}
    const start = ts(d.startTimestamp ?? d.startTimestampMs)
    const end = ts(d.endTimestamp ?? d.endTimestampMs)
    if (loc && start != null && end != null) {
      out.visits.push({
        start, end,
        lat: loc.lat, lng: loc.lng,
        placeId: (pv.location && pv.location.placeId) || null,
        name: (pv.location && pv.location.name) || null,
        address: (pv.location && pv.location.address) || null,
        semanticType: normalizeSemanticType(pv.location && pv.location.semanticType),
      })
    }
  } else if (obj.activitySegment) {
    const as = obj.activitySegment
    const d = as.duration || {}
    const start = ts(d.startTimestamp ?? d.startTimestampMs)
    const end = ts(d.endTimestamp ?? d.endTimestampMs)
    const from = parseLatLng(as.startLocation)
    const to = parseLatLng(as.endLocation)
    if (start != null && end != null && (from || to)) {
      out.activities.push({
        start, end,
        type: as.activityType || 'UNKNOWN',
        distanceMeters: num(as.distance) || 0,
        from, to,
      })
    }
    // 経路点があればリプレイ用に取り込む
    const wp = (as.waypointPath && as.waypointPath.waypoints) || null
    const raw = (as.simplifiedRawPath && as.simplifiedRawPath.points) || null
    if (raw && raw.length) {
      const pts = raw
        .map((p) => {
          const loc = parseLatLng({ latitudeE7: p.latE7, longitudeE7: p.lngE7 })
          return loc ? { time: ts(p.timestamp ?? p.timestampMs) ?? start, ...loc } : null
        })
        .filter(Boolean)
      if (pts.length) out.paths.push(pts)
    } else if (wp && wp.length && start != null && end != null) {
      const pts = wp
        .map((p, i) => {
          const loc = parseLatLng({ latitudeE7: p.latE7, longitudeE7: p.lngE7 })
          return loc ? { time: start + ((end - start) * i) / wp.length, ...loc } : null
        })
        .filter(Boolean)
      if (pts.length) out.paths.push(pts)
    }
  }
}

function normalizeSemanticType(t) {
  if (!t) return null
  const s = String(t).toUpperCase()
  if (s.includes('HOME')) return 'HOME'
  if (s.includes('WORK')) return 'WORK'
  return s === 'UNKNOWN' ? null : s
}

// 1つのJSON文書を判別してパース
export function parseDocument(json, out) {
  if (Array.isArray(json)) {
    // iOS: フラット配列
    let hit = false
    for (const seg of json) {
      if (seg && (seg.visit || seg.timelinePath || seg.activity)) {
        parseSegment(seg, out)
        hit = true
      }
    }
    if (hit) out.sourceFormats.add('ios-device')
    return hit
  }
  if (json && Array.isArray(json.semanticSegments)) {
    for (const seg of json.semanticSegments) parseSegment(seg, out)
    out.sourceFormats.add('android-device')
    return true
  }
  if (json && Array.isArray(json.timelineObjects)) {
    for (const obj of json.timelineObjects) parseTimelineObject(obj, out)
    out.sourceFormats.add('takeout-semantic')
    return true
  }
  return false
}

// 複数ファイル(File[])を読み込んでマージ
export async function parseFiles(files) {
  const out = emptyResult()
  for (const file of files) {
    if (!/\.json$/i.test(file.name)) continue
    let json
    try {
      json = JSON.parse(await file.text())
    } catch (e) {
      out.errors.push(`${file.name}: JSONとして読めませんでした`)
      continue
    }
    if (!parseDocument(json, out)) {
      out.errors.push(`${file.name}: 対応していない形式です(Records.jsonは非対応。Timeline.json / location-history.json / Semantic Location History を使ってください)`)
    }
  }
  finalize(out)
  return out
}

// デモ/テスト用: 直接オブジェクトから
export function parseObjects(jsons) {
  const out = emptyResult()
  for (const j of jsons) parseDocument(j, out)
  finalize(out)
  return out
}

function finalize(out) {
  out.visits.sort((a, b) => a.start - b.start)
  out.activities.sort((a, b) => a.start - b.start)
  out.paths.sort((a, b) => (a[0]?.time ?? 0) - (b[0]?.time ?? 0))
  // 同一visitの重複除去(複数ファイルの期間重複対策)
  const seen = new Set()
  out.visits = out.visits.filter((v) => {
    const k = `${v.start}|${v.placeId || `${v.lat.toFixed(5)},${v.lng.toFixed(5)}`}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  out.sourceFormats = [...out.sourceFormats]
}

// ハバースイン距離 (m)
export function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}
