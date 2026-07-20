import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ALLOWED_ORIGINS,
  GOOGLE_FIELD_MASK,
  LOOKUP_LIMITS,
  LookupValidationError,
  buildGoogleNearbyBody,
  buildUsage,
  haversineMeters,
  isAllowedOrigin,
  normalizeGooglePlacesResponse,
  quotaErrorCode,
  validateLookupBody,
} from '../supabase/functions/jq-place-candidates/logic.js'

test('lookup body accepts only finite latitude and longitude', () => {
  assert.deepEqual(validateLookupBody({ latitude: 35.6812, longitude: 139.7671 }), {
    latitude: 35.6812,
    longitude: 139.7671,
  })

  for (const invalid of [
    null,
    [],
    { latitude: 35 },
    { latitude: 35, longitude: 139, name: '送信しない' },
    { latitude: '35', longitude: 139 },
    { latitude: 91, longitude: 139 },
    { latitude: 35, longitude: -181 },
    { latitude: Number.NaN, longitude: 139 },
  ]) {
    assert.throws(() => validateLookupBody(invalid), LookupValidationError)
  }
})

test('Nearby Search body is one 120m distance-ranked request with at most five results', () => {
  const body = buildGoogleNearbyBody({
    latitude: 35.6812,
    longitude: 139.7671,
  })

  assert.deepEqual(body, {
    locationRestriction: {
      circle: {
        center: { latitude: 35.6812, longitude: 139.7671 },
        radius: 120,
      },
    },
    maxResultCount: 5,
    rankPreference: 'DISTANCE',
    languageCode: 'ja',
    regionCode: 'JP',
  })
  assert.equal(LOOKUP_LIMITS.monthlyRequests, 4500)
})

test('Google field mask contains only the required candidate fields', () => {
  assert.equal(
    GOOGLE_FIELD_MASK,
    [
      'places.id',
      'places.displayName',
      'places.formattedAddress',
      'places.primaryType',
      'places.primaryTypeDisplayName',
      'places.location',
      'places.googleMapsUri',
      'places.attributions',
    ].join(','),
  )
})

test('haversine distance is measured in meters', () => {
  const distance = haversineMeters(
    { latitude: 35, longitude: 139 },
    { latitude: 35.001, longitude: 139 },
  )
  assert.ok(distance > 110 && distance < 112)
})

test('Google results are sanitized, de-duplicated, distance sorted, and contain no coordinates', () => {
  const origin = { latitude: 35, longitude: 139 }
  const places = [
    {
      id: 'far',
      displayName: { text: '遠い施設' },
      formattedAddress: '東京都',
      primaryType: 'gym',
      primaryTypeDisplayName: { text: 'ジム' },
      location: { latitude: 35.0008, longitude: 139 },
      googleMapsUri: 'https://maps.google.com/?cid=far',
      attributions: [
        {
          provider: 'Example Provider',
          providerUri: 'https://example.com/source',
        },
      ],
    },
    {
      id: 'near',
      displayName: { text: '近い施設' },
      formattedAddress: '東京都千代田区',
      primaryType: 'cafe',
      primaryTypeDisplayName: { text: 'カフェ' },
      location: { latitude: 35.0001, longitude: 139 },
      googleMapsUri: 'javascript:alert(1)',
    },
    {
      id: 'near',
      displayName: { text: '重複' },
      location: { latitude: 35.0002, longitude: 139 },
    },
    {
      id: 'broken',
      displayName: { text: '座標なし' },
    },
  ]

  const candidates = normalizeGooglePlacesResponse({ places }, origin)
  assert.equal(candidates.length, 2)
  assert.equal(candidates[0].id, 'near')
  assert.equal(candidates[0].googleMapsUri, '')
  assert.equal(candidates[1].id, 'far')
  assert.equal(candidates[1].typeLabel, 'ジム')
  assert.deepEqual(candidates[1].attributions, [
    {
      provider: 'Example Provider',
      providerUri: 'https://example.com/source',
    },
  ])

  const serialized = JSON.stringify(candidates)
  assert.doesNotMatch(serialized, /"latitude"|"longitude"|"location"/)
})

test('normalizer returns no more than five candidates', () => {
  const places = Array.from({ length: 8 }, (_, index) => ({
    id: `place-${index}`,
    displayName: { text: `施設${index}` },
    location: { latitude: 35 + index / 10000, longitude: 139 },
  }))

  assert.equal(
    normalizeGooglePlacesResponse(
      { places },
      { latitude: 35, longitude: 139 },
    ).length,
    5,
  )
})

test('CORS allowlist is exact', () => {
  assert.deepEqual(ALLOWED_ORIGINS, [
    'https://jibunq.com',
    'https://www.jibunq.com',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
  ])

  for (const origin of ALLOWED_ORIGINS) {
    assert.equal(isAllowedOrigin(origin), true)
  }
  assert.equal(isAllowedOrigin('https://evil.example'), false)
  assert.equal(isAllowedOrigin('https://jibunq.com.evil.example'), false)
  assert.equal(isAllowedOrigin('http://localhost:5176'), false)
  assert.equal(isAllowedOrigin(null), false)
})

test('frontend quota contract exposes remaining count and monthly error code', () => {
  assert.deepEqual(buildUsage(4499), {
    used: 4499,
    limit: 4500,
    remaining: 1,
  })
  assert.deepEqual(buildUsage(4500), {
    used: 4500,
    limit: 4500,
    remaining: 0,
  })
  assert.equal(quotaErrorCode('monthly'), 'monthly_limit')
  assert.equal(quotaErrorCode('minute'), 'rate_limited')
  assert.equal(quotaErrorCode('day'), 'rate_limited')
})
