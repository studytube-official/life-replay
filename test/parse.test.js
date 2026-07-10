import test from 'node:test'
import assert from 'node:assert/strict'

import { mergeParsedData } from '../src/parse.js'

const visit = (start, lat, lng, extra = {}) => ({
  start,
  end: start + 60_000,
  lat,
  lng,
  placeId: null,
  name: null,
  address: null,
  semanticType: null,
  ...extra,
})

const activity = (start, from, to) => ({
  start,
  end: start + 30_000,
  type: 'WALKING',
  distanceMeters: 120,
  from,
  to,
})

test('最新エクスポートを追加しても全データ型を二重計上しない', () => {
  const basePath = [
    { time: 1_000, lat: 35, lng: 139 },
    { time: 2_000, lat: 35.01, lng: 139.01 },
  ]
  const richerSamePath = [
    { time: 1_000, lat: 35, lng: 139 },
    { time: 1_500, lat: 35.005, lng: 139.005 },
    { time: 2_000, lat: 35.01, lng: 139.01 },
  ]
  const base = {
    visits: [visit(1_000, 35, 139, { name: '保存済みの場所名' })],
    activities: [activity(1_000, { lat: 35, lng: 139 }, { lat: 35.01, lng: 139.01 })],
    paths: [basePath],
    sourceFormats: ['ios-device'],
    errors: [],
  }
  const incoming = {
    visits: [
      visit(1_000, 35, 139),
      visit(3_000, 35.02, 139.02),
    ],
    activities: [
      { ...activity(1_000, { lat: 35, lng: 139 }, { lat: 35.01, lng: 139.01 }), distanceMeters: 0 },
      activity(3_000, { lat: 35.02, lng: 139.02 }, { lat: 35.03, lng: 139.03 }),
    ],
    paths: [
      richerSamePath,
      [{ time: 3_000, lat: 35.02, lng: 139.02 }, { time: 4_000, lat: 35.03, lng: 139.03 }],
    ],
    sourceFormats: ['android-device'],
    errors: [],
  }

  const { data, report } = mergeParsedData(base, incoming)

  assert.equal(data.visits.length, 2)
  assert.equal(data.activities.length, 2)
  assert.equal(data.paths.length, 2)
  assert.equal(data.visits[0].name, '保存済みの場所名')
  assert.equal(data.activities[0].distanceMeters, 120)
  assert.equal(data.paths[0].length, 3)
  assert.deepEqual(data.sourceFormats.sort(), ['android-device', 'ios-device'])
  assert.deepEqual(report, {
    visitsAdded: 1,
    activitiesAdded: 1,
    pathsAdded: 1,
    duplicatesSkipped: 3,
  })
})

test('同じエクスポートを再追加すると新規件数は0になる', () => {
  const data = {
    visits: [visit(1_000, 35, 139)],
    activities: [activity(1_000, { lat: 35, lng: 139 }, { lat: 35.01, lng: 139.01 })],
    paths: [[{ time: 1_000, lat: 35, lng: 139 }, { time: 2_000, lat: 35.01, lng: 139.01 }]],
    sourceFormats: ['ios-device'],
    errors: [],
  }

  const result = mergeParsedData(data, data)

  assert.deepEqual(result.report, {
    visitsAdded: 0,
    activitiesAdded: 0,
    pathsAdded: 0,
    duplicatesSkipped: 3,
  })
})
