import { CATEGORIES } from './categories.js'

const PLACE_SUGGESTIONS_URL =
  'https://zkquchdaizdjrvlsncbs.supabase.co/functions/v1/jq-place-candidates'

const TYPE_TO_CATEGORY = {
  home_goods_store: 'shopping',
  shopping_mall: 'shopping',
  department_store: 'shopping',
  clothing_store: 'shopping',
  electronics_store: 'shopping',
  bookstore: 'shopping',
  store: 'shopping',
  convenience_store: 'convenience',
  grocery_store: 'supermarket',
  supermarket: 'supermarket',
  cafe: 'cafe',
  coffee_shop: 'cafe',
  bakery: 'cafe',
  restaurant: 'restaurant',
  bar: 'restaurant',
  meal_takeaway: 'restaurant',
  train_station: 'station',
  subway_station: 'station',
  light_rail_station: 'station',
  transit_station: 'station',
  bus_station: 'station',
  bus_stop: 'station',
  airport: 'airport',
  gym: 'gym',
  fitness_center: 'gym',
  sports_complex: 'gym',
  swimming_pool: 'gym',
  park: 'park',
  garden: 'park',
  hiking_area: 'park',
  campground: 'park',
  hospital: 'hospital',
  doctor: 'hospital',
  dentist: 'hospital',
  pharmacy: 'hospital',
  drugstore: 'hospital',
  hotel: 'hotel',
  lodging: 'hotel',
  school: 'school',
  university: 'school',
  library: 'school',
  shrine: 'shrine',
  place_of_worship: 'shrine',
  buddhist_temple: 'shrine',
  church: 'shrine',
  hindu_temple: 'shrine',
  mosque: 'shrine',
  movie_theater: 'entertainment',
  amusement_park: 'entertainment',
  amusement_center: 'entertainment',
  bowling_alley: 'entertainment',
  museum: 'entertainment',
  tourist_attraction: 'entertainment',
  zoo: 'entertainment',
  aquarium: 'entertainment',
  night_club: 'entertainment',
}

export class PlaceSuggestionError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PlaceSuggestionError'
    this.code = code
  }
}

export function buildPlaceLookupPayload(place) {
  const latitude = Number(place?.lat)
  const longitude = Number(place?.lng)
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new PlaceSuggestionError('invalid_location', 'この場所の座標を確認できませんでした。')
  }
  return { latitude, longitude }
}

export function googleTypeToCategory(type) {
  return TYPE_TO_CATEGORY[String(type || '').toLowerCase()] || 'other'
}

const cleanText = (value, maxLength) => {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

export function buildConfirmedPlaceLink(candidate, category) {
  const googlePlaceId = cleanText(candidate?.id, 256)
  if (!googlePlaceId || !Object.hasOwn(CATEGORIES, category)) {
    throw new PlaceSuggestionError('invalid_link', '場所とカテゴリを確認できませんでした。')
  }
  return { googlePlaceId, category }
}

const safeGoogleMapsUrl = (value) => {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    if (
      url.protocol === 'https:' &&
      (url.hostname === 'google.com' || url.hostname.endsWith('.google.com'))
    ) {
      return url.href
    }
  } catch {}
  return ''
}

const safeHttpsUrl = (value) => {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : ''
  } catch {}
  return ''
}

export function normalizePlaceSuggestion(candidate) {
  const id = cleanText(candidate?.id, 256)
  const name = cleanText(candidate?.name, 160)
  if (!id || !name) return null
  const primaryType = cleanText(candidate?.primaryType, 80).toLowerCase()
  const distance = Number(candidate?.distanceMeters)
  return {
    id,
    name,
    address: cleanText(candidate?.address, 240),
    primaryType,
    typeLabel: cleanText(candidate?.typeLabel, 80),
    distanceMeters: Number.isFinite(distance) && distance >= 0 ? Math.round(distance) : null,
    category: googleTypeToCategory(primaryType),
    googleMapsUri: safeGoogleMapsUrl(candidate?.googleMapsUri),
    attributions: Array.isArray(candidate?.attributions)
      ? candidate.attributions
        .map((attribution) => ({
          provider: cleanText(attribution?.provider, 160),
          providerUri: safeHttpsUrl(attribution?.providerUri),
        }))
        .filter((attribution) => attribution.provider || attribution.providerUri)
        .slice(0, 10)
      : [],
  }
}

const errorForResponse = (status, body) => {
  const serverCode = typeof body?.code === 'string' ? body.code : ''
  if (status === 429 && serverCode === 'monthly_limit') {
    return new PlaceSuggestionError(
      'monthly_limit',
      '今月の候補検索は上限に達しました。翌月にもう一度お試しください。'
    )
  }
  if (status === 429) {
    return new PlaceSuggestionError(
      'rate_limited',
      '短時間に検索が集中しています。少し待ってからもう一度お試しください。'
    )
  }
  if (status === 400) {
    return new PlaceSuggestionError('invalid_location', 'この場所の座標を確認できませんでした。')
  }
  return new PlaceSuggestionError(
    serverCode || 'unavailable',
    '候補を取得できませんでした。時間をおいてもう一度お試しください。'
  )
}

export async function requestPlaceSuggestions(place, {
  fetchImpl = globalThis.fetch,
  signal,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new PlaceSuggestionError('unavailable', '候補検索を利用できません。')
  }
  const payload = buildPlaceLookupPayload(place)
  let response
  try {
    response = await fetchImpl(PLACE_SUGGESTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new PlaceSuggestionError(
      'network',
      '候補検索サーバーへ接続できませんでした。通信状態を確認してください。'
    )
  }

  let body = null
  try {
    body = await response.json()
  } catch {}
  if (!response.ok) throw errorForResponse(response.status, body)

  const candidates = Array.isArray(body?.candidates)
    ? body.candidates.map(normalizePlaceSuggestion).filter(Boolean).slice(0, 5)
    : []
  const remaining = Number(body?.usage?.remaining)
  return {
    candidates,
    usage: {
      remaining: Number.isInteger(remaining) && remaining >= 0 ? remaining : null,
    },
  }
}
