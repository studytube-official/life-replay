// 場所カテゴリ定義と推定
// 現行エクスポートには場所名が含まれないため、
//  1) semanticType (HOME/WORK)
//  2) 場所名のキーワードマッチ(旧Takeout・デモデータ・端末内の手動ラベル)
// で判定する。

export const CATEGORIES = {
  home:        { label: '自宅',       icon: '🏠', color: '#7dd3fc' },
  work:        { label: '職場・学校', icon: '💼', color: '#a5b4fc' },
  convenience: { label: 'コンビニ',   icon: '🏪', color: '#86efac' },
  cafe:        { label: 'カフェ',     icon: '☕', color: '#fcd34d' },
  restaurant:  { label: '飲食店',     icon: '🍜', color: '#fca5a5' },
  station:     { label: '駅・交通',   icon: '🚉', color: '#93c5fd' },
  supermarket: { label: 'スーパー',   icon: '🛒', color: '#6ee7b7' },
  shopping:    { label: '買い物',     icon: '🛍️', color: '#f9a8d4' },
  gym:         { label: 'ジム・運動', icon: '💪', color: '#fdba74' },
  park:        { label: '公園・自然', icon: '🌳', color: '#a3e635' },
  entertainment:{ label: '娯楽',      icon: '🎮', color: '#c4b5fd' },
  hospital:    { label: '病院・薬局', icon: '🏥', color: '#f87171' },
  hotel:       { label: 'ホテル',     icon: '🛏️', color: '#e9d5ff' },
  airport:     { label: '空港',       icon: '✈️', color: '#67e8f9' },
  shrine:      { label: '神社・寺',   icon: '⛩️', color: '#fda4af' },
  school:      { label: '学校・図書館', icon: '📚', color: '#fde68a' },
  other:       { label: 'その他',     icon: '📍', color: '#9ca3af' },
}

const KEYWORDS = [
  ['convenience', [/7[\s-]?eleven/i, /セブン/, /ファミリーマート|ファミマ|familymart/i, /ローソン|lawson/i, /ミニストップ|ministop/i, /デイリーヤマザキ/, /セイコーマート/, /convenience/i, /コンビニ/]],
  ['cafe', [/カフェ|cafe|coffee|珈琲|コーヒー/i, /スターバックス|starbucks|スタバ/i, /ドトール|doutor/i, /タリーズ|tully/i, /コメダ/, /エクセルシオール/, /gloria jean/i, /プロント/]],
  ['station', [/駅$|station/i, /bus stop|バス停/i, /terminal/i, /wharf/i, /地下鉄|metro|subway/i]],
  ['supermarket', [/スーパー|supermarket/i, /イオン|aeon/i, /西友|seiyu/i, /イトーヨーカドー/, /ライフ/, /マルエツ/, /woolworths/i, /coles/i, /aldi/i, /iga/i, /grocer/i, /業務スーパー/, /オーケー|ok\s?store/i]],
  ['restaurant', [/レストラン|restaurant/i, /食堂|ramen|ラーメン|らーめん/i, /寿司|sushi/i, /焼肉|yakiniku|bbq/i, /居酒屋|izakaya/i, /マクドナルド|mcdonald/i, /バーガー|burger/i, /丼|うどん|そば|蕎麦/, /kitchen|diner|grill|bistro|thai|curry|カレー/i, /ピザ|pizza/i, /ケンタッキー|kfc/i, /すき家|吉野家|松屋/, /サイゼリヤ|ガスト|デニーズ/, /bar$|バー/i]],
  ['gym', [/ジム|gym|fitness|フィットネス/i, /エニタイム|anytime/i, /ゴールドジム/, /プール|pool/i, /道場|dojo/i, /ヨガ|yoga/i]],
  ['park', [/公園|park$/i, /garden|庭園/i, /ビーチ|beach/i, /山$|岳$|mount|mt\./i, /湖|lake/i, /川原|riverside/i]],
  ['entertainment', [/映画|cinema|theater|theatre/i, /カラオケ|karaoke/i, /ゲームセンター|game|arcade/i, /ボウリング|bowling/i, /水族館|aquarium/i, /動物園|zoo/i, /美術館|博物館|museum/i, /遊園地|テーマパーク/i, /casino/i, /ライブ|live house/i]],
  ['hospital', [/病院|hospital|クリニック|clinic/i, /歯科|dental/i, /薬局|pharmacy|ドラッグ|drug/i, /医院/]],
  ['hotel', [/ホテル|hotel|hostel|旅館|inn$/i, /backpackers/i, /airbnb/i]],
  ['airport', [/空港|airport/i]],
  ['shrine', [/神社|shrine/i, /寺$|寺院|temple/i, /教会|church|cathedral/i]],
  ['school', [/大学|university|college/i, /学校|school/i, /図書館|library/i, /語学|language/i, /塾|academy/i]],
  ['shopping', [/モール|mall/i, /百貨店|デパート|department/i, /ユニクロ|uniqlo/i, /無印|muji/i, /ドンキ|don quijote/i, /家電|electronics|ヨドバシ|ビックカメラ|yamada/i, /書店|bookstore|本屋/i, /shop$|store$|ストア/i, /westfield/i, /100均|ダイソー|セリア|daiso/i]],
]

export function inferCategory(visit, labels = {}) {
  // 端末内の手動ラベル優先 (placeId or 座標キー)
  const key = visit.placeId || coordKey(visit.lat, visit.lng)
  if (labels[key]?.category) return labels[key].category
  if (visit.semanticType === 'HOME') return 'home'
  if (visit.semanticType === 'WORK') return 'work'
  const name = labels[key]?.name || visit.name
  if (name) {
    for (const [cat, regs] of KEYWORDS) {
      if (regs.some((r) => r.test(name))) return cat
    }
    return 'other'
  }
  return 'other'
}

export function coordKey(lat, lng) {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`
}

export function placeKeyOf(visit) {
  return visit.placeId || coordKey(visit.lat, visit.lng)
}
