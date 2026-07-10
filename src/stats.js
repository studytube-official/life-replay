import { haversine } from './parse.js'
import { inferCategory, placeKeyOf, CATEGORIES } from './categories.js'

// パース結果 + ラベル辞書 → スタッツ一式
export function computeStats(data, labels = {}) {
  const { visits, activities, paths } = data
  const s = {
    totalVisits: visits.length,
    uniquePlaces: 0,
    firstTime: null,
    lastTime: null,
    spanDays: 0,
    activeDays: 0,
    totalDistanceKm: 0,
    maxDayDistanceKm: 0,
    maxDayDistanceDate: null,
    longestStreak: 0,
    longestStayHours: 0,
    nightVisits: 0,       // 0-4時開始
    earlyVisits: 0,       // 4-7時開始
    weekendVisits: 0,
    places: [],           // [{key, name, category, count, totalMin, lat, lng, semanticType}]
    categoryCounts: {},   // {cat: visits}
    hourHist: new Array(24).fill(0),
    weekdayHist: new Array(7).fill(0),
    monthly: [],          // [{ym, visits, km}]
    flightDetected: false,
    maxVisitsOnePlace: 0,
    topPlace: null,
  }
  if (!visits.length && !activities.length) return s

  const placeMap = new Map()
  const daySet = new Set()
  const dayKm = new Map()
  const monthMap = new Map()

  const dayKey = (t) => {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const ymKey = (t) => {
    const d = new Date(t)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  for (const v of visits) {
    const key = placeKeyOf(v)
    let p = placeMap.get(key)
    if (!p) {
      p = { key, name: v.name, lat: v.lat, lng: v.lng, count: 0, totalMin: 0, semanticType: v.semanticType, category: null, firstVisit: v.start }
      placeMap.set(key, p)
    }
    if (!p.name && v.name) p.name = v.name
    if (!p.semanticType && v.semanticType) p.semanticType = v.semanticType
    p.count++
    const durMin = Math.max(0, (v.end - v.start) / 60000)
    p.totalMin += durMin
    s.longestStayHours = Math.max(s.longestStayHours, durMin / 60)

    const d = new Date(v.start)
    const h = d.getHours()
    s.hourHist[h]++
    s.weekdayHist[d.getDay()]++
    if (h < 4) s.nightVisits++
    else if (h < 7) s.earlyVisits++
    if (d.getDay() === 0 || d.getDay() === 6) s.weekendVisits++
    daySet.add(dayKey(v.start))
    const ym = ymKey(v.start)
    monthMap.set(ym, (monthMap.get(ym) || { visits: 0, km: 0 }))
    monthMap.get(ym).visits++
  }

  for (const a of activities) {
    let m = a.distanceMeters
    if (!m && a.from && a.to) m = haversine(a.from.lat, a.from.lng, a.to.lat, a.to.lng)
    const km = (m || 0) / 1000
    s.totalDistanceKm += km
    daySet.add(dayKey(a.start))
    const dk = dayKey(a.start)
    dayKm.set(dk, (dayKm.get(dk) || 0) + km)
    const ym = ymKey(a.start)
    monthMap.set(ym, (monthMap.get(ym) || { visits: 0, km: 0 }))
    monthMap.get(ym).km += km
    const type = String(a.type).toUpperCase()
    if (type.includes('FLYING') || type.includes('PLANE') || type.includes('AIR')) s.flightDetected = true
    // 速度から飛行機を推定 (>250km/h かつ 200km以上)
    const hrs = (a.end - a.start) / 3600000
    if (hrs > 0.3 && km > 200 && km / hrs > 250) s.flightDetected = true
  }
  // activityが無い形式向け: timelinePathからも距離を補完
  if (s.totalDistanceKm === 0 && paths.length) {
    for (const pts of paths) {
      for (let i = 1; i < pts.length; i++) {
        const km = haversine(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng) / 1000
        if (km < 500) {
          s.totalDistanceKm += km
          const dk = dayKey(pts[i].time)
          dayKm.set(dk, (dayKm.get(dk) || 0) + km)
        }
      }
      if (pts.length) daySet.add(dayKey(pts[0].time))
    }
  }

  for (const [dk, km] of dayKm) {
    if (km > s.maxDayDistanceKm) {
      s.maxDayDistanceKm = km
      s.maxDayDistanceDate = dk
    }
  }

  // 場所リスト + カテゴリ
  s.places = [...placeMap.values()]
  for (const p of s.places) {
    p.category = inferCategory({ ...p, placeId: p.key.includes(',') ? null : p.key }, labels)
    if (labels[p.key]?.name) p.name = labels[p.key].name
    else if (!p.name && p.semanticType === 'HOME') p.name = '自宅'
    else if (!p.name && p.semanticType === 'WORK') p.name = '職場・学校'
  }
  s.places.sort((a, b) => b.count - a.count)
  s.uniquePlaces = s.places.length
  s.topPlace = s.places[0] || null
  s.maxVisitsOnePlace = s.topPlace ? s.topPlace.count : 0

  for (const p of s.places) {
    s.categoryCounts[p.category] = (s.categoryCounts[p.category] || 0) + p.count
  }

  // 期間・アクティブ日数・ストリーク
  const allT = [
    ...visits.map((v) => v.start),
    ...activities.map((a) => a.start),
  ]
  s.firstTime = Math.min(...allT)
  s.lastTime = Math.max(...visits.map((v) => v.end), ...activities.map((a) => a.end))
  s.spanDays = Math.max(1, Math.round((s.lastTime - s.firstTime) / 86400000))
  s.activeDays = daySet.size

  const days = [...daySet].sort()
  let streak = 1
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime()
    const cur = new Date(days[i]).getTime()
    if (cur - prev <= 86400000 * 1.5) {
      streak++
      s.longestStreak = Math.max(s.longestStreak, streak)
    } else {
      streak = 1
    }
  }
  s.longestStreak = Math.max(s.longestStreak, days.length ? 1 : 0)

  s.monthly = [...monthMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([ym, v]) => ({ ym, ...v }))

  return s
}

export function categoryVisits(stats, cat) {
  return stats.categoryCounts[cat] || 0
}

export function formatKm(km) {
  if (km >= 10000) return `${Math.round(km).toLocaleString()} km`
  if (km >= 100) return `${Math.round(km)} km`
  return `${km.toFixed(1)} km`
}

export const CATEGORY_DEFS = CATEGORIES
