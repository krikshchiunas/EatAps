// Картинка из закрытого бакета.
//
// Бакеты chat-images и post-images больше не публичны, поэтому адрес, лежащий
// в строке сообщения или записи, сам по себе ничего не открывает: по нему
// сначала запрашивается подписанная ссылка, и выдаёт её только тот, кого
// пустила политика хранилища.
//
// Отсюда три состояния вместо простого <img src>: пока подпись в пути —
// показываем место под картинку той же формы (иначе лента дёргалась бы при
// каждой подгрузке), при отказе — молчаливую заглушку. Отказ здесь это не
// сбой, а нормальный ответ: запись могла стать невидимой, диалог — закрыться,
// автор — заблокировать читателя.
import { useEffect, useRef, useState } from 'react'

export default function PrivateImage({
  source, resolve, alt = '', className, style, onLoad, onClick, loading = 'lazy',
}) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  useEffect(() => {
    if (!source) return
    let current = true
    setFailed(false)
    setUrl(null)
    // Локальное превью (файл ещё не отправлен) подписывать нечего и незачем.
    if (source.startsWith('blob:') || source.startsWith('data:')) {
      setUrl(source)
      return
    }
    resolve(source).then((signed) => {
      if (!current || !alive.current) return
      if (signed) setUrl(signed)
      else setFailed(true)
    }).catch(() => {
      if (current && alive.current) setFailed(true)
    })
    return () => { current = false }
  }, [source, resolve])

  if (failed) {
    return (
      <div className={className} style={{ ...style, display: 'grid', placeItems: 'center', background: 'var(--surface-2)', minHeight: 120 }}>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Фото недоступно</span>
      </div>
    )
  }

  if (!url) {
    return <div className={className} style={{ ...style, background: 'var(--surface-2)', minHeight: 120 }} aria-busy="true" />
  }

  const img = (
    <img src={url} alt={alt} className={className} style={style} loading={loading} onLoad={onLoad} draggable={false} />
  )

  if (!onClick) return img
  return (
    <button
      type="button"
      onClick={() => onClick(url)}
      className="msg-img-wrap"
      style={{ display: 'block', background: 'none', border: 0, padding: 0, width: '100%' }}
      aria-label={alt || 'Открыть фото'}
    >
      {img}
    </button>
  )
}
