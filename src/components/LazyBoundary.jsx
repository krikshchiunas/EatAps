import { Component } from 'react'

// Ловит ошибки загрузки/рендера ленивого листа, чтобы падал только он,
// а не весь сайт (иначе — «зелёный экран»).
// Различает два случая:
//   • ChunkLoadError / Failed to fetch dynamically imported module → проблема сети
//   • всё остальное → JS-краш внутри компонента
export default class LazyBoundary extends Component {
  state = { failed: false, isNetworkError: false }

  static getDerivedStateFromError(err) {
    const msg = err?.message || ''
    const isNetworkError =
      /ChunkLoadError/i.test(err?.name) ||
      /Failed to fetch dynamically imported module/i.test(msg) ||
      /Loading chunk \d+ failed/i.test(msg) ||
      /error loading dynamically imported module/i.test(msg)
    return { failed: true, isNetworkError }
  }

  componentDidCatch(err, info) {
    console.error('LazyBoundary caught', err, info)
  }

  retry = () => {
    if (this.state.isNetworkError) {
      window.location.reload()
    } else {
      this.setState({ failed: false, isNetworkError: false })
    }
  }

  render() {
    if (this.state.failed) {
      const { isNetworkError } = this.state
      return (
        <div className="sheet-backdrop" onClick={this.props.onClose}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grabber" />
            <div className="row between" style={{ marginBottom: 18 }}>
              <h2 className="h2">{isNetworkError ? 'Не удалось загрузить' : 'Что-то пошло не так'}</h2>
              <button className="iconbtn" onClick={this.props.onClose} aria-label="Закрыть">✕</button>
            </div>
            <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>
              {isNetworkError
                ? 'Проверьте подключение к интернету и попробуйте снова.'
                : 'Произошла внутренняя ошибка. Попробуйте закрыть и открыть заново.'}
            </p>
            <div className="row gap8">
              <button className="btn" onClick={this.retry}>
                {isNetworkError ? 'Обновить' : 'Попробовать снова'}
              </button>
              <button className="btn ghost" onClick={this.props.onClose}>Закрыть</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
