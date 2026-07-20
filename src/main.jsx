import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '@fontsource/dotgothic16/japanese-400.css'
import '@fontsource/zen-kaku-gothic-new/japanese-400.css'
import '@fontsource/zen-kaku-gothic-new/japanese-500.css'
import '@fontsource/zen-kaku-gothic-new/japanese-700.css'
import '@fontsource/cinzel/latin-500.css'
import '@fontsource/cinzel/latin-700.css'
import './style.css'
import { mergeParsedData, parseFiles, parseObjects } from './parse.js'
import { computeStats, formatKm } from './stats.js'
import { CATEGORIES, placeKeyOf } from './categories.js'
import { evaluateAchievements, computeXp, titleForLevel, ACHIEVEMENTS } from './achievements.js'
import { generateDemoData } from './demo.js'
import { saveData, loadData, clearData } from './store.js'
import { recordVisit, fetchSiteStats } from './beacon.js'
import { buildPlaceContext, createPlaceContextIndex } from './place-context.js'
import { buildConfirmedPlaceLink, requestPlaceSuggestions } from './place-suggestions.js'

const APP_VERSION = 'v0.7'

const LS_UNLOCKED = 'lr_unlocked'
const LS_LABELS = 'lr_labels'

const loadJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const saveJson = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v))
    return true
  } catch {
    return false
  }
}

const detectPlatform = () => {
  const ua = navigator.userAgent || ''
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  return 'pc'
}

// 通信を一切行わないLeaflet背景。地理的な位置関係・軌跡・ズームは保ち、
// 道路地図タイルの代わりにRPG風の星図を端末内Canvasで生成する。
const OfflineGridLayer = L.GridLayer.extend({
  createTile(coords) {
    const tile = L.DomUtil.create('canvas', 'offline-map-tile')
    const size = this.getTileSize()
    tile.width = size.x
    tile.height = size.y
    const ctx = tile.getContext('2d')
    ctx.fillStyle = '#080c1f'
    ctx.fillRect(0, 0, size.x, size.y)

    const glow = ctx.createRadialGradient(size.x * 0.5, size.y * 0.35, 0, size.x * 0.5, size.y * 0.35, size.x * 0.8)
    glow.addColorStop(0, 'rgba(72, 91, 170, 0.16)')
    glow.addColorStop(1, 'rgba(8, 12, 31, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, size.x, size.y)

    ctx.strokeStyle = 'rgba(124, 155, 255, 0.10)'
    ctx.lineWidth = 1
    for (let n = 0; n <= size.x; n += 64) {
      ctx.beginPath(); ctx.moveTo(n, 0); ctx.lineTo(n, size.y); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(0, n); ctx.lineTo(size.x, n); ctx.stroke()
    }

    let seed = (Math.imul(coords.x, 73856093) ^ Math.imul(coords.y, 19349663) ^ Math.imul(coords.z, 83492791)) >>> 0
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    for (let i = 0; i < 24; i++) {
      const radius = random() > 0.88 ? 1.4 : 0.7
      ctx.beginPath()
      ctx.fillStyle = `rgba(232, 234, 246, ${0.2 + random() * 0.6})`
      ctx.arc(random() * size.x, random() * size.y, radius, 0, Math.PI * 2)
      ctx.fill()
    }
    return tile
  },
})

// ------------------------------------------------------------------
// タイトル画面
// ------------------------------------------------------------------
function TitleScreen({ onData, busy, error, savedAt, onContinue, onClearSaved }) {
  const fileRef = useRef(null)
  const updateRef = useRef(null)
  const dirRef = useRef(null)
  const [drag, setDrag] = useState(false)
  const [platform, setPlatform] = useState(detectPlatform)

  const handleFiles = (list, mode = 'replace') => {
    const files = [...list].filter((f) => /\.(json|zip)$/i.test(f.name))
    if (files.length) onData(files, mode)
  }

  const officialUrl = platform === 'android'
    ? 'https://support.google.com/maps/answer/6258979?co=GENIE.Platform%3DAndroid&hl=ja'
    : 'https://support.google.com/maps/answer/6258979?co=GENIE.Platform%3DiOS&hl=ja'

  return (
    <div
      className={`title-screen ${drag ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files, savedAt ? 'merge' : 'replace') }}
    >
      <Starfield />
      <div className="title-inner">
        <div className="title-crest">🗺️</div>
        <h1 className="game-title">ジブンクエスト</h1>
        <div className="game-subtitle">— JIBUN QUEST —</div>
        <p className="title-tagline">きみの毎日が、冒険の記録になる。</p>

        {busy ? (
          <div className="loading-box"><span className="loading-orb" />解析中…</div>
        ) : (
          <div className="title-menu">
            {savedAt && (
              <div className="saved-actions">
                <button className="menu-btn primary" onClick={onContinue}>
                  ▶ 続きから再開 <small className="saved-at">({new Date(savedAt).toLocaleDateString('ja-JP')}更新)</small>
                </button>
                <button className="menu-btn update" onClick={() => updateRef.current?.click()}>
                  ⟳ 最新データを追加
                </button>
              </div>
            )}

            <div className="onboard-card import-card">
              <div className="onboard-head">📱 Googleタイムラインを<b>このスマホから直接</b></div>
              <p className="onboard-lead">PCへ送る必要はありません。書き出したJSONを同じ端末で選べば完了です。</p>
              <div className="platform-tabs" role="tablist" aria-label="端末を選択">
                <button className={platform === 'ios' ? 'active' : ''} onClick={() => setPlatform('ios')}>iPhone</button>
                <button className={platform === 'android' ? 'active' : ''} onClick={() => setPlatform('android')}>Android</button>
                <button className={platform === 'pc' ? 'active' : ''} onClick={() => setPlatform('pc')}>PC・旧データ</button>
              </div>
              {platform === 'ios' && (
                <ol className="onboard-steps">
                  <li>Googleマップ → プロフィール → <b>設定</b></li>
                  <li><b>個人的なコンテンツ</b>（または「位置情報とプライバシー」）→ エクスポート</li>
                  <li>「<b>ファイルに保存</b>」後、この画面で <code>location-history.json</code> を選ぶ</li>
                </ol>
              )}
              {platform === 'android' && (
                <ol className="onboard-steps">
                  <li>Googleマップではなく、端末の<b>設定</b>を開く</li>
                  <li><b>位置情報</b> → 位置情報サービス → タイムライン</li>
                  <li>「<b>タイムライン データをエクスポート</b>」で保存後、この画面で選ぶ</li>
                </ol>
              )}
              {platform === 'pc' && (
                <ol className="onboard-steps">
                  <li>以前に保存したGoogle TakeoutのZIPまたはJSONに対応</li>
                  <li>ZIPは展開せず、そのまま選択できます</li>
                  <li>現在の端末版タイムラインはiPhone/Androidタブの手順を使ってください</li>
                </ol>
              )}
              <button className="menu-btn primary" onClick={() => fileRef.current?.click()}>
                ▶ {savedAt ? '最新データを追加する' : (platform === 'pc' ? 'ZIP・JSONを選ぶ' : '書き出したJSONを選ぶ')}
              </button>
              {platform === 'pc' ? (
                <button className="link-btn" onClick={() => dirRef.current?.click()}>展開済みフォルダを選ぶ</button>
              ) : (
                <a className="help-link" href={officialUrl} target="_blank" rel="noreferrer">Google公式の手順を確認 ↗</a>
              )}
            </div>

            <div className="onboard-card">
              <div className="onboard-head">🌱 タイムラインが<b>オフだった人</b>・わからない人</div>
              <ol className="onboard-steps">
                <li>Googleマップ → プロフィール →「タイムライン」を開いて<b>オン</b>にする</li>
                <li>あとは普通に過ごすだけで記録が貯まっていく</li>
                <li>今すぐLv.1から冒険開始! 貯まったら読み込んで一気にレベルアップ</li>
              </ol>
              <button className="menu-btn" onClick={() => onData('zero')}>
                ▶ ゼロから冒険を始める
              </button>
            </div>

            <button className="menu-btn demo" onClick={() => onData('demo')}>
              ▶ まずはデモデータで遊んでみる
            </button>
          </div>
        )}
        {error && <div className="title-error">{error}</div>}
        {savedAt && !busy && (
          <button className="clear-saved" onClick={onClearSaved}>保存データを消去</button>
        )}

        <p className="privacy-note title-privacy">
          🔒 読み込んだ位置データの解析・保存・地図表示は端末内だけ。
          場所タブで「候補を探す」を押した時だけ、選択地点1件の座標を施設検索に使用します。
          一度読み込めば次回から自動復元されます。
        </p>
        <div className="app-version">{APP_VERSION}</div>
      </div>
      <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" multiple hidden
        onChange={(e) => { handleFiles(e.target.files, savedAt ? 'merge' : 'replace'); e.target.value = '' }} />
      <input ref={updateRef} type="file" accept=".json,.zip,application/json,application/zip" multiple hidden
        onChange={(e) => { handleFiles(e.target.files, 'merge'); e.target.value = '' }} />
      <input ref={dirRef} type="file" webkitdirectory="" hidden
        onChange={(e) => { handleFiles(e.target.files, savedAt ? 'merge' : 'replace'); e.target.value = '' }} />
    </div>
  )
}

function Starfield() {
  // 星空: 固定シードで散らした星 + ゆっくり明滅
  const stars = useMemo(() => {
    const arr = []
    let seed = 42
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    for (let i = 0; i < 120; i++) {
      arr.push({ x: rnd() * 100, y: rnd() * 100, s: 1 + rnd() * 2, d: rnd() * 5 })
    }
    return arr
  }, [])
  return (
    <div className="starfield" aria-hidden>
      {stars.map((st, i) => (
        <span key={i} className="star" style={{
          left: `${st.x}%`, top: `${st.y}%`,
          width: st.s, height: st.s, animationDelay: `${st.d}s`,
        }} />
      ))}
      <div className="aurora" />
    </div>
  )
}

// ------------------------------------------------------------------
// 実績解除セレモニー
// ------------------------------------------------------------------
function UnlockCeremony({ queue, onDone }) {
  const [idx, setIdx] = useState(0)
  const a = queue[idx]
  useEffect(() => {
    if (!a) return
    const t = setTimeout(() => {
      if (idx + 1 < queue.length) setIdx(idx + 1)
      else onDone()
    }, 2400)
    return () => clearTimeout(t)
  }, [idx, a])
  if (!a) return null
  return (
    <div className="ceremony-overlay" onClick={() => (idx + 1 < queue.length ? setIdx(idx + 1) : onDone())}>
      <div className={`ceremony-card tier-${a.tier}`} key={a.id}>
        <div className="ceremony-rays" />
        <div className="ceremony-label">✦ 実績解除 ✦</div>
        <div className="ceremony-icon">{a.icon}</div>
        <div className="ceremony-name">{a.name}</div>
        <div className="ceremony-desc">{a.desc}</div>
        <div className="ceremony-xp">+{a.xp} XP</div>
        {queue.length > 1 && <div className="ceremony-count">{idx + 1} / {queue.length}</div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// スタッツタブ
// ------------------------------------------------------------------
function StatCard({ icon, label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function BarChart({ data, labels, color = 'var(--gold)' }) {
  const max = Math.max(...data, 1)
  return (
    <div className="bar-chart">
      {data.map((v, i) => (
        <div className="bar-col" key={i} title={`${labels[i]}: ${v}`}>
          <div className="bar" style={{ height: `${(v / max) * 100}%`, background: color }} />
          <div className="bar-label">{labels[i]}</div>
        </div>
      ))}
    </div>
  )
}

function StatsTab({ stats }) {
  const empty = stats.totalVisits === 0
  const fmtDate = (t) => new Date(t).toLocaleDateString('ja-JP')
  const years = (stats.spanDays / 365).toFixed(1)
  const cats = Object.entries(stats.categoryCounts)
    .filter(([c]) => c !== 'other')
    .sort((a, b) => b[1] - a[1])
  const monthlyLabels = stats.monthly.map((m, i) => (i % Math.ceil(stats.monthly.length / 12) === 0 ? m.ym.slice(2).replace('-', '/') : ''))
  return (
    <div className="tab-body">
      {empty && (
        <section className="panel zero-banner">
          <h3 className="panel-title">🌱 冒険はここから!</h3>
          <p className="panel-note">
            まだ記録は0。でも準備はできてる。<br />
            ① Googleマップのプロフィールから<b>タイムラインをオン</b>にしておく<br />
            ② いつも通り過ごすだけで、行った場所が自動で記録されていく<br />
            ③ 数日〜数週間たったら「<b>タイムライン データをエクスポート</b>」→ 右上の⟳から追加。スタッツと実績が一気に解放される!
          </p>
        </section>
      )}
      <div className="stat-grid">
        <StatCard icon="📍" label="総訪問回数" value={stats.totalVisits.toLocaleString()} />
        <StatCard icon="🗺️" label="訪れた場所" value={stats.uniquePlaces.toLocaleString()} sub="ヶ所" />
        <StatCard icon="🛤️" label="総移動距離" value={formatKm(stats.totalDistanceKm)} sub={`地球${(stats.totalDistanceKm / 40075).toFixed(2)}周分`} />
        <StatCard icon="⏳" label="記録期間" value={empty ? '0日' : `${years}年`} sub={empty ? 'これからスタート!' : `${fmtDate(stats.firstTime)} 〜 ${fmtDate(stats.lastTime)}`} />
        <StatCard icon="🔥" label="最長ストリーク" value={`${stats.longestStreak}日`} sub="連続記録" />
        <StatCard icon="💨" label="最長移動日" value={formatKm(stats.maxDayDistanceKm)} sub={stats.maxDayDistanceDate || ''} />
      </div>

      {cats.length > 0 && (
        <section className="panel">
          <h3 className="panel-title">⚔️ カテゴリ別討伐数</h3>
          <div className="cat-list">
            {cats.map(([c, n]) => {
              const def = CATEGORIES[c]
              const max = cats[0][1]
              return (
                <div className="cat-row" key={c}>
                  <span className="cat-icon">{def.icon}</span>
                  <span className="cat-name">{def.label}</span>
                  <div className="cat-bar-wrap">
                    <div className="cat-bar" style={{ width: `${(n / max) * 100}%`, background: def.color }} />
                  </div>
                  <span className="cat-count">{n.toLocaleString()}<small>回</small></span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <section className="panel">
        <h3 className="panel-title">🏆 よく行く場所 TOP10</h3>
        {empty && <p className="panel-note">まだ記録がないよ。最初の1ヶ所目はどこになるかな?</p>}
        <ol className="top-places">
          {stats.places.slice(0, 10).map((p, i) => (
            <li key={p.key}>
              <span className={`rank rank-${i + 1}`}>{i + 1}</span>
              <span className="place-icon">{CATEGORIES[p.category]?.icon || '📍'}</span>
              <span className="place-name">{p.name || `未命名スポット #${i + 1}`}</span>
              <span className="place-count">{p.count}回</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="panel-row">
        <section className="panel half">
          <h3 className="panel-title">🕐 時間帯ヒストグラム</h3>
          <BarChart data={stats.hourHist} labels={stats.hourHist.map((_, i) => (i % 6 === 0 ? `${i}時` : ''))} color="var(--accent)" />
        </section>
        <section className="panel half">
          <h3 className="panel-title">📅 曜日別</h3>
          <BarChart data={[...stats.weekdayHist.slice(1), stats.weekdayHist[0]]} labels={['月', '火', '水', '木', '金', '土', '日']} color="var(--gold)" />
        </section>
      </div>

      {stats.monthly.length > 1 && (
        <section className="panel">
          <h3 className="panel-title">📈 月別訪問数</h3>
          <BarChart data={stats.monthly.map((m) => m.visits)} labels={monthlyLabels} color="var(--green)" />
        </section>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// 実績タブ
// ------------------------------------------------------------------
function AchievementsTab({ achievements }) {
  const unlocked = achievements.filter((a) => a.unlocked).length
  return (
    <div className="tab-body">
      <div className="ach-summary">
        <span className="ach-summary-num">{unlocked} <small>/ {achievements.length}</small></span>
        <span>実績解除済み</span>
        <div className="ach-summary-bar"><div style={{ width: `${(unlocked / achievements.length) * 100}%` }} /></div>
      </div>
      <div className="ach-grid">
        {achievements.map((a) => (
          <div key={a.id} className={`ach-card tier-${a.tier} ${a.unlocked ? 'unlocked' : 'locked'}`}>
            <div className="ach-icon">{a.unlocked ? a.icon : '🔒'}</div>
            <div className="ach-name">{a.name}</div>
            <div className="ach-desc">{a.desc}</div>
            {!a.unlocked && (
              <div className="ach-progress">
                <div className="ach-progress-bar"><div style={{ width: `${(a.current / a.goal) * 100}%` }} /></div>
                <span>{a.current.toLocaleString()} / {a.goal.toLocaleString()}</span>
              </div>
            )}
            {a.unlocked && <div className="ach-xp">+{a.xp} XP</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// リプレイタブ (Leaflet)
// ------------------------------------------------------------------
const SPEEDS = [
  ['6時間/秒', 6 * 3600000],
  ['1日/秒', 86400000],
  ['3日/秒', 3 * 86400000],
  ['7日/秒', 7 * 86400000],
  ['30日/秒', 30 * 86400000],
]

function ReplayTab({ data, stats }) {
  if (!data.visits.length) {
    return (
      <div className="tab-body">
        <section className="panel">
          <h3 className="panel-title">🎬 リプレイ</h3>
          <p className="panel-note">まだ再生できる記録がありません。タイムラインの記録が貯まって読み込むと、ここできみの毎日を地図の上でリプレイできます!</p>
        </section>
      </div>
    )
  }
  return <ReplayMap data={data} stats={stats} />
}

function ReplayMap({ data, stats }) {
  const mapRef = useRef(null)
  const mapObj = useRef(null)
  const markerRef = useRef(null)
  const trailRef = useRef(null)
  const rafRef = useRef(0)
  const simRef = useRef(stats.firstTime)
  const lastRealRef = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [speedIdx, setSpeedIdx] = useState(2)
  const [follow, setFollow] = useState(true)
  const [simTime, setSimTime] = useState(stats.firstTime)
  const [currentPlace, setCurrentPlace] = useState(null)
  const followRef = useRef(follow)
  followRef.current = follow
  const speedRef = useRef(SPEEDS[speedIdx][1])
  speedRef.current = SPEEDS[speedIdx][1]

  const visits = data.visits

  // simTime → 位置と現在地名
  const positionAt = useCallback((t) => {
    if (!visits.length) return null
    let lo = 0, hi = visits.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (visits[mid].start <= t) lo = mid
      else hi = mid - 1
    }
    const v = visits[lo]
    if (t <= v.end || lo === visits.length - 1) {
      return { lat: v.lat, lng: v.lng, visit: t >= v.start && t <= v.end ? v : null }
    }
    const nx = visits[lo + 1]
    const f = Math.min(1, Math.max(0, (t - v.end) / Math.max(1, nx.start - v.end)))
    return { lat: v.lat + (nx.lat - v.lat) * f, lng: v.lng + (nx.lng - v.lng) * f, visit: null }
  }, [visits])

  // 端末内だけで描画する冒険マップ初期化
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return
    const center = stats.topPlace ? [stats.topPlace.lat, stats.topPlace.lng] : [35.68, 139.76]
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false }).setView(center, 12)
    new OfflineGridLayer({ tileSize: 256, minZoom: 2, maxZoom: 19, noWrap: true }).addTo(map)
    // よく行く場所を訪問回数に応じた光る円で表示
    for (const p of stats.places.slice(0, 60)) {
      const r = 4 + Math.min(18, Math.sqrt(p.count) * 1.4)
      L.circleMarker([p.lat, p.lng], {
        radius: r, color: CATEGORIES[p.category]?.color || '#9ca3af',
        fillColor: CATEGORIES[p.category]?.color || '#9ca3af',
        fillOpacity: 0.25, weight: 1.5, opacity: 0.8,
      }).addTo(map).bindTooltip((() => {
        const content = document.createElement('span')
        content.append(document.createTextNode(`${CATEGORIES[p.category]?.icon || '📍'} ${p.name || '名もなき場所'}`))
        content.append(document.createElement('br'))
        content.append(document.createTextNode(`${p.count}回訪問`))
        return content
      })(), { className: 'lr-tooltip' })
    }
    trailRef.current = L.polyline([], { color: '#fbbf24', weight: 2.5, opacity: 0.85 }).addTo(map)
    const heroIcon = L.divIcon({ className: 'hero-marker', html: '<div class="hero-dot"><span>🧭</span></div>', iconSize: [34, 34], iconAnchor: [17, 17] })
    markerRef.current = L.marker(center, { icon: heroIcon, zIndexOffset: 1000 }).addTo(map)
    mapObj.current = map
    const pos = positionAt(stats.firstTime)
    if (pos) markerRef.current.setLatLng([pos.lat, pos.lng])
    return () => { map.remove(); mapObj.current = null }
  }, [])

  const applyTime = useCallback((t, addTrail) => {
    const pos = positionAt(t)
    if (!pos) return
    markerRef.current?.setLatLng([pos.lat, pos.lng])
    setCurrentPlace(pos.visit)
    if (addTrail && trailRef.current) {
      const pts = trailRef.current.getLatLngs()
      const last = pts[pts.length - 1]
      if (!last || Math.abs(last.lat - pos.lat) + Math.abs(last.lng - pos.lng) > 0.0004) {
        trailRef.current.addLatLng([pos.lat, pos.lng])
        if (pts.length > 3000) trailRef.current.setLatLngs(pts.slice(-2500))
      }
    }
    if (followRef.current && mapObj.current) {
      const b = mapObj.current.getBounds()
      if (!b.contains([pos.lat, pos.lng])) mapObj.current.panTo([pos.lat, pos.lng])
    }
  }, [positionAt])

  // 再生ループ
  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return }
    lastRealRef.current = performance.now()
    const loop = (now) => {
      const dtReal = (now - lastRealRef.current) / 1000
      lastRealRef.current = now
      simRef.current = Math.min(stats.lastTime, simRef.current + dtReal * speedRef.current)
      applyTime(simRef.current, true)
      setSimTime(simRef.current)
      if (simRef.current >= stats.lastTime) { setPlaying(false); return }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [playing, applyTime, stats.lastTime])

  const seek = (frac) => {
    const t = stats.firstTime + (stats.lastTime - stats.firstTime) * frac
    simRef.current = t
    setSimTime(t)
    trailRef.current?.setLatLngs([])
    applyTime(t, false)
  }
  const restart = () => {
    seek(0)
    setPlaying(true)
  }

  const frac = (simTime - stats.firstTime) / Math.max(1, stats.lastTime - stats.firstTime)
  const d = new Date(simTime)
  const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

  return (
    <div className="tab-body replay-body">
      <div className="replay-hud">
        <div className="replay-date">{dateStr}</div>
        <div className="replay-place">
          {currentPlace
            ? `${CATEGORIES[stats.places.find((p) => p.key === placeKeyOf(currentPlace))?.category]?.icon || '📍'} ${currentPlace.name || stats.places.find((p) => p.key === placeKeyOf(currentPlace))?.name || '滞在中…'}`
            : '🚶 移動中…'}
        </div>
      </div>
      <div className="map-wrap">
        <div ref={mapRef} className="map" />
        <div className="map-privacy">🔒 オフライン冒険マップ</div>
      </div>
      <div className="replay-controls">
        <button className="ctl-btn" onClick={restart} title="最初から">⏮</button>
        <button className="ctl-btn play" onClick={() => setPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
        <input type="range" min="0" max="1000" value={Math.round(frac * 1000)}
          onChange={(e) => { setPlaying(false); seek(e.target.value / 1000) }} className="seek" />
        <select value={speedIdx} onChange={(e) => setSpeedIdx(+e.target.value)} className="speed-select">
          {SPEEDS.map(([label], i) => <option key={i} value={i}>{label}</option>)}
        </select>
        <label className="follow-label"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />追従</label>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// 場所タブ (端末内の手動ラベル)
// ------------------------------------------------------------------
const visitDateFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const formatVisitDate = (time) => visitDateFormatter.format(new Date(time))

const formatMinutes = (minutes) => {
  const rounded = Math.max(0, Math.round(minutes || 0))
  if (rounded < 60) return `${rounded}分`
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  return rest ? `${hours}時間${rest}分` : `${hours}時間`
}

const formatDistance = (meters) => {
  if (meters < 1000) return `約${Math.max(10, Math.round(meters / 10) * 10)}m`
  return `約${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)}km`
}

function PlaceContextMap({ place, context, onSelect }) {
  const mapRef = useRef(null)
  const mapObj = useRef(null)
  const layerRef = useRef(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  useEffect(() => {
    if (!mapRef.current) return
    const map = L.map(mapRef.current, { zoomControl: true, attributionControl: false })
      .setView([place.lat, place.lng], 14)
    new OfflineGridLayer({ tileSize: 256, minZoom: 2, maxZoom: 19, noWrap: true }).addTo(map)
    const layer = L.layerGroup().addTo(map)
    mapObj.current = map
    layerRef.current = layer
    return () => {
      layer.clearLayers()
      map.remove()
      mapObj.current = null
      layerRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapObj.current
    const layer = layerRef.current
    if (!map || !layer || !place || !context) return
    layer.clearLayers()

    L.circle([place.lat, place.lng], {
      radius: 1000,
      color: '#f5c542',
      weight: 1,
      opacity: 0.42,
      fillOpacity: 0.03,
      dashArray: '5 7',
      interactive: false,
    }).addTo(layer)

    for (const segment of context.routeSegments) {
      L.polyline(segment.map((point) => [point.lat, point.lng]), {
        color: '#6ee7ff',
        weight: 3,
        opacity: 0.7,
        dashArray: '8 8',
        interactive: false,
      }).addTo(layer)
    }

    for (const nearby of context.mapPlaces) {
      const marker = L.marker([nearby.lat, nearby.lng], {
        icon: L.divIcon({
          className: `place-map-number ${nearby.name ? 'named' : 'unnamed'}`,
          html: `<span>${nearby.rank}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
        keyboard: true,
        title: nearby.name || `未命名スポット #${nearby.rank}`,
      }).addTo(layer)
      const tooltip = document.createElement('span')
      tooltip.textContent = `${nearby.name || `未命名スポット #${nearby.rank}`}・${nearby.count}回`
      marker.bindTooltip(tooltip)
      marker.on('click', () => onSelectRef.current?.(nearby.key))
    }

    L.marker([place.lat, place.lng], {
      icon: L.divIcon({
        className: 'place-map-number selected',
        html: `<span>${place.rank}</span>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      }),
      keyboard: false,
      title: `選択中: ${place.name || `未命名スポット #${place.rank}`}`,
      zIndexOffset: 1000,
    }).addTo(layer)

    map.setView([place.lat, place.lng], 14, { animate: false })
    const frame = requestAnimationFrame(() => map.invalidateSize())
    return () => cancelAnimationFrame(frame)
  }, [place, context])

  return (
    <div className="place-map-wrap">
      <div
        ref={mapRef}
        className="place-context-map"
        role="img"
        aria-label="選択した場所と周辺の位置関係を示すオフライン地図"
      />
      <div className="place-map-privacy">🔒 端末内の移動だけで描画</div>
      <div className="place-map-legend">
        <span><i className="legend-dot selected" />選択中</span>
        <span><i className="legend-dot named" />名前付き</span>
        {context.routeKind && (
          <span>
            <i className="legend-line" />
            {context.routeKind === 'recorded' ? '前後の移動記録' : '当日の訪問順（推定）'}
          </span>
        )}
      </div>
    </div>
  )
}

function PlaceSuggestionPanel({
  place,
  isDemo,
  selectedGooglePlaceId,
  linkedCategory,
  linkPending,
  onSelectCandidate,
}) {
  const [status, setStatus] = useState('idle')
  const [candidates, setCandidates] = useState([])
  const [message, setMessage] = useState('')
  const [remaining, setRemaining] = useState(null)
  const abortRef = useRef(null)

  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setStatus('idle')
    setCandidates([])
    setMessage('')
    setRemaining(null)
  }, [place?.key])

  useEffect(() => () => abortRef.current?.abort(), [])

  const findCandidates = async () => {
    if (!place || isDemo || status === 'loading') return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setCandidates([])
    setMessage('')
    setRemaining(null)
    try {
      const result = await requestPlaceSuggestions(place, { signal: controller.signal })
      if (controller.signal.aborted) return
      setCandidates(result.candidates)
      setRemaining(result.usage.remaining)
      setStatus(result.candidates.length ? 'success' : 'empty')
    } catch (error) {
      if (error?.name === 'AbortError') return
      setMessage(error?.message || '候補を取得できませんでした。')
      setStatus('error')
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  return (
    <section className="place-suggestions" aria-labelledby="place-suggestions-title">
      <div className="place-suggestions-head">
        <div>
          <h4 id="place-suggestions-title">近くの施設名から候補を探す</h4>
          <p>
            押した時だけ、この地点1件の座標を検索サーバー経由でGoogle Placesへ送ります。
            全履歴・経路・訪問日時・入力した名前は送りません。
          </p>
        </div>
        <button
          type="button"
          className="find-place-btn"
          onClick={findCandidates}
          disabled={isDemo || status === 'loading'}
        >
          {status === 'loading' ? '検索中…' : '候補を探す'}
        </button>
      </div>

      {isDemo && (
        <p className="place-suggestion-note">デモ地点では外部検索を行いません。実データで利用できます。</p>
      )}
      {selectedGooglePlaceId && (
        <p className={`place-linked-status ${linkPending ? 'pending' : ''}`}>
          {linkPending
            ? '候補を選択中です。下のカテゴリを確認して「紐付けを保存」を押してください。'
            : `✓ ${CATEGORIES[linkedCategory]?.icon || '📍'} ${CATEGORIES[linkedCategory]?.label || 'その他'}としてAI分析に利用できます。施設名・住所は保存していません。`}
        </p>
      )}
      {status === 'empty' && (
        <p className="place-suggestion-note">半径約120mに候補が見つかりませんでした。</p>
      )}
      {status === 'error' && (
        <p className="place-suggestion-error" role="alert">{message}</p>
      )}
      {status === 'success' && (
        <>
          <p className="place-suggestion-note">
            半径約120mの施設を近い順に表示します。正しい候補を選び、
            下のカテゴリを確認して保存してください。名前の入力は任意です。
          </p>
          <div className="place-suggestion-list">
            {candidates.map((candidate) => (
              <article
                className="place-suggestion-card"
                key={candidate.id}
              >
                <span className="place-suggestion-main">
                  <b>{candidate.name}</b>
                  <small>
                    {candidate.typeLabel || CATEGORIES[candidate.category]?.label || '施設'}
                    {candidate.distanceMeters != null ? `・約${candidate.distanceMeters}m` : ''}
                  </small>
                  {candidate.address && <small>{candidate.address}</small>}
                </span>
                <span className="place-suggestion-actions">
                  <button
                    type="button"
                    className="choose-place-candidate-btn"
                    disabled={candidate.id === selectedGooglePlaceId}
                    onClick={() => onSelectCandidate({
                      id: candidate.id,
                      category: candidate.category,
                    })}
                  >
                    {candidate.id === selectedGooglePlaceId ? '選択中' : 'この場所を選ぶ'}
                  </button>
                  {candidate.googleMapsUri && (
                    <a
                      className="place-suggestion-map-link"
                      href={candidate.googleMapsUri}
                      target="_blank"
                      rel="noreferrer"
                    >
                      地図で確認
                    </a>
                  )}
                </span>
              </article>
            ))}
          </div>
          <div className="google-attribution">
            提供: <span translate="no">Google Maps</span>
            {remaining != null && <span>・今月あと{remaining.toLocaleString('ja-JP')}回</span>}
          </div>
          {candidates.some((candidate) => candidate.attributions.length) && (
            <div className="third-party-attributions">
              追加提供:
              {[...new Map(
                candidates
                  .flatMap((candidate) => candidate.attributions)
                  .map((attribution) => [
                    `${attribution.provider}|${attribution.providerUri}`,
                    attribution,
                  ])
              ).values()].map((attribution, index) => (
                attribution.providerUri ? (
                  <a
                    key={`${attribution.providerUri}-${index}`}
                    href={attribution.providerUri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {attribution.provider || '提供元'}
                  </a>
                ) : (
                  <span key={`${attribution.provider}-${index}`}>{attribution.provider}</span>
                )
              ))}
            </div>
          )}
        </>
      )}
      <div className="place-suggestion-links">
        <a href="/privacy.html" target="_blank" rel="noreferrer">プライバシー</a>
        <a href="/terms.html" target="_blank" rel="noreferrer">利用規約</a>
      </div>
    </section>
  )
}

function PlacesTab({ data, stats, labels, setLabels, isDemo }) {
  const identifyRef = useRef(null)
  const nameInputRef = useRef(null)
  const rankedPlaces = useMemo(
    () => stats.places.map((place, index) => ({ ...place, rank: index + 1 })),
    [stats.places]
  )
  const contextIndex = useMemo(() => createPlaceContextIndex(data), [data])
  const unnamed = rankedPlaces.filter(
    (place) => !place.name && !labels[place.key]?.googlePlaceId
  )
  const [filter, setFilter] = useState(() => unnamed.length ? 'unnamed' : 'all')
  const [visibleCount, setVisibleCount] = useState(50)
  const [selectedKey, setSelectedKey] = useState(() => unnamed[0]?.key || rankedPlaces[0]?.key || null)
  const [draftName, setDraftName] = useState('')
  const [draftCategory, setDraftCategory] = useState('other')
  const [draftGooglePlaceId, setDraftGooglePlaceId] = useState('')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [savedKey, setSavedKey] = useState(null)
  const [editorError, setEditorError] = useState('')

  const selectedPlace = rankedPlaces.find((place) => place.key === selectedKey) || rankedPlaces[0] || null
  const context = useMemo(
    () => buildPlaceContext(contextIndex, selectedPlace, rankedPlaces),
    [contextIndex, selectedPlace, rankedPlaces]
  )
  const filteredPlaces = filter === 'unnamed' ? unnamed : rankedPlaces
  const visiblePlaces = filteredPlaces.slice(0, visibleCount)
  const storedName = selectedPlace ? (labels[selectedPlace.key]?.name ?? selectedPlace.name ?? '') : ''
  const storedCategory = selectedPlace ? (labels[selectedPlace.key]?.category ?? selectedPlace.category) : 'other'
  const storedGooglePlaceId = selectedPlace ? (labels[selectedPlace.key]?.googlePlaceId ?? '') : ''
  const isDirty = !!selectedPlace && (
    draftName !== storedName ||
    draftCategory !== storedCategory ||
    draftGooglePlaceId !== storedGooglePlaceId
  )
  const linkPending = draftGooglePlaceId !== storedGooglePlaceId
  const otherUnnamed = unnamed.filter((place) => place.key !== selectedKey)
  const selectedDisplayName = selectedPlace
    ? selectedPlace.name ||
      (storedGooglePlaceId
        ? `${CATEGORIES[storedCategory]?.icon || '📍'} ${CATEGORIES[storedCategory]?.label || 'その他'}スポット #${selectedPlace.rank}`
        : `未確認スポット #${selectedPlace.rank}`)
    : ''

  useEffect(() => {
    if (!selectedPlace) return
    setDraftName(storedName)
    setDraftCategory(storedCategory)
    setDraftGooglePlaceId(storedGooglePlaceId)
    setCategoryTouched(false)
    setEditorError('')
  }, [selectedPlace?.key, storedName, storedCategory, storedGooglePlaceId])

  useEffect(() => {
    setSavedKey(null)
  }, [selectedPlace?.key])

  useEffect(() => {
    if (!selectedKey && rankedPlaces[0]) setSelectedKey(rankedPlaces[0].key)
  }, [selectedKey, rankedPlaces])

  const setPlace = (key, patch) => {
    const next = { ...labels, [key]: { ...labels[key], ...patch } }
    if (!saveJson(LS_LABELS, next)) {
      setEditorError('端末内へ保存できませんでした。ブラウザのストレージ設定を確認してください。')
      return false
    }
    setLabels(next)
    return true
  }

  const scrollToIdentifier = () => {
    requestAnimationFrame(() => identifyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const commitDraft = () => {
    if (!selectedPlace) return false
    const name = draftName.trim()
    if (!name && storedName) {
      setEditorError('登録済みの場所名を空にはできません。変更する名前を入力してください。')
      setSavedKey(null)
      nameInputRef.current?.focus()
      return false
    }
    if (!name && !draftGooglePlaceId) {
      setEditorError('場所名を入力するか、施設候補を選んでカテゴリを紐付けてください。')
      setSavedKey(null)
      nameInputRef.current?.focus()
      return false
    }
    const patch = {}
    if (name) patch.name = name
    if (linkPending) patch.googlePlaceId = draftGooglePlaceId
    if (categoryTouched || linkPending) patch.category = draftCategory
    if (!setPlace(selectedPlace.key, patch)) {
      setSavedKey(null)
      return false
    }
    setDraftName(name)
    setSavedKey(selectedPlace.key)
    setCategoryTouched(false)
    setEditorError('')
    return true
  }

  const saveSelected = (event) => {
    event.preventDefault()
    commitDraft()
  }

  const resetDraft = () => {
    setDraftName(storedName)
    setDraftCategory(storedCategory)
    setDraftGooglePlaceId(storedGooglePlaceId)
    setCategoryTouched(false)
    setSavedKey(null)
    setEditorError('')
  }

  const selectPlace = (key, { scroll = false } = {}) => {
    if (!key || key === selectedKey) return
    if (isDirty) {
      setEditorError('入力中の変更があります。保存するか、変更を取り消してから別の場所を選んでください。')
      scrollToIdentifier()
      return
    }
    setSelectedKey(key)
    if (scroll) scrollToIdentifier()
  }

  const selectNextUnnamed = () => {
    if (!otherUnnamed.length) return
    if (isDirty && !commitDraft()) return
    const next = otherUnnamed[0]
    setSelectedKey(next.key)
    scrollToIdentifier()
  }

  const changeFilter = (nextFilter) => {
    const candidates = nextFilter === 'unnamed' ? unnamed : rankedPlaces
    if (
      isDirty &&
      candidates.length &&
      !candidates.some((place) => place.key === selectedKey)
    ) {
      setEditorError('入力中の変更があります。保存するか、変更を取り消してから絞り込みを切り替えてください。')
      scrollToIdentifier()
      return
    }
    setFilter(nextFilter)
    setVisibleCount(50)
    if (candidates.length && !candidates.some((place) => place.key === selectedKey)) {
      selectPlace(candidates[0].key)
    }
  }

  const selectSuggestionCandidate = (candidate) => {
    try {
      const link = buildConfirmedPlaceLink(candidate, candidate.category)
      setDraftGooglePlaceId(link.googlePlaceId)
      setDraftCategory(link.category)
      setCategoryTouched(true)
      setSavedKey(null)
      setEditorError('')
    } catch (error) {
      setEditorError(error?.message || '候補を選択できませんでした。')
    }
  }

  return (
    <div className="tab-body">
      {unnamed.length > 0 && (
        <section className="panel privacy-panel">
          <h3 className="panel-title">🔒 未確認の場所を、名前入力なしでも分類</h3>
          <p className="panel-note">
            移動ルート・訪問日時・滞在時間・地図は端末内で処理します。
            「候補を探す」を押した場合に限り、選択中の地点1件の座標だけを施設検索へ送信します。
            保存するのはPlace IDと、あなたが確認したカテゴリだけです。
          </p>
        </section>
      )}

      {selectedPlace && context && (
        <section ref={identifyRef} className="panel place-identify-panel">
          <div className="place-identify-head">
            <div>
              <span className="place-eyebrow">場所の分類・命名アシスト</span>
              <h3 className="panel-title">
                🧭 {selectedDisplayName}
              </h3>
            </div>
            <button
              type="button"
              className="next-place-btn"
              onClick={selectNextUnnamed}
              disabled={!otherUnnamed.length}
            >
              {isDirty ? '保存して次へ →' : '次の未確認へ →'}
            </button>
          </div>

          <div className="places-workspace">
            <PlaceContextMap place={selectedPlace} context={context} onSelect={(key) => selectPlace(key)} />
            <div className="place-clues">
              <PlaceSuggestionPanel
                place={selectedPlace}
                isDemo={isDemo}
                selectedGooglePlaceId={draftGooglePlaceId}
                linkedCategory={draftCategory}
                linkPending={linkPending}
                onSelectCandidate={selectSuggestionCandidate}
              />

              <div className="place-clue-summary">
                <div><span>訪問</span><b>{selectedPlace.count}回</b></div>
                <div><span>平均滞在</span><b>{formatMinutes(context.averageStayMin)}</b></div>
                <div><span>よく行く時間</span><b>{context.typicalTime || '記録なし'}</b></div>
              </div>

              {(context.previousPlace || context.nextPlace) && (
                <div className="trip-context" aria-label="直近訪問の前後に確認できた名前付き場所">
                  {context.previousPlace && (
                    <div>
                      <small>直前に確認できた名前付き場所</small>
                      <b>{context.previousPlace.name}</b>
                      <span>{formatMinutes(context.previousPlace.gapMin)}前</span>
                    </div>
                  )}
                  {context.nextPlace && (
                    <div>
                      <small>次に確認できた名前付き場所</small>
                      <b>{context.nextPlace.name}</b>
                      <span>{formatMinutes(context.nextPlace.gapMin)}後</span>
                    </div>
                  )}
                </div>
              )}

              <div className="clue-block">
                <h4>最近訪れた日時</h4>
                {context.recentVisits.length ? (
                  <ul className="recent-visits">
                    {context.recentVisits.map((visit) => (
                      <li key={`${visit.start}-${visit.end}`}>
                        <span>{formatVisitDate(visit.start)}</span>
                        <b>{formatMinutes(visit.durationMin)}滞在</b>
                      </li>
                    ))}
                  </ul>
                ) : <p className="clue-empty">訪問日時の記録がありません。</p>}
              </div>

              <div className="clue-block">
                <h4>名前付き場所からの位置</h4>
                {context.namedAnchors.length ? (
                  <ul className="anchor-hints">
                    {context.namedAnchors.map((anchor) => (
                      <li key={anchor.key}>
                        {anchor.sameLocation ? (
                          <><b>{anchor.name}</b>とほぼ同じ位置</>
                        ) : (
                          <><b>{anchor.name}</b>から{anchor.direction}へ {formatDistance(anchor.distanceMeters)}</>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="clue-empty">先に自宅など1ヶ所へ名前を付けると、距離と方角が表示されます。</p>
                )}
              </div>

              <form className="place-editor" onSubmit={saveSelected}>
                <label>
                  この場所の名前{draftGooglePlaceId ? '（任意）' : ''}
                  <input
                    ref={nameInputRef}
                    className="place-input"
                    value={draftName}
                    placeholder="例：いつものカフェ、〇〇駅"
                    onChange={(event) => {
                      setDraftName(event.target.value)
                      setSavedKey(null)
                      setEditorError('')
                    }}
                    autoComplete="off"
                  />
                </label>
                <label>
                  カテゴリ
                  <select
                    className="place-select"
                    value={draftCategory}
                    onChange={(event) => {
                      setDraftCategory(event.target.value)
                      setCategoryTouched(true)
                      setSavedKey(null)
                      setEditorError('')
                    }}
                  >
                    {Object.entries(CATEGORIES).map(([key, value]) => (
                      <option key={key} value={key}>{value.icon} {value.label}</option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="save-place-btn">
                  {linkPending ? 'カテゴリ紐付けを保存' : '端末内に保存'}
                </button>
                <span className={`place-save-status ${editorError ? 'error' : ''}`} role="status">
                  {editorError || (savedKey === selectedPlace.key ? '✓ 保存しました' : '')}
                </span>
                {isDirty && (
                  <button type="button" className="discard-place-btn" onClick={resetDraft}>
                    変更を取り消す
                  </button>
                )}
              </form>

              <details className="coordinate-details">
                <summary>座標を確認する</summary>
                <code>{selectedPlace.lat.toFixed(5)}, {selectedPlace.lng.toFixed(5)}</code>
              </details>
            </div>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="place-list-head">
          <div>
            <h3 className="panel-title">📜 訪問場所一覧</h3>
            <p className="panel-note">行や地図の番号を押すと、場所の手がかりが切り替わります。</p>
          </div>
          <div className="place-filters" role="group" aria-label="場所一覧の絞り込み">
            <button
              type="button"
              className={filter === 'unnamed' ? 'active' : ''}
              onClick={() => changeFilter('unnamed')}
              aria-pressed={filter === 'unnamed'}
            >
              未確認 {unnamed.length}
            </button>
            <button
              type="button"
              className={filter === 'all' ? 'active' : ''}
              onClick={() => changeFilter('all')}
              aria-pressed={filter === 'all'}
            >
              すべて {rankedPlaces.length}
            </button>
          </div>
        </div>

        {!stats.places.length && (
          <p className="panel-note">まだ訪問記録がありません。記録が貯まるとここに場所が並びます。</p>
        )}
        {filter === 'unnamed' && !filteredPlaces.length && (
          <p className="all-places-named">🎉 すべての場所を確認しました！</p>
        )}
        <div className="place-table">
          {visiblePlaces.map((place) => {
            const visits = contextIndex.visitsByKey.get(place.key) || []
            const lastVisit = visits.length ? visits[visits.length - 1].start : place.firstVisit
            return (
              <button
                type="button"
                className={`place-row ${place.key === selectedPlace?.key ? 'selected' : ''}`}
                key={place.key}
                onClick={() => selectPlace(place.key, { scroll: true })}
                aria-pressed={place.key === selectedPlace?.key}
              >
                <span className="place-rank">#{place.rank}</span>
                <span className="place-row-main">
                  <b>
                    {CATEGORIES[place.category]?.icon}{' '}
                    {place.name || (
                      labels[place.key]?.googlePlaceId
                        ? `${CATEGORIES[place.category]?.label || 'その他'}スポット #${place.rank}`
                        : `未確認スポット #${place.rank}`
                    )}
                  </b>
                  <small>{formatMinutes(place.totalMin)}滞在・最近 {formatVisitDate(lastVisit)}</small>
                </span>
                <span className="place-category">{CATEGORIES[place.category]?.label}</span>
                <span className="place-count">{place.count}回</span>
                <span className="place-open">見る</span>
              </button>
            )
          })}
        </div>
        {filteredPlaces.length > visibleCount && (
          <button
            type="button"
            className="load-more-places"
            onClick={() => setVisibleCount((count) => count + 50)}
          >
            さらに50件表示
          </button>
        )}
      </section>
    </div>
  )
}

// ------------------------------------------------------------------
// サイト訪問数パネル (?stats を付けたURLでのみ表示 — 運営者用)
// ------------------------------------------------------------------
function SiteStatsPanel() {
  const [stats, setStats] = useState(undefined)
  useEffect(() => { fetchSiteStats().then(setStats) }, [])
  return (
    <div className="site-stats">
      <div className="site-stats-title">👁 サイト訪問数</div>
      {stats === undefined && <div className="site-stats-row">読み込み中…</div>}
      {stats === null && <div className="site-stats-row">取得失敗(テーブル未作成?)</div>}
      {stats && (
        <>
          <div className="site-stats-row"><span>累計</span><b>{stats.total?.toLocaleString?.() ?? stats.total}</b></div>
          <div className="site-stats-row"><span>24時間</span><b>{stats.last24h?.toLocaleString?.() ?? stats.last24h}</b></div>
          <div className="site-stats-row"><span>7日間</span><b>{stats.last7d?.toLocaleString?.() ?? stats.last7d}</b></div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// App
// ------------------------------------------------------------------
const TABS = [
  ['stats', '📊 スタッツ'],
  ['ach', '🏅 実績'],
  ['replay', '🎬 リプレイ'],
  ['places', '📜 場所'],
]

function App() {
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('stats')
  const [labels, setLabels] = useState(() => loadJson(LS_LABELS, {}))
  const [ceremony, setCeremony] = useState(null)
  const [isDemo, setIsDemo] = useState(false)
  const [booting, setBooting] = useState(true)
  const [saved, setSaved] = useState(null) // 復元可能な保存データ
  const [importNotice, setImportNotice] = useState(null)
  const [dropActive, setDropActive] = useState(false)
  const updateInputRef = useRef(null)
  const importLockRef = useRef(false)

  // 訪問カウント(固定の visit 文字列だけ。読込データへアクセスしない)
  useEffect(() => { recordVisit() }, [])

  // 起動時: 保存済みデータがあれば自動復元して即開始
  useEffect(() => {
    loadData()
      .then((d) => {
        if (d && (d.visits?.length || d.zeroStart)) {
          setSaved(d)
          setData(d)
        }
      })
      .finally(() => setBooting(false))
  }, [])

  const stats = useMemo(() => (data ? computeStats(data, labels) : null), [data, labels])
  const achievements = useMemo(() => (stats ? evaluateAchievements(stats) : []), [stats])
  const xp = useMemo(() => (stats ? computeXp(stats, achievements) : null), [stats, achievements])

  const clearSavedUserData = async () => {
    setError(null)
    try {
      await clearData()
      localStorage.removeItem(LS_LABELS)
      localStorage.removeItem(LS_UNLOCKED)
      setLabels({})
      setSaved(null)
      setCeremony(null)
      setImportNotice(null)
    } catch {
      setError('保存データをすべて消去できませんでした。ブラウザのサイトデータ設定から削除してください。')
    }
  }

  // 新規解除の検出 → セレモニー
  useEffect(() => {
    if (!achievements.length) return
    const prev = new Set(loadJson(LS_UNLOCKED, []))
    const fresh = achievements.filter((a) => a.unlocked && !prev.has(a.id))
    if (fresh.length) {
      setCeremony(fresh)
      saveJson(LS_UNLOCKED, achievements.filter((a) => a.unlocked).map((a) => a.id))
    }
  }, [achievements])

  const onData = async (input, mode = 'replace') => {
    if (importLockRef.current) return
    importLockRef.current = true
    setBusy(true)
    setError(null)
    setImportNotice(null)
    try {
      let parsed
      let report = null
      if (input === 'demo') {
        // デモは毎回まっさらな状態から(実績演出を見せるため)
        localStorage.removeItem(LS_UNLOCKED)
        parsed = parseObjects([generateDemoData()])
        setIsDemo(true)
      } else if (input === 'zero') {
        // ゼロスタート: 記録0のまま冒険開始。状態を保存して次回も続きから
        localStorage.removeItem(LS_UNLOCKED)
        parsed = { visits: [], paths: [], activities: [], sourceFormats: [], errors: [], zeroStart: true }
        setIsDemo(false)
        try {
          const stored = await saveData(parsed)
          setSaved(stored)
        } catch {
          setImportNotice('冒険は開始できましたが、端末への保存に失敗しました。ブラウザのストレージ設定を確認してください。')
        }
        setData(parsed)
        setTab('stats')
        return
      } else {
        const incoming = await parseFiles(input)
        if (!incoming.visits.length && !incoming.activities.length) {
          setError(incoming.errors[0] || '訪問データが見つかりませんでした。Timeline.json / location-history.json を指定してください。')
          return
        }
        const mergeBase = mode === 'merge' && !isDemo ? (data || saved) : null
        if (mergeBase && (mergeBase.visits?.length || mergeBase.activities?.length || mergeBase.zeroStart)) {
          const merged = mergeParsedData(mergeBase, incoming)
          parsed = merged.data
          report = merged.report
        } else {
          parsed = incoming
        }
        setIsDemo(false)
      }
      if (!parsed.visits.length && !parsed.activities.length) {
        setError(parsed.errors[0] || '訪問データが見つかりませんでした。Timeline.json / location-history.json を指定してください。')
        return
      }
      if (input !== 'demo') {
        // 実データは端末内に保存 → 次回からURLを開くだけで自動復元
        let saveWarning = ''
        try {
          const stored = await saveData(parsed)
          setSaved(stored)
        } catch {
          saveWarning = ' ただし端末への保存に失敗したため、次回は自動復元されません。'
        }
        if (report) {
          const added = report.visitsAdded + report.activitiesAdded + report.pathsAdded
          const details = [
            report.visitsAdded ? `訪問${report.visitsAdded}件` : null,
            report.activitiesAdded ? `移動${report.activitiesAdded}件` : null,
            report.pathsAdded ? `経路${report.pathsAdded}本` : null,
          ].filter(Boolean).join('・')
          setImportNotice(
            added
              ? `最新データを追加しました：${details}${report.duplicatesSkipped ? `（重複${report.duplicatesSkipped}件を除外）` : ''}${saveWarning}`
              : `確認完了：新しい記録はありません（重複${report.duplicatesSkipped}件を除外）。${saveWarning}`,
          )
        } else {
          setImportNotice(`データを読み込みました：訪問${parsed.visits.length}件・移動${parsed.activities.length}件。${saveWarning}`)
        }
      }
      setData(parsed)
      setTab('stats')
    } catch (e) {
      console.error(e)
      setError(`読み込みに失敗しました: ${e.message}`)
    } finally {
      importLockRef.current = false
      setBusy(false)
    }
  }

  const statsMode = useMemo(() => new URLSearchParams(location.search).has('stats'), [])
  const statsPanel = statsMode ? <SiteStatsPanel /> : null

  if (booting) {
    return statsPanel
  }
  if (!data || !stats) {
    return (
      <>
        {statsPanel}
        <TitleScreen
          onData={onData} busy={busy} error={error}
          savedAt={saved?.savedAt}
          onContinue={() => { setData(saved); setIsDemo(false); setTab('stats') }}
          onClearSaved={clearSavedUserData}
        />
      </>
    )
  }

  return (
    <div
      className={`app ${dropActive ? 'dragging-data' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!busy) setDropActive(true) }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDropActive(false)
        if (busy) return
        const files = [...e.dataTransfer.files].filter((f) => /\.(json|zip)$/i.test(f.name))
        if (files.length) onData(files, isDemo ? 'replace' : 'merge')
      }}
    >
      {statsPanel}
      {dropActive && <div className="app-drop-overlay">最新データをここにドロップ</div>}
      <header className="app-header">
        <div className="hdr-left">
          <span className="hdr-logo">🗺️</span>
          <div>
            <div className="hdr-title">ジブンクエスト</div>
            <div className="hdr-player">{titleForLevel(xp.level)}{isDemo && <span className="demo-chip">DEMO</span>}<span className="hdr-version">{APP_VERSION}</span></div>
          </div>
        </div>
        <div className="hdr-right">
          <div className="level-badge">Lv.{xp.level}</div>
          <div className="xp-wrap">
            <div className="xp-bar"><div style={{ width: `${xp.progress * 100}%` }} /></div>
            <div className="xp-text">{xp.xp.toLocaleString()} XP</div>
          </div>
          <button className="reset-btn update-data-btn" disabled={busy} title="最新データを追加" onClick={() => updateInputRef.current?.click()}>{busy ? '…' : '⟳'}</button>
          <button className="reset-btn" title="別のデータを読み込む" onClick={() => { setData(null); setIsDemo(false) }}>↩</button>
          <input ref={updateInputRef} type="file" accept=".json,.zip,application/json,application/zip" multiple hidden
            onChange={(e) => {
              const files = [...e.target.files]
              if (files.length) onData(files, isDemo ? 'replace' : 'merge')
              e.target.value = ''
            }} />
        </div>
      </header>

      <nav className="tab-bar">
        {TABS.map(([id, label]) => (
          <button key={id} className={`tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      <main className="app-main">
        {error && (
          <div className="import-notice error" role="alert">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)} aria-label="閉じる">×</button>
          </div>
        )}
        {importNotice && (
          <div className="import-notice" role="status">
            <span>✓ {importNotice}</span>
            <button onClick={() => setImportNotice(null)} aria-label="閉じる">×</button>
          </div>
        )}
        {tab === 'stats' && <StatsTab stats={stats} />}
        {tab === 'ach' && <AchievementsTab achievements={achievements} />}
        {tab === 'replay' && <ReplayTab data={data} stats={stats} />}
        {tab === 'places' && (
          <PlacesTab
            data={data}
            stats={stats}
            labels={labels}
            setLabels={setLabels}
            isDemo={isDemo}
          />
        )}
      </main>

      {ceremony && <UnlockCeremony queue={ceremony} onDone={() => setCeremony(null)} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
