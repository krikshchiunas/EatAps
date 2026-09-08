// Вложение личной переписки: фото, видео, голосовое.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ ССЫЛКА ЗАПРАШИВАЕТСЯ, А НЕ ЛЕЖИТ В СООБЩЕНИИ
//
// Бакет dm-media ЗАКРЫТ, в отличие от chat-images и post-images. Постоянного
// публичного адреса у вложения нет вовсе — есть путь в хранилище, и по нему
// участник диалога получает подписанную ссылку на час. Хранить готовый URL в
// сообщении значило бы сделать его вечным: у кого он однажды оказался, тот
// открывал бы файл и после блокировки, и после выхода из группы.
//
// Отсюда состояние загрузки прямо в пузыре: ссылка приезжает отдельным
// запросом, и пока её нет, показывать нечего.
//
// ─────────────────────────────────────────────────────────────────────────────
// «ПОСМОТРЕТЬ ОДИН РАЗ» — ЧЕСТНО О ТОМ, ЧТО ЭТО ЗНАЧИТ
//
// После просмотра сервер перестаёт выдавать ссылку. Но веб-клиент физически
// не может помешать снять скриншот или сохранить кадр, и обещать этого мы не
// будем: в подписи прямо сказано, что это удобство, а не защита.
import { useState, useEffect, useRef } from 'react'
import { mediaUrl, markMediaViewed } from '../../lib/messaging.js'

export default function MediaBubble({ media, messageId, viewed, mine, onLoad, onOpen }) {
  const [url, setUrl] = useState(null)
  const [state, setState] = useState('idle') // idle | loading | ready | error | spent
  const [revealed, setRevealed] = useState(false)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false }, [])

  const viewOnce = media?.mode === 'view_once'
  // Отправитель своё одноразовое видит всегда: он его и послал. Спрятано оно
  // от получателя, и только после просмотра.
  const spent = viewOnce && viewed && !mine

  const fetchUrl = async () => {
    if (state === 'loading' || url) return
    setState('loading')
    // Локальное превью (ещё не отправлено) уже лежит готовым blob-адресом.
    if (media?.localUrl) { setUrl(media.localUrl); setState('ready'); return }
    const signed = await mediaUrl(media)
    if (!alive.current) return
    if (!signed) { setState('error'); return }
    setUrl(signed)
    setState('ready')
  }

  // Обычное вложение подгружаем сразу — оно часть сообщения. Одноразовое —
  // только по явному нажатию: иначе «посмотреть один раз» тратилось бы
  // прокруткой мимо.
  useEffect(() => {
    if (!viewOnce && !spent) fetchUrl()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [media?.path])

  const reveal = async () => {
    setRevealed(true)
    await fetchUrl()
    if (!mine) markMediaViewed(messageId)
  }

  if (spent && !revealed) {
    return (
      <div className="msg-media spent">
        <span>Просмотрено</span>
      </div>
    )
  }

  if (viewOnce && !revealed) {
    return (
      <button className="msg-media once" onClick={reveal}>
        <span>👁 Посмотреть один раз</span>
        <span className="msg-media-note">После просмотра исчезнет</span>
      </button>
    )
  }

  if (state === 'loading' || state === 'idle') {
    return <div className="msg-media loading" aria-label="Загружаем вложение" />
  }

  if (state === 'error') {
    return (
      <button className="msg-media error" onClick={() => { setState('idle'); fetchUrl() }}>
        Не удалось открыть вложение. Повторить
      </button>
    )
  }

  if (media.kind === 'video') {
    return (
      <video
        className="msg-img"
        src={url}
        controls
        playsInline
        preload="metadata"
        onLoadedMetadata={onLoad}
        style={{ maxWidth: '100%', borderRadius: 14, display: 'block' }}
      />
    )
  }

  if (media.kind === 'audio') {
    return (
      <audio className="msg-audio" src={url} controls preload="metadata" style={{ width: 220, maxWidth: '100%' }} />
    )
  }

  return (
    <button
      className="msg-img-wrap"
      onClick={() => onOpen?.({ url, kind: media.kind })}
      style={{ display: 'block', background: 'none', border: 0, padding: 0 }}
    >
      <img src={url} alt="" className="msg-img" onLoad={onLoad} draggable={false} />
    </button>
  )
}
