// Общие вложения диалога — сетка всего, чем обменялись.
//
// Доступ проверяет сервер (conversation_media отдаёт только участнику), а сами
// файлы лежат в закрытом бакете и открываются подписанной ссылкой. Поэтому
// плитка сначала пустая: адрес приезжает отдельным запросом на каждый файл.
// Грузим порциями по мере прокрутки — сетка на двести фотографий иначе
// запросила бы двести подписей разом.
import { useState, useEffect, useCallback, useRef } from 'react'
import { conversationMedia, mediaUrl } from '../../lib/messaging.js'
import PushScreen from '../PushScreen.jsx'
import { signedChatImage } from '../../lib/supabase.js'

const PAGE = 60

function Tile({ item, onOpen }) {
  // Готового адреса нет ни у нового вложения, ни у старого фото: dm-media и
  // chat-images оба закрыты, и оба открываются подписанной ссылкой.
  const [url, setUrl] = useState(null)
  const ref = useRef(null)

  useEffect(() => {
    if (url) return
    if (!item.media?.path && !item.image_url) return
    let alive = true
    const io = new IntersectionObserver(async (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      const signed = item.media?.path
        ? await mediaUrl(item.media)
        : await signedChatImage(item.image_url)
      if (alive) setUrl(signed)
    }, { rootMargin: '200px' })
    if (ref.current) io.observe(ref.current)
    return () => { alive = false; io.disconnect() }
  }, [item, url])

  const isVideo = item.media?.kind === 'video'
  const isAudio = item.media?.kind === 'audio'

  return (
    <button
      ref={ref}
      onClick={() => url && onOpen({ url, kind: item.media?.kind || 'image' })}
      style={{
        aspectRatio: '1', background: 'var(--surface-2)', borderRadius: 10,
        overflow: 'hidden', border: 0, padding: 0, cursor: url ? 'pointer' : 'default',
        position: 'relative',
      }}
      aria-label={isVideo ? 'Видео' : isAudio ? 'Голосовое сообщение' : 'Фото'}
    >
      {isAudio ? (
        <span style={{ fontSize: 22, display: 'grid', placeItems: 'center', height: '100%' }}>🎤</span>
      ) : url ? (
        isVideo
          ? <video src={url} muted playsInline preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : null}
      {isVideo && (
        <span aria-hidden style={{
          position: 'absolute', right: 6, bottom: 6, fontSize: 12,
          background: 'rgba(0,0,0,0.5)', color: '#fff', borderRadius: 6, padding: '1px 5px',
        }}>▶</span>
      )}
    </button>
  )
}

export default function SharedMedia({ conversationId, onClose }) {
  const [items, setItems] = useState(null)
  const [more, setMore] = useState(false)
  const [viewer, setViewer] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const rows = await conversationMedia(conversationId, { limit: PAGE })
      setItems(rows)
      setMore(rows.length === PAGE)
    } catch (e) { setErr(e.message || 'Не удалось загрузить'); setItems([]) }
  }, [conversationId])

  useEffect(() => { load() }, [load])

  const loadMore = async () => {
    if (!items?.length) return
    try {
      const rows = await conversationMedia(conversationId, { limit: PAGE, offset: items.length })
      setItems([...items, ...rows])
      setMore(rows.length === PAGE)
    } catch (e) { setErr(e.message || 'Не удалось догрузить') }
  }

  return (
    <PushScreen onClose={onClose}>
      {(close) => (
        <div className="screen">
          <div className="row gap8" style={{ alignItems: 'center', marginBottom: 14 }}>
            <button className="iconbtn" onClick={close} aria-label="Назад" style={{ fontSize: 22, flex: '0 0 auto' }}>‹</button>
            <h1 className="h1" style={{ margin: 0, fontSize: 24 }}>Вложения</h1>
          </div>

          {err && <p style={{ fontSize: 13, color: 'var(--danger)', marginBottom: 10 }}>{err}</p>}

          {items === null && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="skel" style={{ aspectRatio: '1', borderRadius: 10 }} />
              ))}
            </div>
          )}

          {items?.length === 0 && !err && (
            <p className="muted" style={{ fontSize: 14, textAlign: 'center', padding: '32px 12px', lineHeight: 1.5 }}>
              В этой переписке пока нет фото, видео и голосовых.
            </p>
          )}

          {items?.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
              {items.map((it) => <Tile key={it.id} item={it} onOpen={setViewer} />)}
            </div>
          )}

          {more && (
            <button className="btn ghost" style={{ width: 'auto', padding: '0 22px', margin: '14px auto 0' }} onClick={loadMore}>
              Показать ещё
            </button>
          )}

          {viewer && (
            <div
              onClick={() => setViewer(null)}
              style={{
                position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.92)',
                display: 'grid', placeItems: 'center', padding: 16,
              }}
              role="dialog"
              aria-label="Просмотр вложения"
            >
              {viewer.kind === 'video'
                ? <video src={viewer.url} controls autoPlay playsInline style={{ maxWidth: '100%', maxHeight: '100%' }} />
                : viewer.kind === 'audio'
                  ? <audio src={viewer.url} controls autoPlay />
                  : <img src={viewer.url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />}
            </div>
          )}
        </div>
      )}
    </PushScreen>
  )
}
