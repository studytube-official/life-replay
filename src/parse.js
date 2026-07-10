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

// 複数ファイル(File[])を読み込んでマージ。TakeoutのZIPもそのまま可
export async function parseFiles(files) {
  const out = emptyResult()
  for (const file of files) {
    if (/\.zip$/i.test(file.name)) {
      await parseZip(file, out)
      continue
    }
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

// Takeout ZIP: 中のJSONを展開してパース(巨大なRecords.json等はスキップ)
async function parseZip(file, out) {
  let JSZip
  try {
    JSZip = (await import('jszip')).default
  } catch {
    out.errors.push(`${file.name}: ZIP読み込みモジュールのロードに失敗しました`)
    return
  }
  let zip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    out.errors.push(`${file.name}: ZIPとして読めませんでした`)
    return
  }
  const entries = Object.values(zip.files).filter(
    (e) => !e.dir && /\.json$/i.test(e.name) && !/Records\.json$/i.test(e.name) && !/Settings\.json$/i.test(e.name)
  )
  if (!entries.length) {
    out.errors.push(`${file.name}: ZIP内に対応するJSONが見つかりませんでした`)
    return
  }
  for (const entry of entries) {
    try {
      const text = await entry.async('string')
      if (text.length > 200 * 1024 * 1024) continue // 異常サイズは安全のためスキップ
      parseDocument(JSON.parse(text), out)
    } catch { /* 個別エントリの失敗は無視して続行 */ }
  }
}

// デモ/テスト用: 直接オブジェクトから
export function parseObjects(jsons) {
  const out = emptyResult()
  for (const j of jsons) parseDocument(j, out)
  finalize(out)
  return out
}

function pointKey(p) {
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return '-'
  return `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`
}

function visitKey(v) {
  return `${v.start}|${v.end}|${pointKey(v)}`
}

function activityKey(a) {
  return `${a.start}|${a.end}|${String(a.type).toUpperCase()}|${pointKey(a.from)}|${pointKey(a.to)}`
}

function pathKey(path) {
  const first = path[0]
  const last = path[path.length - 1]
  return `${first?.time ?? '-'}|${last?.time ?? '-'}|${pointKey(first)}|${pointKey(last)}`
}

function dedupe(items, keyOf, merge = (current) => current) {
  const map = new Map()
  for (const item of items) {
    const key = keyOf(item)
    map.set(key, map.has(key) ? merge(map.get(key), item) : item)
  }
  return [...map.values()]
}

function normalizedCopy(data) {
  const out = emptyResult()
  out.visits.push(...(data?.visits || []))
  out.activities.push(...(data?.activities || []))
  out.paths.push(...(data?.paths || []))
  for (const format of data?.sourceFormats || []) out.sourceFormats.add(format)
  out.errors.push(...(data?.errors || []))
  finalize(out)
  return out
}

// 保存済みデータへ最新エクスポートを追加する。
// 全履歴を再エクスポートしても、訪問・移動・経路を二重計上しない。
export function mergeParsedData(current, incoming) {
  const before = normalizedCopy(current)
  const next = normalizedCopy(incoming)
  const out = emptyResult()
  out.visits.push(...before.visits, ...next.visits)
  out.activities.push(...before.activities, ...next.activities)
  out.paths.push(...before.paths, ...next.paths)
  for (const format of [...before.sourceFormats, ...next.sourceFormats]) out.sourceFormats.add(format)
  out.errors.push(...next.errors)
  finalize(out)

  const report = {
    visitsAdded: Math.max(0, out.visits.length - before.visits.length),
    activitiesAdded: Math.max(0, out.activities.length - before.activities.length),
    pathsAdded: Math.max(0, out.paths.length - before.paths.length),
  }
  report.duplicatesSkipped = Math.max(0,
    next.visits.length + next.activities.length + next.paths.length
      - report.visitsAdded - report.activitiesAdded - report.pathsAdded,
  )
  return { data: { ...out, zeroStart: false }, report }
}

function finalize(out) {
  // 新しい書き出しを優先しつつ、旧データだけが持つ場所名・住所は保持する。
  out.visits = dedupe(out.visits, visitKey, (old, fresh) => ({
    ...old,
    ...fresh,
    placeId: fresh.placeId || old.placeId,
    name: fresh.name || old.name,
    address: fresh.address || old.address,
    semanticType: fresh.semanticType || old.semanticType,
  })).sort((a, b) => a.start - b.start)
  out.activities = dedupe(out.activities, activityKey, (old, fresh) => ({
    ...old,
    ...fresh,
    type: fresh.type || old.type,
    distanceMeters: fresh.distanceMeters || old.distanceMeters,
    from: fresh.from || old.from,
    to: fresh.to || old.to,
  }))
    .sort((a, b) => a.start - b.start)
  out.paths = dedupe(out.paths.filter((p) => p.length), pathKey, (old, fresh) => (
    fresh.length >= old.length ? fresh : old
  )).sort((a, b) => (a[0]?.time ?? 0) - (b[0]?.time ?? 0))
  out.sourceFormats = [...new Set(out.sourceFormats || [])]
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
