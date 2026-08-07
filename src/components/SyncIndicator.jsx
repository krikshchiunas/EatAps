import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store.jsx'
import { SYNC } from '../lib/syncEngine.js'

// Ненавязчивый индикатор синхронизации.
//
// В нормальной жизни его не видно: показывать «синхронизировано» постоянно —
// шум. Он появляется только когда состояние отличается от «всё уехало на
// сервер», и коротко подтверждает успех после этого. «Сохраняется» тоже даём с
// задержкой: быстрый сейв не должен моргать плашкой на каждое действие.

const VIEW = {
  [SYNC.SYNCING]: { text: 'Сохраняем…', tone: 'muted' },
  [SYNC.LOCAL]: { text: 'Сохранено на устройстве', tone: 'muted' },
  [SYNC.OFFLINE]: { text: 'Нет сети — сохраним позже', tone: 'warn' },
  [SYNC.CONFLICT]: { text: 'Сводим изменения с других устройств', tone: 'warn' },
  [SYNC.ERROR]: { text: 'Не удалось синхронизировать', tone: 'danger' },
}

const SHOW_DELAY_MS = 1200 // столько «сохраняется» терпим молча
const SUCCESS_MS = 1600

export default function SyncIndicator() {
  const { syncStatus, signedIn, retrySync } = useStore()
  const [visible, setVisible] = useState(null) // null | статус | 'done'
  const wasVisible = useRef(false)

  useEffect(() => {
    if (!signedIn) { setVisible(null); wasVisible.current = false; return }

    if (syncStatus === SYNC.SYNCED) {
      // Подтверждаем успех только если до этого что-то показывали.
      if (!wasVisible.current) { setVisible(null); return }
      wasVisible.current = false
      setVisible('done')
      const t = setTimeout(() => setVisible(null), SUCCESS_MS)
      return () => clearTimeout(t)
    }

    if (!VIEW[syncStatus]) { setVisible(null); return }

    // Мгновенные состояния не показываем — только те, что задержались.
    const delay = syncStatus === SYNC.SYNCING ? SHOW_DELAY_MS : 0
    const t = setTimeout(() => { wasVisible.current = true; setVisible(syncStatus) }, delay)
    return () => clearTimeout(t)
  }, [syncStatus, signedIn])

  if (!visible) return null

  if (visible === 'done') {
    return <div className="sync-chip ok" role="status">✓ Синхронизировано</div>
  }

  const { text, tone } = VIEW[visible]
  const canRetry = visible === SYNC.ERROR || visible === SYNC.OFFLINE

  return (
    <div className={`sync-chip ${tone}`} role="status">
      <span>{text}</span>
      {canRetry && (
        <button type="button" onClick={retrySync} className="sync-chip-retry">Повторить</button>
      )}
    </div>
  )
}
