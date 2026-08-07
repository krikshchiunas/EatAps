import { Component } from 'react'

// Последний рубеж: перехват ошибки рендера на уровне всего приложения.
//
// React 18 при неперехваченной ошибке размонтирует всё дерево — экран
// становится пустым, и человек не получает ни объяснения, ни выхода. Именно так
// выглядит «белый экран»: приложение работает, пока не встретит одну неудачную
// запись в данных, а потом исчезает целиком.
//
// Границы вокруг отдельных шторок (LazyBoundary) от этого не спасают: они ловят
// только то, что внутри них. Нужен корневой.
//
// Здесь намеренно нет ни useStore, ни зависимостей от синхронизации: сломаться
// могло именно то, что этот экран должен пережить.
export default class RootErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // В консоль — для отладки. Секретов в стеке нет, данные пользователя сюда
    // не попадают.
    // eslint-disable-next-line no-console
    console.error('[eataps] сбой рендера', error?.message || error, info?.componentStack?.slice(0, 400))
  }

  reload = () => window.location.reload()

  // Сброс кэша приложения: service worker и его хранилище. Записи о питании
  // (localStorage) не трогаем — они и так могут быть единственной копией.
  clearAppCache = async () => {
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.()
      await Promise.all((regs || []).map((r) => r.unregister()))
    } catch {}
    try {
      const keys = await window.caches?.keys?.()
      await Promise.all((keys || []).map((k) => window.caches.delete(k)))
    } catch {}
    window.location.reload()
  }

  // Аварийный выход из аккаунта на этом устройстве. Нужен, когда падение
  // вызвано именно загруженными данными аккаунта: без него человек заперт на
  // экране ошибки, потому что при каждом запуске данные грузятся заново.
  signOutLocal = async () => {
    try {
      const { supabase } = await import('../lib/supabase.js')
      await supabase?.auth?.signOut({ scope: 'local' })
    } catch {}
    window.location.reload()
  }

  render() {
    if (!this.state.error) return this.props.children

    const detail = String(this.state.error?.message || this.state.error || '').slice(0, 200)

    return (
      <div className="crash-screen">
        <div className="card">
          <div className="eyebrow">EatAps</div>
          <h1 className="h2" style={{ margin: '6px 0 10px' }}>Что-то сломалось</h1>
          <p className="muted" style={{ fontSize: 15, marginBottom: 20 }}>
            Приложение не смогло отрисовать экран. Ваши записи о питании при этом целы —
            они хранятся отдельно и никуда не делись.
          </p>

          <button className="btn" onClick={this.reload}>Перезагрузить</button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={this.clearAppCache}>
            Сбросить кэш приложения
          </button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={this.signOutLocal}>
            Выйти из аккаунта на этом устройстве
          </button>

          <p style={{ marginTop: 18, fontSize: 12, color: 'var(--ink-3)', wordBreak: 'break-word' }}>
            {detail || 'ошибка без описания'}
          </p>
          <p style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
            Если повторяется — покажите эту строку разработчику.
          </p>
        </div>
      </div>
    )
  }
}
