import { categoryVisits } from './stats.js'

// tier: bronze / silver / gold / legend (見た目の枠色)
export const ACHIEVEMENTS = [
  // --- 冒険のはじまり ---
  { id: 'first-step', icon: '👣', tier: 'bronze', name: 'はじまりの一歩',
    desc: '最初の記録を読み込んだ', xp: 100,
    progress: (s) => [Math.min(1, s.totalVisits), 1] },
  { id: 'traveler-1', icon: '🥾', tier: 'bronze', name: '駆け出しの旅人',
    desc: '累計100回の訪問', xp: 200,
    progress: (s) => [s.totalVisits, 100] },
  { id: 'traveler-2', icon: '🧭', tier: 'silver', name: '熟練の旅人',
    desc: '累計1,000回の訪問', xp: 500,
    progress: (s) => [s.totalVisits, 1000] },
  { id: 'traveler-3', icon: '🗺️', tier: 'gold', name: '伝説の旅人',
    desc: '累計5,000回の訪問', xp: 1500,
    progress: (s) => [s.totalVisits, 5000] },
  // --- 探索 ---
  { id: 'explorer-1', icon: '🔍', tier: 'bronze', name: '街の探検家',
    desc: '50ヶ所のユニークな場所を訪問', xp: 200,
    progress: (s) => [s.uniquePlaces, 50] },
  { id: 'explorer-2', icon: '🏕️', tier: 'silver', name: '未知への挑戦者',
    desc: '200ヶ所のユニークな場所を訪問', xp: 500,
    progress: (s) => [s.uniquePlaces, 200] },
  { id: 'explorer-3', icon: '🌏', tier: 'gold', name: '世界の開拓者',
    desc: '500ヶ所のユニークな場所を訪問', xp: 1500,
    progress: (s) => [s.uniquePlaces, 500] },
  // --- 距離 ---
  { id: 'dist-1', icon: '🚶', tier: 'bronze', name: '千里の道も一歩から',
    desc: '総移動距離 1,000km', xp: 300,
    progress: (s) => [Math.round(s.totalDistanceKm), 1000] },
  { id: 'dist-2', icon: '🚄', tier: 'silver', name: '風のように',
    desc: '総移動距離 10,000km', xp: 800,
    progress: (s) => [Math.round(s.totalDistanceKm), 10000] },
  { id: 'dist-3', icon: '🌍', tier: 'legend', name: '地球一周',
    desc: '総移動距離 40,000km(地球一周分)', xp: 3000,
    progress: (s) => [Math.round(s.totalDistanceKm), 40000] },
  { id: 'big-day', icon: '💨', tier: 'silver', name: '大移動の日',
    desc: '1日で300km以上移動', xp: 400,
    progress: (s) => [Math.round(s.maxDayDistanceKm), 300] },
  { id: 'flight', icon: '✈️', tier: 'gold', name: '空の旅人',
    desc: '飛行機での移動を検知', xp: 600,
    progress: (s) => [s.flightDetected ? 1 : 0, 1] },
  // --- カテゴリ ---
  { id: 'konbini-1', icon: '🏪', tier: 'bronze', name: 'コンビニの常連',
    desc: 'コンビニに100回', xp: 300,
    progress: (s) => [categoryVisits(s, 'convenience'), 100] },
  { id: 'konbini-2', icon: '🍙', tier: 'gold', name: 'コンビニマスター',
    desc: 'コンビニに400回', xp: 1000,
    progress: (s) => [categoryVisits(s, 'convenience'), 400] },
  { id: 'cafe-1', icon: '☕', tier: 'bronze', name: 'カフェ巡り',
    desc: 'カフェに50回', xp: 300,
    progress: (s) => [categoryVisits(s, 'cafe'), 50] },
  { id: 'cafe-2', icon: '🫘', tier: 'gold', name: 'カフェイン中毒',
    desc: 'カフェに200回', xp: 1000,
    progress: (s) => [categoryVisits(s, 'cafe'), 200] },
  { id: 'gourmet', icon: '🍜', tier: 'silver', name: '食べ歩きの達人',
    desc: '飲食店に100回', xp: 500,
    progress: (s) => [categoryVisits(s, 'restaurant'), 100] },
  { id: 'stations', icon: '🚉', tier: 'silver', name: '乗り換えの達人',
    desc: '駅・交通機関に300回', xp: 500,
    progress: (s) => [categoryVisits(s, 'station'), 300] },
  { id: 'muscle', icon: '💪', tier: 'silver', name: '鋼の肉体',
    desc: 'ジム・運動施設に100回', xp: 500,
    progress: (s) => [categoryVisits(s, 'gym'), 100] },
  // --- 生活リズム ---
  { id: 'night-owl', icon: '🦉', tier: 'silver', name: '夜行性',
    desc: '深夜0〜4時の訪問が50回', xp: 400,
    progress: (s) => [s.nightVisits, 50] },
  { id: 'early-bird', icon: '🐓', tier: 'silver', name: '早起きは三文の徳',
    desc: '早朝4〜7時の訪問が50回', xp: 400,
    progress: (s) => [s.earlyVisits, 50] },
  { id: 'weekend', icon: '🎉', tier: 'bronze', name: '週末戦士',
    desc: '週末の訪問が200回', xp: 300,
    progress: (s) => [s.weekendVisits, 200] },
  { id: 'regular', icon: '🪑', tier: 'silver', name: 'いつもの場所',
    desc: '同じ場所に100回訪問', xp: 500,
    progress: (s) => [s.maxVisitsOnePlace, 100] },
  { id: 'regular-2', icon: '👑', tier: 'gold', name: '主(ぬし)',
    desc: '同じ場所に500回訪問', xp: 1200,
    progress: (s) => [s.maxVisitsOnePlace, 500] },
  { id: 'streak-1', icon: '🔥', tier: 'bronze', name: '記録の炎',
    desc: '30日連続で記録', xp: 300,
    progress: (s) => [s.longestStreak, 30] },
  { id: 'streak-2', icon: '⚡', tier: 'gold', name: '不屈の記録者',
    desc: '365日連続で記録', xp: 1500,
    progress: (s) => [s.longestStreak, 365] },
  { id: 'timespan', icon: '⏳', tier: 'gold', name: '時空の旅人',
    desc: '3年以上のデータを読み込む', xp: 800,
    progress: (s) => [Math.floor(s.spanDays / 365), 3] },
  { id: 'marathon-stay', icon: '🛌', tier: 'bronze', name: '長期滞在',
    desc: '1ヶ所に12時間以上滞在', xp: 200,
    progress: (s) => [Math.floor(s.longestStayHours), 12] },
]

export function evaluateAchievements(stats) {
  return ACHIEVEMENTS.map((a) => {
    const [cur, goal] = a.progress(stats)
    return { ...a, current: Math.min(cur, goal), goal, unlocked: cur >= goal }
  })
}

// XP・レベル計算 (RPG風の逓増カーブ)
export function computeXp(stats, achievements) {
  const badgeXp = achievements.filter((a) => a.unlocked).reduce((s, a) => s + a.xp, 0)
  const xp = Math.round(
    stats.totalVisits * 2 +
    stats.uniquePlaces * 10 +
    stats.totalDistanceKm * 0.5 +
    stats.activeDays * 5 +
    badgeXp
  )
  // level n に必要な累計xp = 100 * n^2
  const level = Math.max(1, Math.floor(Math.sqrt(xp / 100)))
  const curBase = 100 * level * level
  const nextBase = 100 * (level + 1) * (level + 1)
  const progress = Math.min(1, Math.max(0, (xp - curBase) / (nextBase - curBase)))
  return { xp, level, progress, nextXp: nextBase }
}

export const TITLES = [
  [1, '見習い冒険者'], [3, '駆け出しの旅人'], [5, '街歩きの達人'],
  [8, '熟練の探索者'], [12, '大陸の放浪者'], [16, '伝説の旅人'],
  [20, '時空の覇者'], [25, '世界の記録者'],
]
export function titleForLevel(level) {
  let t = TITLES[0][1]
  for (const [lv, name] of TITLES) if (level >= lv) t = name
  return t
}
