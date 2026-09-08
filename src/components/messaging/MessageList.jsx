// Лента сообщений: разделители дней, пузыри, реакции, вложения.
//
// Вынесена из ChatView отдельным файлом вместе с MessageRow и ReactionBadge:
// в одном файле с контейнером они занимали треть его длины, а меняются по
// другим поводам — контейнер про загрузку и жесты, эти про отрисовку.
//
// ─────────────────────────────────────────────────────────────────────────────
// ЧТО ЗДЕСЬ ЗНАЕТ ПРО ГРУППЫ
//
// В личном диалоге отправитель очевиден по стороне пузыря. В групповом — нет,
// и без имени над сообщением лента превращается в поток реплик без авторов.
// Имя рисуется только у чужого сообщения и только у первого в серии: подряд
// идущие реплики одного человека подписывать по разу достаточно.
import { useState, useEffect, useRef, memo } from 'react'
import { normalizeMealCard } from '../../lib/mealCard.js'
import { timeShort, isSameDay, dayLabel } from '../../lib/chatFormat.js'
import { Avatar } from '../Avatar.jsx'
import MediaBubble from './MediaBubble.jsx'

const REDUCED_MOTION = typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Ссылки в тексте → кликабельные, остальное — как есть.
// split по глобальному regex, а проверка — отдельным НЕ-глобальным (без бага lastIndex).
function renderText(text) {
  return text.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noreferrer" className="msg-link" onClick={(e) => e.stopPropagation()}>{p}</a>
      : <span key={i}>{p}</span>
  )
}

const MessageList = memo(function MessageList({
  messages, myId, isGroup, peopleById, onQuoteTap, onImgLoad, onRetry, onOpenMeal, onOpenMedia,
}) {
  return messages.map((m, i) => {
    const mine = m.sender === myId
    const prev = messages[i - 1]
    const next = messages[i + 1]
    const showDay = !prev || !isSameDay(prev.created_at, m.created_at)
    const sameAsPrev = prev && prev.sender === m.sender && !showDay
    const sameAsNext = next && next.sender === m.sender && isSameDay(m.created_at, next.created_at)
    const author = peopleById?.[m.sender]
    return (
      <div key={m.id}>
        {showDay && <div className="chat-day">{dayLabel(m.created_at)}</div>}
        <MessageRow
          m={m} mine={mine} tail={!sameAsNext} grouped={sameAsPrev}
          isGroup={isGroup} author={author}
          onQuoteTap={onQuoteTap} onImgLoad={onImgLoad}
          onRetry={onRetry} onOpenMeal={onOpenMeal} onOpenMedia={onOpenMedia}
        />
      </div>
    )
  })
})

export default MessageList

// Индикатор доставки/прочтения — вилка. Серая = отправлено, морская синяя =
// собеседник прочитал. Цвет задаётся через currentColor в CSS (.msg-tick.read).
export function ForkTick() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
         strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 2.5v6.2" />
      <path d="M11 2.5v6.2" />
      <path d="M15 2.5v6.2" />
      <path d="M5.4 8.7h11.2a1 1 0 0 1 .9 1.4c-.7 1.6-2.1 2.6-3.8 2.8l-1 .1v8a1.6 1.6 0 0 1-3.2 0v-8l-1-.1c-1.7-.2-3.1-1.2-3.8-2.8a1 1 0 0 1 .9-1.4z" />
    </svg>
  )
}

// «Печатает…» — отдельный пузырь в конце ленты, стилизован под сообщение
// собеседника, чтобы не выбиваться из потока.
export function TypingBubble({ name }) {
  return (
    <div className="msg-row theirs typing-row">
      <div className="msg theirs tail typing-bubble">
        <span className="typing-name">{name} печатает</span>
        <span className="typing-dots" aria-hidden><i /><i /><i /></span>
      </div>
    </div>
  )
}

// Карточка приёма пищи внутри пузыря. Формат один — v2; записи старого формата
// поднимаются нормализатором, поэтому отдельной ветки отрисовки больше нет.
export function MealRefCard({ meal: raw, onOpen }) {
  const meal = normalizeMealCard(raw)
  if (!meal) return null
  const items = meal.items || []
  const shown = items.slice(0, 3)
  const rest = items.length - shown.length
  // У поднятых старых записей макросов нет — строку БЖУ тогда не рисуем,
  // иначе вместо чисел было бы «null Б».
  const hasMacros = meal.protein != null || meal.fat != null || meal.carbs != null
  // Там же единственный продукт совпадает с заголовком — список из одной
  // строки, дублирующей название, выглядел бы ошибкой.
  const listRedundant = items.length === 1 && items[0].name === meal.label
  return (
    <button className="mealcard" onClick={() => onOpen?.(meal)}>
      <div className="mealcard-head">
        <span className="mealcard-emoji">{meal.emoji || '🍽'}</span>
        <span className="mealcard-title">
          <span className="mealcard-label">{meal.label}</span>
          <span className="mealcard-when">{meal.date ? dayLabel(meal.date + 'T12:00:00') : ''}</span>
        </span>
        <span className="mealcard-kcal">{meal.kcal}<span className="mealcard-kcal-u">ккал</span></span>
      </div>

      {!listRedundant && (
        <ul className="mealcard-items">
          {shown.map((it, i) => (
            <li key={i}>
              <span className="mealcard-item-name">{it.emoji ? it.emoji + ' ' : ''}{it.name}</span>
              {it.grams ? <span className="mealcard-item-g">{it.grams} {it.unit || 'г'}</span> : null}
            </li>
          ))}
          {rest > 0 && <li className="mealcard-more">и ещё {rest}</li>}
        </ul>
      )}

      {hasMacros && (
        <div className="mealcard-macros">
          <span><b>{meal.protein}</b> Б</span>
          <span><b>{meal.fat}</b> Ж</span>
          <span><b>{meal.carbs}</b> У</span>
        </div>
      )}
    </button>
  )
}

// Реакции здесь нет намеренно: и двойной тап, и двойной клик считает один
// делегированный обработчик на списке (см. ChatScreen). Собственный
// onDoubleClick на пузыре означал бы два независимых пути к одному действию —
// на телефоне они срабатывали оба и гасили друг друга.
export function MessageRow({
  m, mine, tail, grouped, isGroup, author,
  onQuoteTap, onImgLoad, onRetry, onOpenMeal, onOpenMedia,
}) {
  const status = m.status // sending | failed | undefined(=sent)
  const unsent = Boolean(m.unsent_at || m.unsent)

  return (
    <div className={`msg-row ${mine ? 'mine' : 'theirs'}${grouped ? ' grouped' : ''}`} data-mid={m.id}>
      <span className="msg-action-hint" aria-hidden>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
          <circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="18" cy="12" r="1.8" />
        </svg>
      </span>

      {/* Аватар автора в группе — только у чужого и только у последнего в
          серии: у остальных на его месте отступ, иначе лента рябит лицами. */}
      {isGroup && !mine && (
        <span className="msg-avatar" aria-hidden>
          {tail ? <Avatar src={author?.avatar_url} name={author?.display_name || author?.username} size={26} /> : null}
        </span>
      )}

      <div className={`msg ${mine ? 'mine' : 'theirs'}${tail ? ' tail' : ''}${unsent ? ' unsent' : ''}`}>
        {isGroup && !mine && !grouped && (
          <div className="msg-author">{author?.display_name || author?.username || 'Участник'}</div>
        )}

        {unsent ? (
          <div className="msg-text" style={{ fontStyle: 'italic', opacity: 0.7 }}>Сообщение удалено</div>
        ) : (
          <>
            {m.forwarded_name && (
              <div className="msg-forward">Переслано от {m.forwarded_name}</div>
            )}
            {m.reply_snapshot && (
              <button className="msg-quote" onClick={() => m.reply_to && onQuoteTap(m.reply_to)}>
                <span className="msg-quote-name">{m.reply_snapshot.name}</span>
                <span className="msg-quote-text">{m.reply_snapshot.image ? '📷 ' : ''}{m.reply_snapshot.text || 'Фото'}</span>
              </button>
            )}
            {m.meal_ref && <MealRefCard meal={m.meal_ref} onOpen={onOpenMeal} />}
            {/* Открытие блокируем, только пока фото не на сервере: при 'sending'
                в href лежит blob:, при 'failed' грузить нечего. */}
            {m.image_url && (
              <a href={m.image_url} target="_blank" rel="noreferrer" className="msg-img-wrap"
                 onClick={(e) => { if (status === 'sending' || status === 'failed') e.preventDefault() }}>
                <img src={m.image_url} alt="" className="msg-img" onLoad={onImgLoad} draggable={false} />
              </a>
            )}
            {m.media && (
              <MediaBubble
                media={m.media}
                messageId={m.id}
                viewed={m.media_viewed}
                mine={mine}
                onLoad={onImgLoad}
                onOpen={onOpenMedia}
              />
            )}
            {m.text && <div className="msg-text">{renderText(m.text)}</div>}
          </>
        )}

        <div className="msg-meta">
          <span className="msg-time">{timeShort(m.created_at)}</span>
          {mine && status === 'sending' && <span className="msg-tick sending"><ForkTick /></span>}
          {/* Доставленным считаем и status: undefined (пришло с сервера), и
              'sent' (только что отправили). */}
          {mine && (!status || status === 'sent') && (
            <span className={`msg-tick${m.read_at ? ' read' : ''}`} title={m.read_at ? 'Прочитано' : 'Отправлено'}>
              <ForkTick />
            </span>
          )}
          {mine && status === 'failed' && (
            <button className="msg-fail" onClick={() => onRetry(m)} title="Повторить">! повторить</button>
          )}
        </div>
        {!unsent && <ReactionBadge reactions={m.reactions} />}
      </div>
    </div>
  )
}

// Реакции на сообщении — бейдж у нижнего угла пузыря.
//
// Появление и исчезновение анимированы CSS-transition (плавный «поп»), а не
// keyframes на маунт: React не умеет анимировать удаление узла из DOM сам по
// себе, поэтому бейдж остаётся смонтированным ещё 260мс после того, как
// реакция снята — ровно на время transition, — и только потом пропадает
// по-настоящему. Отсюда mounted (то, что реально в DOM) отдельно от show
// (то, что видно).
//
// Эмодзи теперь несколько, поэтому показываем НАБОР разных (до трёх) и общее
// число. Реакция у человека по-прежнему одна: ключ — его id, значение —
// эмодзи, и вторая реакция того же человека заменяет первую.
export function ReactionBadge({ reactions }) {
  const entries = reactions ? Object.values(reactions) : []
  const count = entries.length
  const active = count > 0
  const [mounted, setMounted] = useState(active)
  const [show, setShow] = useState(active && REDUCED_MOTION)
  const unmountTimer = useRef(null)
  const frames = useRef([])

  useEffect(() => {
    clearTimeout(unmountTimer.current)
    frames.current.forEach(cancelAnimationFrame)
    frames.current = []

    if (REDUCED_MOTION) {
      setMounted(active)
      setShow(active)
      return
    }

    if (active) {
      setMounted(true)
      // Два кадра: сначала элемент должен попасть в DOM со стартовыми
      // стилями (scale 0, opacity 0), и только потом получить класс .show —
      // иначе браузер применит конечное состояние сразу, без перехода.
      const f1 = requestAnimationFrame(() => {
        const f2 = requestAnimationFrame(() => setShow(true))
        frames.current.push(f2)
      })
      frames.current.push(f1)
    } else {
      setShow(false)
      unmountTimer.current = setTimeout(() => setMounted(false), 260)
    }

    return () => {
      clearTimeout(unmountTimer.current)
      frames.current.forEach(cancelAnimationFrame)
    }
  }, [active])

  if (!mounted) return null
  const distinct = [...new Set(entries)].slice(0, 3)
  return (
    <span className={`msg-reaction${show ? ' show' : ''}`} aria-hidden>
      {distinct.join('')}
      {count > 1 && <b>{count}</b>}
    </span>
  )
}
