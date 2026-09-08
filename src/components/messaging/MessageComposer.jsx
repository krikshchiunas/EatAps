// Строка ввода: текст, вложения, ответ, «печатает…».
//
// Изолирована от списка сообщений намеренно: набор текста меняет состояние
// composer'а десятки раз в секунду, и если бы он жил в контейнере, лента
// перерисовывалась бы на каждую букву.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ДОБАВИЛОСЬ К ФОТО
//
// Видео и голосовое. Оба уходят в ЗАКРЫТЫЙ бакет dm-media, в отличие от фото
// из старой переписки (chat-images, публичный на чтение). Разница не
// косметическая: у публичного бакета границей доступа служит незнание адреса,
// а у закрытого — членство в диалоге, которое проверяет политика хранилища.
//
// Голосовое пишется MediaRecorder'ом. Он есть не везде (старый iOS Safari без
// разрешения на микрофон, встроенные вебвью), поэтому кнопка появляется
// ТОЛЬКО когда запись действительно возможна: кнопка, которая ничего не
// делает, хуже её отсутствия.
import { useState, useEffect, useRef, useCallback } from 'react'

const COARSE = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

// Запись голосового доступна не во всяком браузере и не без разрешения.
const CAN_RECORD = typeof window !== 'undefined'
  && typeof window.MediaRecorder !== 'undefined'
  && Boolean(navigator.mediaDevices?.getUserMedia)

export default function MessageComposer({
  reply, onCancelReply, onSend, onPickMeal, onTyping, disabled = false, disabledNote = null,
}) {
  const [text, setText] = useState('')
  // Одно вложение на сообщение: { url, file, kind, mode }. Несколько картинок
  // разом — это уже галерея, а её в переписке нет, и делать вид, что есть,
  // нельзя.
  const [photo, setPhoto] = useState(null)
  const [recording, setRecording] = useState(false)
  const [err, setErr] = useState(null)
  const taRef = useRef(null)
  const fileRef = useRef(null)
  const recRef = useRef(null)

  // Троттлим «печатает»: шлём не чаще раза в 2с, гасим через 2.5с тишины.
  // Иначе на каждый символ уходил бы бродкаст.
  const typingRef = useRef({ lastSent: 0, stopTimer: null, active: false })
  const pingTyping = useCallback(() => {
    const t = typingRef.current
    const now = Date.now()
    if (!t.active || now - t.lastSent > 2000) {
      t.active = true
      t.lastSent = now
      onTyping?.(true)
    }
    clearTimeout(t.stopTimer)
    t.stopTimer = setTimeout(() => { t.active = false; onTyping?.(false) }, 2500)
  }, [onTyping])

  const stopTyping = useCallback(() => {
    const t = typingRef.current
    clearTimeout(t.stopTimer)
    if (t.active) { t.active = false; onTyping?.(false) }
  }, [onTyping])

  // Гасим ТОЛЬКО при реальном размонтировании. Зависимость от stopTyping
  // заставляла cleanup срабатывать на каждый рендер и слать ложное
  // «перестал печатать» — из-за этого лента тряслась.
  const stopRef = useRef(stopTyping)
  stopRef.current = stopTyping
  useEffect(() => () => stopRef.current(), [])

  // Прикреплённое, но не отправленное фото: превью освобождается при отправке и
  // по крестику, но не при закрытии чата — тогда blob оставался висеть.
  const photoRef = useRef(photo)
  photoRef.current = photo
  useEffect(() => () => { if (photoRef.current?.url) URL.revokeObjectURL(photoRef.current.url) }, [])

  const grow = () => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }
  useEffect(grow, [text])

  const canSend = text.trim().length > 0 || !!photo

  const submit = () => {
    if (!canSend) return
    stopTyping()
    onSend({ text: text.trim(), file: photo?.file || null, kind: photo?.kind || 'image', mode: photo?.mode || 'keep' })
    setText('')
    if (photo?.url) URL.revokeObjectURL(photo.url)
    setPhoto(null)
    requestAnimationFrame(grow)
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !COARSE) { e.preventDefault(); submit() }
  }
  const onFile = (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const kind = f.type?.startsWith('video/') ? 'video'
      : f.type?.startsWith('audio/') ? 'audio'
      : f.type?.startsWith('image/') ? 'image' : null
    if (!kind) { setErr('Можно отправить фото, видео или звук'); return }
    // Потолок тот же, что у бакета: отказ на сервере после долгой загрузки
    // хуже, чем отказ сразу.
    if (f.size > 25 * 1024 * 1024) { setErr('Файл больше 25 МБ'); return }
    setErr(null)
    if (photo?.url) URL.revokeObjectURL(photo.url)
    setPhoto({ url: URL.createObjectURL(f), file: f, kind, mode: 'keep' })
  }

  // Голосовое. Запись останавливается по повторному нажатию и превращается в
  // обычное вложение — отдельного пути отправки у неё нет.
  const toggleRecord = async () => {
    if (recording) {
      recRef.current?.stop()
      return
    }
    setErr(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const chunks = []
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data) }
      rec.onstop = () => {
        for (const t of stream.getTracks()) t.stop()
        setRecording(false)
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
        if (!blob.size) return
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type })
        if (photoRef.current?.url) URL.revokeObjectURL(photoRef.current.url)
        setPhoto({ url: URL.createObjectURL(file), file, kind: 'audio', mode: 'keep' })
      }
      recRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      setErr('Нет доступа к микрофону')
    }
  }

  // Запись не должна пережить закрытие чата: микрофон остался бы включённым.
  useEffect(() => () => { try { recRef.current?.stop() } catch {} }, [])

  if (disabled) {
    return (
      <div className="chat-composer">
        <p className="chat-composer-note">{disabledNote || 'Писать в этот диалог нельзя.'}</p>
      </div>
    )
  }

  return (
    <div className="chat-composer">
      {reply && (
        <div className="chat-replybar">
          <span className="chat-replybar-line" />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="chat-replybar-name">Ответ · {reply.snapshot.name}</div>
            <div className="chat-replybar-text">{reply.snapshot.image ? '📷 ' : ''}{reply.snapshot.text || 'Фото'}</div>
          </div>
          <button className="chat-replybar-x" onClick={onCancelReply} aria-label="Отменить">✕</button>
        </div>
      )}
      {photo && (
        <div className="chat-photo-preview">
          {photo.kind === 'image' && <img src={photo.url} alt="" />}
          {photo.kind === 'video' && <video src={photo.url} muted playsInline />}
          {photo.kind === 'audio' && <audio src={photo.url} controls />}
          <button onClick={() => { URL.revokeObjectURL(photo.url); setPhoto(null) }} aria-label="Убрать вложение">✕</button>
          {photo.kind !== 'audio' && (
            <button
              className={`chat-once${photo.mode === 'view_once' ? ' on' : ''}`}
              aria-pressed={photo.mode === 'view_once'}
              onClick={() => setPhoto((p) => ({ ...p, mode: p.mode === 'view_once' ? 'keep' : 'view_once' }))}
              /* Честная подпись: сервер перестанет отдавать файл после
                 просмотра, но помешать снять скриншот веб-клиент не может. */
              title="После просмотра сервер перестанет отдавать файл. От скриншота это не защищает."
            >
              👁 Один раз
            </button>
          )}
        </div>
      )}
      {err && <div className="chat-composer-err" role="alert">{err}</div>}
      {/* Поле-«пилюля»: кнопки вложений живут ВНУТРИ него — так добавление
          новых (приём пищи, файл, голосовое) не ломает раскладку строки. */}
      <div className="chat-composer-row">
        <div className="chat-inputwrap">
          <div className="chat-tools">
            <button className="chat-tool" onClick={() => fileRef.current?.click()} aria-label="Отправить фото">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="15" rx="3.5" /><circle cx="12" cy="12.5" r="3.4" /><path d="M8 5 9.4 3h5.2L16 5" />
              </svg>
            </button>
            {CAN_RECORD && (
              <button
                className={`chat-tool${recording ? ' rec' : ''}`}
                onClick={toggleRecord}
                aria-label={recording ? 'Остановить запись' : 'Записать голосовое'}
                aria-pressed={recording}
              >
                <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0 M12 18v3" />
                </svg>
              </button>
            )}
            <button className="chat-tool" onClick={onPickMeal} aria-label="Отправить приём пищи">
              <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 3v7.2a2.2 2.2 0 0 0 4.4 0V3" /><path d="M7.2 10.4V21" />
                <path d="M16.5 3c-1.4 1.6-2 3.6-2 5.6 0 1.7.7 3 2 3.4V21" />
              </svg>
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*,video/*,audio/*" onChange={onFile} style={{ display: 'none' }} />
          <textarea
            ref={taRef}
            className="chat-textarea"
            placeholder="Сообщение…"
            value={text}
            rows={1}
            onChange={(e) => { setText(e.target.value); if (e.target.value.trim()) pingTyping(); else stopTyping() }}
            onKeyDown={onKey}
            onBlur={stopTyping}
          />
        </div>
        <button className={`chat-send${canSend ? ' on' : ''}`} onClick={submit} disabled={!canSend} aria-label="Отправить">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="currentColor"><path d="M3.4 20.4l17.6-8.4a.5.5 0 0 0 0-.9L3.4 3.6a.5.5 0 0 0-.7.6l2.3 6.9c.1.2.3.4.5.4l8.9 1.5-8.9 1.5c-.2 0-.4.2-.5.4l-2.3 6.9a.5.5 0 0 0 .7.6z" /></svg>
        </button>
      </div>
    </div>
  )
}

