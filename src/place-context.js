import { placeKeyOf } from './categories.js'
import { haversine } from './parse.js'

const MAX_CONTEXT_GAP_MS = 12 * 60 * 60 * 1000
const ROUTE_WINDOW_MS = 4 * 60 * 60 * 1000
const MAP_RADIUS_METERS = 5_000

const validPoint = (p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lng)

const localDayKey = (time) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

const resolvedName = (visit, placeMap) => {
  const place = placeMap.get(placeKeyOf(visit))
  if (place?.name) return place.name
  if (visit.name) return visit.name
  if (visit.semanticType === 'HOME') return '自宅'
  if (visit.semanticType === 'WORK') return '職場・学校'
  return null
}

export function directionFrom(from, to) {
  if (!validPoint(from) || !validPoint(to)) return null
  const toRad = (value) => (value * Math.PI) / 180
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const deltaLng = toRad(to.lng - from.lng)
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
  return ['北', '北東', '東', '南東', '南', '南西', '西', '北西'][Math.round(bearing / 45) % 8]
}

export function timeBandLabel(hour) {
  if (hour < 5) return '深夜'
  if (hour < 11) return '朝'
  if (hour < 16) return '昼'
  if (hour < 19) return '夕方'
  return '夜'
}

export function createPlaceContextIndex(data) {
  const visits = Array.isArray(data?.visits) ? data.visits : []
  const paths = Array.isArray(data?.paths) ? data.paths : []
  const orderedVisits = [...visits]
    .filter((visit) => Number.isFinite(visit?.start))
    .sort((a, b) => a.start - b.start)
  const visitKeys = []
  const visitsByKey = new Map()
  const visitIndexesByKey = new Map()
  const visitsByDay = new Map()

  orderedVisits.forEach((visit, index) => {
    const key = placeKeyOf(visit)
    const day = localDayKey(visit.start)
    visitKeys.push(key)
    if (!visitsByKey.has(key)) visitsByKey.set(key, [])
    if (!visitIndexesByKey.has(key)) visitIndexesByKey.set(key, [])
    if (!visitsByDay.has(day)) visitsByDay.set(day, [])
    visitsByKey.get(key).push(visit)
    visitIndexesByKey.get(key).push(index)
    visitsByDay.get(day).push(visit)
  })

  const pathSegmentsByDay = new Map()
  const addPathSegment = (day, segment) => {
    if (!day || segment.length < 2) return
    if (!pathSegmentsByDay.has(day)) pathSegmentsByDay.set(day, [])
    pathSegmentsByDay.get(day).push(segment)
  }

  for (const path of paths) {
    if (!Array.isArray(path)) continue
    let currentDay = null
    let currentSegment = []
    for (const point of path) {
      if (!validPoint(point) || !Number.isFinite(point.time)) {
        addPathSegment(currentDay, currentSegment)
        currentDay = null
        currentSegment = []
        continue
      }
      const day = localDayKey(point.time)
      if (currentDay && day !== currentDay) {
        addPathSegment(currentDay, currentSegment)
        currentSegment = []
      }
      currentDay = day
      currentSegment.push({ lat: point.lat, lng: point.lng, time: point.time })
    }
    addPathSegment(currentDay, currentSegment)
  }

  return {
    orderedVisits,
    visitKeys,
    visitsByKey,
    visitIndexesByKey,
    visitsByDay,
    pathSegmentsByDay,
  }
}

export function buildPlaceContext(indexOrData, selectedPlace, places) {
  if (!selectedPlace) return null

  const indexData = indexOrData?.visitsByKey instanceof Map
    ? indexOrData
    : createPlaceContextIndex(indexOrData)
  const placeMap = new Map((places || []).map((place) => [place.key, place]))
  const orderedVisits = indexData.orderedVisits
  const visitKeys = indexData.visitKeys
  const rawSelectedVisits = indexData.visitsByKey.get(selectedPlace.key) || []

  const selectedVisits = rawSelectedVisits
    .map((visit) => ({
      start: visit.start,
      end: Number.isFinite(visit.end) ? visit.end : visit.start,
      durationMin: Math.max(0, ((Number.isFinite(visit.end) ? visit.end : visit.start) - visit.start) / 60_000),
    }))

  const recentVisits = [...selectedVisits].reverse().slice(0, 3)
  const averageStayMin = selectedVisits.length
    ? selectedVisits.reduce((sum, visit) => sum + visit.durationMin, 0) / selectedVisits.length
    : 0

  const bandCounts = new Map()
  let weekdayCount = 0
  let weekendCount = 0
  for (const visit of selectedVisits) {
    const d = new Date(visit.start)
    const band = timeBandLabel(d.getHours())
    const bandStat = bandCounts.get(band) || { count: 0, lastVisit: 0 }
    bandCounts.set(band, { count: bandStat.count + 1, lastVisit: Math.max(bandStat.lastVisit, visit.start) })
    if (d.getDay() === 0 || d.getDay() === 6) weekendCount++
    else weekdayCount++
  }
  const commonBand = [...bandCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].lastVisit - a[1].lastVisit)[0]?.[0] || null
  const commonDayType = weekendCount === weekdayCount && weekdayCount
    ? '平日・週末'
    : weekendCount > weekdayCount
      ? '週末'
      : weekdayCount
        ? '平日'
        : null
  const typicalTime = commonBand ? `${commonDayType ? `${commonDayType}の` : ''}${commonBand}` : null

  const selectedIndexes = indexData.visitIndexesByKey.get(selectedPlace.key) || []
  const latestIndex = selectedIndexes.length ? selectedIndexes[selectedIndexes.length - 1] : null
  const latestRawVisit = latestIndex == null ? null : orderedVisits[latestIndex]

  let previousPlace = null
  let nextPlace = null
  if (latestRawVisit) {
    for (let index = latestIndex - 1; index >= 0; index--) {
      const candidate = orderedVisits[index]
      if (visitKeys[index] === selectedPlace.key) continue
      const gap = latestRawVisit.start - (Number.isFinite(candidate.end) ? candidate.end : candidate.start)
      if (gap >= MAX_CONTEXT_GAP_MS) break
      const name = resolvedName(candidate, placeMap)
      if (name) {
        previousPlace = { name, gapMin: Math.max(0, gap / 60_000) }
        break
      }
    }
    for (let index = latestIndex + 1; index < orderedVisits.length; index++) {
      const candidate = orderedVisits[index]
      if (visitKeys[index] === selectedPlace.key) continue
      const selectedEnd = Number.isFinite(latestRawVisit.end) ? latestRawVisit.end : latestRawVisit.start
      const gap = candidate.start - selectedEnd
      if (gap >= MAX_CONTEXT_GAP_MS) break
      const name = resolvedName(candidate, placeMap)
      if (name) {
        nextPlace = { name, gapMin: Math.max(0, gap / 60_000) }
        break
      }
    }
  }

  const distanceModels = (places || [])
    .filter((place) => place.key !== selectedPlace.key && validPoint(place))
    .map((place) => ({
      ...place,
      distanceMeters: haversine(selectedPlace.lat, selectedPlace.lng, place.lat, place.lng),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)

  const namedAnchors = distanceModels
    .filter((place) => place.name)
    .slice(0, 3)
    .map((place) => {
      const sameLocation = place.distanceMeters < 20
      return {
        ...place,
        sameLocation,
        direction: sameLocation ? null : directionFrom(place, selectedPlace),
      }
    })

  const mapPlaces = distanceModels
    .filter((place) => place.distanceMeters <= MAP_RADIUS_METERS)
    .slice(0, 30)

  let routeSegments = []
  let routeKind = null
  if (latestRawVisit) {
    const visitDay = localDayKey(latestRawVisit.start)
    const visitEnd = Number.isFinite(latestRawVisit.end) ? latestRawVisit.end : latestRawVisit.start
    const windowStart = latestRawVisit.start - ROUTE_WINDOW_MS
    const windowEnd = visitEnd + ROUTE_WINDOW_MS
    const routeDays = [...new Set([
      localDayKey(windowStart),
      visitDay,
      localDayKey(windowEnd),
    ])]
    const indexedSegments = routeDays.flatMap((day) => indexData.pathSegmentsByDay.get(day) || [])

    for (const segment of indexedSegments) {
      let clipped = []
      const flush = () => {
        if (clipped.length > 1) routeSegments.push(clipped)
        clipped = []
      }
      for (const point of segment) {
        const visible =
          point.time >= windowStart &&
          point.time <= windowEnd &&
          haversine(selectedPlace.lat, selectedPlace.lng, point.lat, point.lng) <= MAP_RADIUS_METERS
        if (visible) clipped.push({ lat: point.lat, lng: point.lng })
        else flush()
      }
      flush()
    }
    if (routeSegments.length) routeKind = 'recorded'

    if (!routeSegments.length) {
      const dayStops = routeDays
        .flatMap((day) => indexData.visitsByDay.get(day) || [])
        .filter((visit) =>
          validPoint(visit) &&
          visit.start >= windowStart &&
          visit.start <= windowEnd &&
          haversine(selectedPlace.lat, selectedPlace.lng, visit.lat, visit.lng) <= MAP_RADIUS_METERS
        )
        .sort((a, b) => a.start - b.start)
        .map(({ lat, lng }) => ({ lat, lng }))
      if (dayStops.length > 1) {
        routeSegments = [dayStops]
        routeKind = 'estimated'
      }
    }
  }

  return {
    recentVisits,
    averageStayMin,
    typicalTime,
    previousPlace,
    nextPlace,
    namedAnchors,
    mapPlaces,
    routeSegments,
    routeKind,
  }
}
