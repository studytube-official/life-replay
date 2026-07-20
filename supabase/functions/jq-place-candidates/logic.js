export const GOOGLE_NEARBY_URL =
  'https://places.googleapis.com/v1/places:searchNearby'

export const GOOGLE_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.location',
  'places.googleMapsUri',
  'places.attributions',
].join(',')

export const LOOKUP_LIMITS = Object.freeze({
  radiusMeters: 120,
  maxResults: 5,
  maxRequestBytes: 1024,
  monthlyRequests: 4500,
  requestsPerMinute: 10,
  requestsPerDay: 100,
})

export const ALLOWED_ORIGINS = Object.freeze([
  'https://jibunq.com',
  'https://www.jibunq.com',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
])

export class LookupValidationError extends Error {
  constructor(message, code = 'invalid_request') {
    super(message)
    this.name = 'LookupValidationError'
    this.code = code
  }
}

export function isAllowedOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.includes(origin)
}

export function buildUsage(monthUsed, monthLimit = LOOKUP_LIMITS.monthlyRequests) {
  if (
    !Number.isInteger(monthUsed) ||
    monthUsed < 0 ||
    !Number.isInteger(monthLimit) ||
    monthLimit < 0
  ) {
    throw new LookupValidationError(
      '利用回数の形式が不正です。',
      'invalid_quota_response',
    )
  }

  return {
    used: monthUsed,
    limit: monthLimit,
    remaining: Math.max(0, monthLimit - monthUsed),
  }
}

export function quotaErrorCode(reason) {
  return reason === 'monthly' ? 'monthly_limit' : 'rate_limited'
}

export function validateLookupBody(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LookupValidationError('JSONオブジェクトが必要です。')
  }

  const keys = Object.keys(value).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== 'latitude' ||
    keys[1] !== 'longitude'
  ) {
    throw new LookupValidationError(
      'latitude と longitude だけを指定してください。',
    )
  }

  const { latitude, longitude } = value
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) {
    throw new LookupValidationError('latitude が範囲外です。')
  }

  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new LookupValidationError('longitude が範囲外です。')
  }

  return Object.freeze({ latitude, longitude })
}

export function buildGoogleNearbyBody({ latitude, longitude }) {
  return {
    locationRestriction: {
      circle: {
        center: { latitude, longitude },
        radius: LOOKUP_LIMITS.radiusMeters,
      },
    },
    maxResultCount: LOOKUP_LIMITS.maxResults,
    rankPreference: 'DISTANCE',
    languageCode: 'ja',
    regionCode: 'JP',
  }
}

export function haversineMeters(from, to) {
  const earthRadiusMeters = 6371008.8
  const toRadians = (degrees) => (degrees * Math.PI) / 180
  const latitudeDelta = toRadians(to.latitude - from.latitude)
  const longitudeDelta = toRadians(to.longitude - from.longitude)
  const latitude1 = toRadians(from.latitude)
  const latitude2 = toRadians(to.latitude)

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitude1) *
      Math.cos(latitude2) *
      Math.sin(longitudeDelta / 2) ** 2

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function limitedText(value, maxLength) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maxLength)
}

function safeHttpsUrl(value, maxLength = 2048) {
  const text = limitedText(value, maxLength)
  if (!text) return ''

  try {
    const url = new URL(text)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}

function normalizeAttributions(value) {
  if (!Array.isArray(value)) return []

  return value
    .slice(0, 10)
    .map((attribution) => {
      if (
        attribution === null ||
        typeof attribution !== 'object' ||
        Array.isArray(attribution)
      ) {
        return null
      }

      const provider = limitedText(attribution.provider, 160)
      const providerUri = safeHttpsUrl(attribution.providerUri)
      return provider || providerUri ? { provider, providerUri } : null
    })
    .filter(Boolean)
}

function normalizePlace(place, origin) {
  if (place === null || typeof place !== 'object' || Array.isArray(place)) {
    return null
  }

  const placeId = limitedText(place.id, 256)
  const name = limitedText(place.displayName?.text, 200)
  const latitude = place.location?.latitude
  const longitude = place.location?.longitude
  if (
    !placeId ||
    !name ||
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null
  }

  return {
    id: placeId,
    name,
    address: limitedText(place.formattedAddress, 400),
    primaryType: limitedText(place.primaryType, 120),
    typeLabel: limitedText(place.primaryTypeDisplayName?.text, 160),
    distanceMeters: Math.round(
      haversineMeters(origin, { latitude, longitude }),
    ),
    googleMapsUri: safeHttpsUrl(place.googleMapsUri),
    attributions: normalizeAttributions(place.attributions),
  }
}

export function normalizeGooglePlacesResponse(payload, originInput) {
  const origin = validateLookupBody(originInput)
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LookupValidationError(
      'Google Placesの応答形式が不正です。',
      'invalid_google_response',
    )
  }

  if (payload.places !== undefined && !Array.isArray(payload.places)) {
    throw new LookupValidationError(
      'Google Placesの応答形式が不正です。',
      'invalid_google_response',
    )
  }

  const byPlaceId = new Map()
  for (const rawPlace of payload.places ?? []) {
    const candidate = normalizePlace(rawPlace, origin)
    if (!candidate) continue

    const current = byPlaceId.get(candidate.id)
    if (!current || candidate.distanceMeters < current.distanceMeters) {
      byPlaceId.set(candidate.id, candidate)
    }
  }

  return [...byPlaceId.values()]
    .sort(
      (left, right) =>
        left.distanceMeters - right.distanceMeters ||
        left.name.localeCompare(right.name, 'ja'),
    )
    .slice(0, LOOKUP_LIMITS.maxResults)
}
