import { Component } from 'react'

// Ловит ошибки загрузки/рендера ленивого листа, чтобы падал только он,
// а не весь сайт (иначе — «зелёный экран»). Показывает кнопку «Обновить».
export default class LazyBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(err) {
    console.error('LazyBoundary caught', err)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="sheet-backdrop" onClick={this.props.onClose}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="grabber" />
            <div className="row between" style={{ marginBottom: 18 }}>
              <h2 className="h2">Не удалось загрузить</h2>
              <button className="iconbtn" onClick={this.props.onClose} aria-label="Закрыть">✕</button>
            </div>
            <p className="muted" style={{ fontSize: 14, marginBottom: 16 }}>Проверьте подключение к интернету и попробуйте снова.</p>
            <button className="btn" onClick={() => window.location.reload()}>Обновить</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
