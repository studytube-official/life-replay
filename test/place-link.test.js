import test from 'node:test'
import assert from 'node:assert/strict'

import { computeStats } from '../src/stats.js'

test('名前なしでも確認済みカテゴリをAI向け集計に反映する', () => {
  const start = new Date(2026, 6, 19, 18).getTime()
  const visits = [0, 1].map((index) => ({
    placeId: 'local-spot',
    lat: 35,
    lng: 139,
    start: start + index * 86_400_000,
    end: start + index * 86_400_000 + 45 * 60_000,
    name: null,
    semanticType: null,
  }))

  const stats = computeStats({
    visits,
    activities: [],
    paths: [],
  }, {
    'local-spot': {
      googlePlaceId: 'places/gym',
      category: 'gym',
    },
  })

  assert.equal(stats.places[0].key, 'local-spot')
  assert.equal(stats.places[0].name, null)
  assert.equal(stats.places[0].category, 'gym')
  assert.equal(stats.categoryCounts.gym, 2)
})
