import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PlaceSuggestionError,
  buildConfirmedPlaceLink,
  buildPlaceLookupPayload,
  googleTypeToCategory,
  normalizePlaceSuggestion,
  requestPlaceSuggestions,
} from '../src/place-suggestions.js'

test('候補検索へは選択地点の緯度経度だけを渡す', () => {
  const place = {
    lat: 35.681236,
    lng: 139.767125,
    name: '秘密の場所',
    visits: [{ start: 123 }],
    route: [[35, 139]],
  }
  assert.deepEqual(buildPlaceLookupPayload(place), {
    latitude: 35.681236,
    longitude: 139.767125,
  })
})

test('不正な座標を送らない', () => {
  assert.throws(
    () => buildPlaceLookupPayload({ lat: 91, lng: 139 }),
    (error) => error instanceof PlaceSuggestionError && error.code === 'invalid_location'
  )
})

test('Googleの施設種別をアプリのカテゴリへ対応させる', () => {
  assert.equal(googleTypeToCategory('gym'), 'gym')
  assert.equal(googleTypeToCategory('coffee_shop'), 'cafe')
  assert.equal(googleTypeToCategory('train_station'), 'station')
  assert.equal(googleTypeToCategory('unknown_new_type'), 'other')
})

test('確認後に保存するのはPlace IDと利用者が選んだカテゴリだけ', () => {
  const link = buildConfirmedPlaceLink({
    id: 'places/gym',
    name: '保存してはいけない施設名',
    address: '保存してはいけない住所',
    primaryType: 'gym',
  }, 'gym')

  assert.deepEqual(link, {
    googlePlaceId: 'places/gym',
    category: 'gym',
  })
  assert.doesNotMatch(JSON.stringify(link), /施設名|住所|primaryType/)
  assert.throws(
    () => buildConfirmedPlaceLink({ id: 'places/gym' }, 'not-a-category'),
    (error) => error instanceof PlaceSuggestionError && error.code === 'invalid_link'
  )
})

test('候補を防御的に正規化してGoogle以外のリンクを除外する', () => {
  assert.deepEqual(normalizePlaceSuggestion({
    id: 'places/abc',
    name: '  テストジム  ',
    address: '東京都',
    primaryType: 'gym',
    typeLabel: 'スポーツジム',
    distanceMeters: 21.7,
    googleMapsUri: 'https://www.google.com/maps/place/?q=place_id:abc',
    attributions: [{
      provider: '施設データ提供者',
      providerUri: 'https://provider.example/',
    }],
  }), {
    id: 'places/abc',
    name: 'テストジム',
    address: '東京都',
    primaryType: 'gym',
    typeLabel: 'スポーツジム',
    distanceMeters: 22,
    category: 'gym',
    googleMapsUri: 'https://www.google.com/maps/place/?q=place_id:abc',
    attributions: [{
      provider: '施設データ提供者',
      providerUri: 'https://provider.example/',
    }],
  })

  assert.equal(normalizePlaceSuggestion({
    id: 'x',
    name: '危険なリンク',
    googleMapsUri: 'https://example.com/',
  }).googleMapsUri, '')
  assert.equal(normalizePlaceSuggestion({
    id: 'x',
    name: '危険なリンク',
    attributions: [{ provider: '危険', providerUri: 'javascript:alert(1)' }],
  }).attributions[0].providerUri, '')
  assert.equal(normalizePlaceSuggestion({ id: '', name: '名前' }), null)
})

test('1回の操作で座標だけを1回POSTし候補を返す', async () => {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({
      candidates: [{
        id: 'places/gym',
        name: '駅前ジム',
        primaryType: 'gym',
        distanceMeters: 18,
      }],
      usage: { remaining: 4499 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const result = await requestPlaceSuggestions(
    { lat: 35.1, lng: 139.2, name: '送信しない' },
    { fetchImpl }
  )

  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    latitude: 35.1,
    longitude: 139.2,
  })
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(result.candidates[0].category, 'gym')
  assert.equal(result.usage.remaining, 4499)
})

test('月間上限と短時間制限を区別して案内する', async () => {
  const monthlyFetch = async () => new Response(
    JSON.stringify({ code: 'monthly_limit' }),
    { status: 429, headers: { 'Content-Type': 'application/json' } }
  )
  await assert.rejects(
    requestPlaceSuggestions({ lat: 35, lng: 139 }, { fetchImpl: monthlyFetch }),
    (error) => error.code === 'monthly_limit' && /翌月/.test(error.message)
  )

  const burstFetch = async () => new Response(
    JSON.stringify({ code: 'rate_limited' }),
    { status: 429, headers: { 'Content-Type': 'application/json' } }
  )
  await assert.rejects(
    requestPlaceSuggestions({ lat: 35, lng: 139 }, { fetchImpl: burstFetch }),
    (error) => error.code === 'rate_limited' && /少し待って/.test(error.message)
  )
})
