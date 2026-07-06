// IndexedDBへの解析結果の永続化
// 初回だけファイルを読み込めば、次回からはURLを開くだけで自動復元される。
// (データは端末内のブラウザストレージのみ。外部送信なし)

const DB_NAME = 'life-replay'
const STORE = 'data'
const KEY = 'current'

function openDb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1)
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE)
    rq.onsuccess = () => resolve(rq.result)
    rq.onerror = () => reject(rq.error)
  })
}

export async function saveData(data) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put({ ...data, savedAt: Date.now() }, KEY)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  })
}

export async function loadData() {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const rq = tx.objectStore(STORE).get(KEY)
      rq.onsuccess = () => { db.close(); resolve(rq.result || null) }
      rq.onerror = () => { db.close(); reject(rq.error) }
    })
  } catch {
    return null
  }
}

export async function clearData() {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); resolve() }
    })
  } catch { /* 失敗しても致命的ではない */ }
}
