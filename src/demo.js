// デモデータ生成器
// 旧Takeout形式(場所名あり)で約2年半の東京生活を合成する。
// シード付き乱数で毎回同じ結果 → デモの再現性を確保。

function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PLACES = {
  home:    { name: '自宅', lat: 35.7052, lng: 139.6494, semanticType: 'TYPE_HOME' },
  work:    { name: '株式会社ライフリプレイ', lat: 35.6595, lng: 139.7005, semanticType: 'TYPE_WORK' },
  konbini1:{ name: 'セブン-イレブン 高円寺駅前店', lat: 35.7056, lng: 139.6500 },
  konbini2:{ name: 'ファミリーマート 渋谷宇田川町店', lat: 35.6608, lng: 139.6983 },
  konbini3:{ name: 'ローソン 高円寺南店', lat: 35.7031, lng: 139.6521 },
  stationA:{ name: '高円寺駅', lat: 35.7053, lng: 139.6498 },
  stationB:{ name: '渋谷駅', lat: 35.6580, lng: 139.7016 },
  stationC:{ name: '新宿駅', lat: 35.6896, lng: 139.7006 },
  cafe1:   { name: 'スターバックス 渋谷スクランブルスクエア店', lat: 35.6585, lng: 139.7024 },
  cafe2:   { name: '名曲喫茶ネルケン', lat: 35.7044, lng: 139.6480 },
  gym:     { name: 'エニタイムフィットネス 高円寺店', lat: 35.7020, lng: 139.6510 },
  super:   { name: '西友 高円寺店', lat: 35.7048, lng: 139.6470 },
  ramen:   { name: 'ラーメン健太 高円寺本店', lat: 35.7040, lng: 139.6505 },
  izakaya: { name: '居酒屋 とりみち', lat: 35.7035, lng: 139.6515 },
  sushi:   { name: '寿司処 まさ田', lat: 35.6600, lng: 139.6990 },
  book:    { name: '蔦屋書店 代官山', lat: 35.6494, lng: 139.6997 },
  park:    { name: '井の頭恩賜公園', lat: 35.7002, lng: 139.5731 },
  museum:  { name: '国立新美術館', lat: 35.6653, lng: 139.7266 },
  cinema:  { name: 'TOHOシネマズ 新宿', lat: 35.6949, lng: 139.7020 },
  karaoke: { name: 'カラオケ館 渋谷本店', lat: 35.6612, lng: 139.6975 },
  shrine:  { name: '明治神宮', lat: 35.6764, lng: 139.6993 },
  hosp:    { name: '高円寺クリニック', lat: 35.7025, lng: 139.6490 },
  drug:    { name: 'マツモトキヨシ 高円寺店', lat: 35.7050, lng: 139.6485 },
  mall:    { name: 'ルミネ新宿', lat: 35.6890, lng: 139.6995 },
  kyotoSta:{ name: '京都駅', lat: 34.9858, lng: 135.7588 },
  kyotoTemple: { name: '清水寺', lat: 34.9949, lng: 135.7850 },
  kyotoHotel:  { name: 'ホテルグランヴィア京都', lat: 34.9857, lng: 135.7590 },
  hnd:     { name: '羽田空港 第2ターミナル', lat: 35.5533, lng: 139.7811 },
  cts:     { name: '新千歳空港', lat: 42.7752, lng: 141.6923 },
  sapporoHotel: { name: '札幌グランドホテル', lat: 43.0621, lng: 141.3544 },
  sapporoRamen: { name: 'ラーメン横丁 味の一番', lat: 43.0546, lng: 141.3565 },
}

const E7 = (x) => Math.round(x * 1e7)

function pv(place, startMs, endMs, key) {
  return {
    placeVisit: {
      location: {
        latitudeE7: E7(place.lat), longitudeE7: E7(place.lng),
        placeId: `demo_${key}`, name: place.name,
        semanticType: place.semanticType || 'TYPE_SEARCHED_ADDRESS',
      },
      duration: { startTimestamp: new Date(startMs).toISOString(), endTimestamp: new Date(endMs).toISOString() },
    },
  }
}

function act(from, to, startMs, endMs, type) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(to.lat - from.lat), dLng = toRad(to.lng - from.lng)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2
  const distKm = 2 * R * Math.asin(Math.sqrt(a)) * 1.25
  return {
    activitySegment: {
      startLocation: { latitudeE7: E7(from.lat), longitudeE7: E7(from.lng) },
      endLocation: { latitudeE7: E7(to.lat), longitudeE7: E7(to.lng) },
      duration: { startTimestamp: new Date(startMs).toISOString(), endTimestamp: new Date(endMs).toISOString() },
      distance: Math.round(distKm * 1000),
      activityType: type,
    },
  }
}

export function generateDemoData() {
  const rnd = mulberry32(20260706)
  const objs = []
  const start = new Date('2024-01-08T00:00:00+09:00').getTime()
  const DAY = 86400000
  const days = 910 // 約2.5年

  // 訪問チェーン(前の場所から移動→滞在)を1日分積む
  let addDay = (dayStart, plan) => {
    let prev = PLACES.home
    let t = dayStart
    for (const [key, arriveH, stayMin, moveType] of plan) {
      const place = PLACES[key]
      const arrive = dayStart + arriveH * 3600000 + Math.floor(rnd() * 20 - 10) * 60000
      if (arrive > t && place !== prev) {
        const moveStart = Math.max(t, arrive - 25 * 60000)
        objs.push(act(prev, place, moveStart, arrive, moveType || 'WALKING'))
      }
      const leave = arrive + (stayMin + Math.floor(rnd() * stayMin * 0.3)) * 60000
      objs.push(pv(place, arrive, leave, key))
      prev = place
      t = leave
    }
  }

  for (let i = 0; i < days; i++) {
    const dayStart = start + i * DAY
    const dow = new Date(dayStart).getDay()
    const r = rnd()

    // 年1回の京都旅行 / 札幌フライト旅行
    const dayOfYear = i % 365
    if (dayOfYear === 120) { // 京都1日目
      addDay(dayStart, [['stationC', 8, 20, 'WALKING'], ['kyotoSta', 11, 30, 'IN_TRAIN'], ['kyotoTemple', 13, 120, 'IN_BUS'], ['kyotoHotel', 18, 720, 'IN_BUS']])
      continue
    }
    if (dayOfYear === 121) { // 京都2日目
      addDay(dayStart, [['kyotoSta', 10, 40, 'WALKING'], ['stationC', 14, 20, 'IN_TRAIN'], ['home', 15.5, 480, 'IN_TRAIN']])
      continue
    }
    if (dayOfYear === 250) { // 札幌1日目(飛行機)
      addDay(dayStart, [['hnd', 8, 90, 'IN_TRAIN'], ['cts', 11.5, 40, 'FLYING'], ['sapporoRamen', 13.5, 60, 'IN_TRAIN'], ['sapporoHotel', 16, 900, 'WALKING']])
      continue
    }
    if (dayOfYear === 251) {
      addDay(dayStart, [['cts', 11, 80, 'IN_TRAIN'], ['hnd', 14.5, 30, 'FLYING'], ['home', 16.5, 420, 'IN_TRAIN']])
      continue
    }

    if (dow >= 1 && dow <= 5) {
      // 平日: 通勤ルーティン
      const plan = [['stationA', 8.2, 5, 'WALKING'], ['stationB', 8.9, 5, 'IN_TRAIN'], ['work', 9.2, 470, 'WALKING']]
      if (r < 0.75) plan.splice(0, 0, ['konbini1', 7.9, 6, 'WALKING']) // 朝コンビニ
      if (rnd() < 0.45) plan.push(['konbini2', 12.2, 8, 'WALKING'])   // 昼コンビニ
      if (rnd() < 0.3) plan.push(['cafe1', 17.6, 45, 'WALKING'])
      if (rnd() < 0.18) plan.push(['sushi', 19, 80, 'WALKING'])
      plan.push(['stationB', 19.8, 5, 'WALKING'], ['stationA', 20.4, 5, 'IN_TRAIN'])
      if (rnd() < 0.35) plan.push(['gym', 20.7, 70, 'WALKING'])
      if (rnd() < 0.4) plan.push(['super', 21.3, 25, 'WALKING'])
      if (rnd() < 0.22) plan.push(['ramen', 21.8, 40, 'WALKING'])
      if (rnd() < 0.12) plan.push(['konbini3', 23.6, 5, 'WALKING']) // 深夜コンビニ
      plan.push(['home', 22.5, 540, 'WALKING'])
      addDay(dayStart, plan)
    } else {
      // 週末
      const plan = []
      if (r < 0.25) {
        plan.push(['cafe2', 10.5, 90, 'WALKING'], ['park', 13, 150, 'IN_TRAIN'], ['izakaya', 19, 120, 'IN_TRAIN'])
      } else if (r < 0.45) {
        plan.push(['stationA', 11, 5, 'WALKING'], ['stationC', 11.4, 10, 'IN_TRAIN'], ['mall', 12, 120, 'WALKING'], ['cinema', 15, 150, 'WALKING'], ['stationA', 19, 5, 'IN_TRAIN'])
      } else if (r < 0.6) {
        plan.push(['stationA', 12, 5, 'WALKING'], ['stationB', 12.5, 5, 'IN_TRAIN'], ['karaoke', 13, 150, 'WALKING'], ['konbini2', 16, 8, 'WALKING'], ['stationA', 17.5, 5, 'IN_TRAIN'])
      } else if (r < 0.72) {
        plan.push(['shrine', 11, 90, 'IN_TRAIN'], ['book', 14, 80, 'IN_TRAIN'], ['sushi', 18.5, 90, 'WALKING'], ['stationA', 20.5, 5, 'IN_TRAIN'])
      } else if (r < 0.8) {
        plan.push(['museum', 11.5, 150, 'IN_TRAIN'], ['cafe1', 15, 60, 'IN_TRAIN'], ['stationA', 17, 5, 'IN_TRAIN'])
      } else {
        // 引きこもり気味の日
        if (rnd() < 0.7) plan.push(['konbini1', 13, 8, 'WALKING'])
        if (rnd() < 0.5) plan.push(['super', 16, 30, 'WALKING'])
      }
      if (rnd() < 0.25) plan.push(['gym', 10, 80, 'WALKING'])
      if (rnd() < 0.15) plan.push(['drug', 15, 15, 'WALKING'])
      if (rnd() < 0.08) plan.push(['hosp', 10, 45, 'WALKING'])
      plan.sort((a, b) => a[1] - b[1])
      plan.push(['home', 21.5, 600, 'WALKING'])
      addDay(dayStart, plan)
    }
  }

  return { timelineObjects: objs }
}
