import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './style.css'
import { parseFiles, parseObjects } from './parse.js'
import { computeStats, formatKm } from './stats.js'
import { CATEGORIES, placeKeyOf } from './categories.js'
import { evaluateAchievements, computeXp, titleForLevel, ACHIEVEMENTS } from './achievements.js'
import { generateDemoData } from './demo.js'
import { resolvePlaces } from './geocode.js'
import { saveData, loadData, clearData } from './store.js'

const LS_UNLOCKED = 'lr_unlocked'
const LS_LABELS = 'lr_labels'

const loadJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const saveJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

// ------------------------------------------------------------------
// タイトル画面
// ------------------------------------------------------------------
function TitleScreen({ onData, busy, error, savedAt, onContinue, onClearSaved }) {
  const fileRef = useRef(null)
  const dirRef = useRef(null)
  const [drag, setDrag] = useState(false)

  const handleFiles = (list) => {
    const files = [...list].filter((f) => /\.(json|zip)$/i.test(f.name))
    if (files.length) onData(files)
  }

  return (
    <div
      className={`title-screen ${drag ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files) }}
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
              <button className="menu-btn primary" onClick={onContinue}>
                ▶ 続きから再開 <small className="saved-at">({new Date(savedAt).toLocaleDateString('ja-JP')}読込)</small>
              </button>
            )}

            <div className="onboard-card">
              <div className="onboard-head">🗂️ Googleマップのタイムラインを<b>使っていた人</b></div>
              <ol className="onboard-steps">
                <li>Googleマップ → プロフィール → <b>設定</b></li>
                <li>「タイムライン」→「<b>タイムライン データをエクスポート</b>」</li>
                <li>できたファイルを下のボタンで選ぶだけ!</li>
              </ol>
              <button className="menu-btn primary" onClick={() => fileRef.current?.click()}>
                ▶ データを読み込む
              </button>
              <button className="link-btn" onClick={() => dirRef.current?.click()}>
                PCのGoogle Takeout(ZIP・フォルダ)はこちら
              </button>
            </div>

            <div className="onboard-card">
              <div className="onboard-head">🌱 タイムラインが<b>オフだった人</b>・わからない人</div>
              <ol className="onboard-steps">
                <li>Googleマップ → 設定 → 「タイムライン」を<b>オン</b>にする</li>
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

        <p className="privacy-note title-privacy">🔒 解析はすべてこの端末内で完結。位置データが外部に送信されることはありません。一度読み込めば次回からは開くだけで自動復元されます。</p>
      </div>
      <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" multiple hidden
        onChange={(e) => handleFiles(e.target.files)} />
      <input ref={dirRef} type="file" webkitdirectory="" hidden
        onChange={(e) => handleFiles(e.target.files)} />
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
            ① Googleマップの設定で<b>タイムラインをオン</b>にしておく<br />
            ② いつも通り過ごすだけで、行った場所が自動で記録されていく<br />
            ③ 数日〜数週間たったら「<b>タイムライン データをエクスポート</b>」→ タイトル画面で読み込み。スタッツと実績が一気に解放される!
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
              <span className="place-name">{p.name || `名もなき場所 (${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})`}</span>
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

  // 地図初期化
  useEffect(() => {
    if (!mapRef.current || mapObj.current) return
    const center = stats.topPlace ? [stats.topPlace.lat, stats.topPlace.lng] : [35.68, 139.76]
    const map = L.map(mapRef.current, { zoomControl: true }).setView(center, 12)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 19,
    }).addTo(map)
    // よく行く場所を訪問回数に応じた光る円で表示
    for (const p of stats.places.slice(0, 60)) {
      const r = 4 + Math.min(18, Math.sqrt(p.count) * 1.4)
      L.circleMarker([p.lat, p.lng], {
        radius: r, color: CATEGORIES[p.category]?.color || '#9ca3af',
        fillColor: CATEGORIES[p.category]?.color || '#9ca3af',
        fillOpacity: 0.25, weight: 1.5, opacity: 0.8,
      }).addTo(map).bindTooltip(
        `${CATEGORIES[p.category]?.icon || '📍'} ${p.name || '名もなき場所'}<br>${p.count}回訪問`,
        { className: 'lr-tooltip' }
      )
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
      <div className="map-wrap"><div ref={mapRef} className="map" /></div>
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
// 場所タブ (名前解決・手動ラベル)
// ------------------------------------------------------------------
function PlacesTab({ stats, labels, setLabels }) {
  const [resolving, setResolving] = useState(null)
  const unnamed = stats.places.filter((p) => !p.name)

  const runResolve = async () => {
    setResolving({ done: 0, total: Math.min(40, unnamed.length), label: '' })
    const found = await resolvePlaces(
      unnamed.map((p) => ({ key: p.key, lat: p.lat, lng: p.lng })),
      (done, total, label) => setResolving({ done, total, label }),
    )
    setLabels((prev) => {
      const next = { ...prev, ...found }
      saveJson(LS_LABELS, next)
      return next
    })
    setResolving(null)
  }

  const setPlace = (key, patch) => {
    setLabels((prev) => {
      const next = { ...prev, [key]: { ...prev[key], ...patch } }
      saveJson(LS_LABELS, next)
      return next
    })
  }

  return (
    <div className="tab-body">
      {unnamed.length > 0 && (
        <section className="panel">
          <h3 className="panel-title">🔮 名もなき場所の解読</h3>
          <p className="panel-note">
            現行のGoogleエクスポートには場所名が含まれません。OpenStreetMapで上位{Math.min(40, unnamed.length)}ヶ所の名前を推定できます(無料・約{Math.min(40, unnamed.length)}秒)。
          </p>
          {resolving ? (
            <div className="resolve-progress">
              <div className="ach-progress-bar"><div style={{ width: `${(resolving.done / resolving.total) * 100}%` }} /></div>
              <span>{resolving.done}/{resolving.total} {resolving.label}</span>
            </div>
          ) : (
            <button className="menu-btn primary small" onClick={runResolve}>✨ 名前を解読する ({unnamed.length}ヶ所が未解読)</button>
          )}
        </section>
      )}
      <section className="panel">
        <h3 className="panel-title">📜 訪問場所一覧(上位50)</h3>
        {!stats.places.length && <p className="panel-note">まだ訪問記録がありません。記録が貯まるとここに場所が並びます。</p>}
        <div className="place-table">
          {stats.places.slice(0, 50).map((p) => (
            <div className="place-row" key={p.key}>
              <span className="place-icon">{CATEGORIES[p.category]?.icon}</span>
              <input
                className="place-input"
                value={labels[p.key]?.name ?? p.name ?? ''}
                placeholder={`(${p.lat.toFixed(3)}, ${p.lng.toFixed(3)})`}
                onChange={(e) => setPlace(p.key, { name: e.target.value })}
              />
              <select
                className="place-select"
                value={labels[p.key]?.category ?? p.category}
                onChange={(e) => setPlace(p.key, { category: e.target.value })}
              >
                {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
              <span className="place-count">{p.count}回</span>
            </div>
          ))}
        </div>
      </section>
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

  const onData = async (input) => {
    setBusy(true)
    setError(null)
    try {
      let parsed
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
        saveData(parsed).then(() => setSaved({ ...parsed, savedAt: Date.now() })).catch(() => {})
        setData(parsed)
        setTab('stats')
        setBusy(false)
        return
      } else {
        parsed = await parseFiles(input)
        setIsDemo(false)
      }
      if (!parsed.visits.length && !parsed.activities.length) {
        setError(parsed.errors[0] || '訪問データが見つかりませんでした。Timeline.json / location-history.json を指定してください。')
        setBusy(false)
        return
      }
      if (input !== 'demo') {
        // 実データは端末内に保存 → 次回からURLを開くだけで自動復元
        saveData(parsed).then(() => setSaved(parsed)).catch(() => {})
      }
      setData(parsed)
      setTab('stats')
    } catch (e) {
      console.error(e)
      setError(`読み込みに失敗しました: ${e.message}`)
    }
    setBusy(false)
  }

  if (booting) {
    return null
  }
  if (!data || !stats) {
    return (
      <TitleScreen
        onData={onData} busy={busy} error={error}
        savedAt={saved?.savedAt}
        onContinue={() => { setData(saved); setIsDemo(false); setTab('stats') }}
        onClearSaved={async () => { await clearData(); setSaved(null) }}
      />
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="hdr-left">
          <span className="hdr-logo">🗺️</span>
          <div>
            <div className="hdr-title">ジブンクエスト</div>
            <div className="hdr-player">{titleForLevel(xp.level)}{isDemo && <span className="demo-chip">DEMO</span>}</div>
          </div>
        </div>
        <div className="hdr-right">
          <div className="level-badge">Lv.{xp.level}</div>
          <div className="xp-wrap">
            <div className="xp-bar"><div style={{ width: `${xp.progress * 100}%` }} /></div>
            <div className="xp-text">{xp.xp.toLocaleString()} XP</div>
          </div>
          <button className="reset-btn" title="別のデータを読み込む" onClick={() => { setData(null); setIsDemo(false) }}>↩</button>
        </div>
      </header>

      <nav className="tab-bar">
        {TABS.map(([id, label]) => (
          <button key={id} className={`tab-btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </nav>

      <main className="app-main">
        {tab === 'stats' && <StatsTab stats={stats} />}
        {tab === 'ach' && <AchievementsTab achievements={achievements} />}
        {tab === 'replay' && <ReplayTab data={data} stats={stats} />}
        {tab === 'places' && <PlacesTab stats={stats} labels={labels} setLabels={setLabels} />}
      </main>

      {ceremony && <UnlockCeremony queue={ceremony} onDone={() => setCeremony(null)} />}
    </div>
  )
}

createRoot(document.getElementById('root')).render(<App />)
