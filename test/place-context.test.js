import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPlaceContext,
  createPlaceContextIndex,
  directionFrom,
  timeBandLabel,
} from '../src/place-context.js'

const at = (day, hour, minute = 0) => new Date(2026, 6, day, hour, minute).getTime()

const visit = (placeId, start, lat, lng, durationMin = 30, extra = {}) => ({
  placeId,
  start,
  end: start + durationMin * 60_000,
  lat,
  lng,
  name: null,
  semanticType: null,
  ...extra,
})

test('訪問履歴から日時・平均滞在・前後の名前を端末内で組み立てる', () => {
  const places = [
    { key: 'target', name: null, lat: 35.01, lng: 139, count: 2, rank: 1 },
    { key: 'home', name: '自宅', lat: 35, lng: 139, count: 8, rank: 2 },
    { key: 'cafe', name: 'いつものカフェ', lat: 35.015, lng: 139.005, count: 4, rank: 3 },
  ]
  const visits = [
    visit('target', at(10, 19), 35.01, 139, 30),
    visit('home', at(12, 17), 35, 139, 50),
    visit('target', at(12, 18), 35.01, 139, 90),
    visit('cafe', at(12, 20), 35.015, 139.005, 40),
  ]
  const before = structuredClone(visits)

  const context = buildPlaceContext({ visits, paths: [] }, places[0], places)

  assert.deepEqual(visits, before)
  assert.equal(context.recentVisits.length, 2)
  assert.equal(context.recentVisits[0].start, at(12, 18))
  assert.equal(context.averageStayMin, 60)
  assert.equal(context.typicalTime, '平日・週末の夕方')
  assert.equal(context.previousPlace.name, '自宅')
  assert.equal(context.nextPlace.name, 'いつものカフェ')
})

test('名前付き地点からの距離と8方位を返し、未命名地点は基準にしない', () => {
  const target = { key: 'target', name: null, lat: 35.01, lng: 139, count: 1, rank: 1 }
  const home = { key: 'home', name: '自宅', lat: 35, lng: 139, count: 3, rank: 2 }
  const unnamed = { key: 'other', name: null, lat: 35.005, lng: 139, count: 2, rank: 3 }

  const context = buildPlaceContext({
    visits: [visit('target', at(12, 18), target.lat, target.lng)],
    paths: [],
  }, target, [target, unnamed, home])

  assert.equal(directionFrom(home, target), '北')
  assert.equal(directionFrom(target, { lat: 35.01, lng: 139.01 }), '東')
  assert.equal(context.namedAnchors.length, 1)
  assert.equal(context.namedAnchors[0].name, '自宅')
  assert.equal(context.namedAnchors[0].direction, '北')
  assert.ok(context.namedAnchors[0].distanceMeters > 1000)
  assert.ok(context.namedAnchors[0].distanceMeters < 1200)
})

test('12時間以上離れた訪問は前後の手がかりにせず、負の滞在時間を0にする', () => {
  const target = { key: 'target', name: null, lat: 35, lng: 139, count: 1, rank: 1 }
  const home = { key: 'home', name: '自宅', lat: 35.01, lng: 139, count: 1, rank: 2 }
  const targetVisit = visit('target', at(12, 18), 35, 139, 30)
  targetVisit.end = targetVisit.start - 60_000

  const context = buildPlaceContext({
    visits: [
      visit('home', at(11, 1), 35.01, 139),
      targetVisit,
      visit('home', at(14, 8), 35.01, 139),
    ],
    paths: [],
  }, target, [target, home])

  assert.equal(context.recentVisits[0].durationMin, 0)
  assert.equal(context.previousPlace, null)
  assert.equal(context.nextPlace, null)
})

test('ちょうど12時間離れた名前付き地点も前後の手がかりにしない', () => {
  const target = { key: 'target', name: null, lat: 35, lng: 139, count: 1, rank: 1 }
  const home = { key: 'home', name: '自宅', lat: 35.01, lng: 139, count: 1, rank: 2 }
  const cafe = { key: 'cafe', name: 'カフェ', lat: 35.02, lng: 139, count: 1, rank: 3 }
  const targetVisit = visit('target', at(12, 17, 30), target.lat, target.lng, 30)

  const context = buildPlaceContext({
    visits: [
      visit('home', at(12, 5), home.lat, home.lng, 30),
      targetVisit,
      visit('cafe', at(13, 6), cafe.lat, cafe.lng, 30),
    ],
    paths: [],
  }, target, [target, home, cafe])

  assert.equal(context.previousPlace, null)
  assert.equal(context.nextPlace, null)
})

test('隣が未命名でも12時間以内の名前付き地点まで前後をたどる', () => {
  const target = { key: 'target', name: null, lat: 35, lng: 139, count: 1, rank: 1 }
  const home = { key: 'home', name: '自宅', lat: 35.01, lng: 139, count: 1, rank: 2 }
  const unknown = { key: 'unknown', name: null, lat: 35.005, lng: 139, count: 1, rank: 3 }
  const cafe = { key: 'cafe', name: 'カフェ', lat: 35.015, lng: 139, count: 1, rank: 4 }

  const context = buildPlaceContext({
    visits: [
      visit('home', at(12, 14), home.lat, home.lng),
      visit('unknown', at(12, 15), unknown.lat, unknown.lng),
      visit('target', at(12, 16), target.lat, target.lng),
      visit('unknown', at(12, 17), unknown.lat, unknown.lng),
      visit('cafe', at(12, 18), cafe.lat, cafe.lng),
    ],
    paths: [],
  }, target, [target, home, unknown, cafe])

  assert.equal(context.previousPlace.name, '自宅')
  assert.equal(context.nextPlace.name, 'カフェ')
})

test('名前付き地点と20m未満なら方角ではなく同じ位置として扱う', () => {
  const target = { key: 'target', name: null, lat: 35, lng: 139, count: 1, rank: 1 }
  const building = { key: 'building', name: '駅ビル', lat: 35, lng: 139, count: 1, rank: 2 }

  const context = buildPlaceContext({
    visits: [visit('target', at(12, 18), target.lat, target.lng)],
    paths: [],
  }, target, [target, building])

  assert.equal(context.namedAnchors[0].sameLocation, true)
  assert.equal(context.namedAnchors[0].direction, null)
})

test('直近訪問日の経路だけを抽出する', () => {
  const target = { key: 'target', name: null, lat: 35, lng: 139, count: 1, rank: 1 }
  const pathToday = [
    { time: at(12, 17), lat: 35, lng: 138.99 },
    { time: at(12, 18), lat: 35, lng: 139 },
  ]
  const pathOld = [
    { time: at(10, 17), lat: 35, lng: 138.98 },
    { time: at(10, 18), lat: 35, lng: 138.99 },
  ]

  const context = buildPlaceContext({
    visits: [visit('target', at(12, 18), 35, 139)],
    paths: [pathOld, pathToday],
  }, target, [target])

  assert.equal(context.routeSegments.length, 1)
  assert.deepEqual(context.routeSegments[0], pathToday.map(({ lat, lng }) => ({ lat, lng })))
  assert.equal(context.routeKind, 'recorded')
})

test('経路の時間・距離範囲外を除外し、離れた線をつながない', () => {
  const target = { key: 'target', name: null, lat: 35, lng: 139, count: 1, rank: 1 }
  const path = [
    { time: at(12, 16), lat: 35, lng: 139 },
    { time: at(12, 17), lat: 35.001, lng: 139 },
    { time: at(12, 17, 30), lat: 35.1, lng: 139 },
    { time: at(12, 18), lat: 35.002, lng: 139 },
    { time: at(12, 19), lat: 35.003, lng: 139 },
  ]
  const index = createPlaceContextIndex({
    visits: [visit('target', at(12, 18), target.lat, target.lng)],
    paths: [path],
  })

  const context = buildPlaceContext(index, target, [target])

  assert.equal(index.visitsByKey.get('target').length, 1)
  assert.equal(context.routeSegments.length, 2)
  assert.deepEqual(context.routeSegments[0], path.slice(0, 2).map(({ lat, lng }) => ({ lat, lng })))
  assert.deepEqual(context.routeSegments[1], path.slice(3).map(({ lat, lng }) => ({ lat, lng })))
  assert.equal(context.routeKind, 'recorded')
})

test('深夜の訪問では日付をまたぐ前後の実経路を拾う', () => {
  const target = { key: 'target', name: null, lat: 35, lng: 139, count: 1, rank: 1 }
  const path = [
    { time: at(12, 22), lat: 35.003, lng: 139 },
    { time: at(12, 23, 30), lat: 35.002, lng: 139 },
    { time: at(13, 0, 15), lat: 35.001, lng: 139 },
    { time: at(13, 0, 45), lat: 35, lng: 139 },
  ]

  const context = buildPlaceContext({
    visits: [visit('target', at(13, 0, 30), target.lat, target.lng)],
    paths: [path],
  }, target, [target])

  assert.equal(context.routeSegments.length, 2)
  assert.deepEqual(context.routeSegments[0], path.slice(0, 2).map(({ lat, lng }) => ({ lat, lng })))
  assert.deepEqual(context.routeSegments[1], path.slice(2).map(({ lat, lng }) => ({ lat, lng })))
  assert.equal(context.routeKind, 'recorded')
})

test('経路点がなければ近接した当日の訪問順を推定線として返す', () => {
  const home = { key: 'home', name: '自宅', lat: 35, lng: 139, count: 1, rank: 1 }
  const target = { key: 'target', name: null, lat: 35.001, lng: 139, count: 1, rank: 2 }
  const cafe = { key: 'cafe', name: 'カフェ', lat: 35.002, lng: 139, count: 1, rank: 3 }

  const context = buildPlaceContext(createPlaceContextIndex({
    visits: [
      visit('home', at(12, 17), home.lat, home.lng),
      visit('target', at(12, 18), target.lat, target.lng),
      visit('cafe', at(12, 19), cafe.lat, cafe.lng),
    ],
    paths: [],
  }), target, [home, target, cafe])

  assert.equal(context.routeSegments.length, 1)
  assert.equal(context.routeSegments[0].length, 3)
  assert.equal(context.routeKind, 'estimated')
})

test('時間帯ラベルの境界が意図どおりになる', () => {
  assert.equal(timeBandLabel(4), '深夜')
  assert.equal(timeBandLabel(5), '朝')
  assert.equal(timeBandLabel(11), '昼')
  assert.equal(timeBandLabel(16), '夕方')
  assert.equal(timeBandLabel(19), '夜')
})
