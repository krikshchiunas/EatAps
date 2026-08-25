// ─────────────────────────────────────────────────────────────────────────────
// Экран AI-ассистента: диалог, распознавание фото и карточки еды.
//
// Три решения, которые видно в коде:
//
//   • Переписка НЕ хранится и не синхронизируется. Она живёт в стейте экрана и
//     исчезает с перезагрузкой. Дневник и так на устройстве; заводить вторую
//     копию личных данных ради истории чата — плохой размен.
//   • Ассистент ничего не пишет в дневник сам. Он присылает карточку, кнопку
//     «Добавить» нажимает человек. Ошибка распознавания должна стоить
//     отказа от нажатия, а не разбора чужих записей в дневнике.
//   • Остаток бюджета показываем всегда, а не в момент отказа. «Осталось 12%»
//     заранее — это информация; «лимит исчерпан» без предупреждения — обман.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../store.jsx'
import { hasAIPlus } from '../lib/subscription.js'
import { sendChat, sendPhoto, fileToImage, AIError } from '../lib/aiClient.js'
import { buildContext } from '../lib/aiContext.js'
import { resolveTone } from '../lib/aiPrompt.js'
import { usedShare, resetsAt, budgetForTier, periodKey } from '../lib/aiBudget.js'
import { pullAiUsage } from '../lib/supabase.js'
import { keyOf } from '../lib/date.js'
import { autoStandardMealId } from '../lib/meals.js'

const haptic = (ms = 12) => { try { navigator.vibrate?.(ms) } catch {} }

const GREETING = {
  calm: 'Привет, я Carrot 🥕. Сфотографируйте тарелку или спросите что угодно про еду и ваши цели.',
  coach: 'Я Carrot 🥕, на связи. Кидайте фото еды или спрашивайте — разберём, что сегодня доедаем.',
  strict: 'Carrot на месте. Фото тарелки или вопрос — считаю по вашему дневнику, без скидок.',
  savage: 'Carrot тут. Ну что, показывай, что там сожрал. Или спрашивай, раз ещё не поздно.',
}

export default function AIHomeScreen({ onUpgrade }) {
  const store = useStore()
  const { subscription, session, prefs, addFood, user, supabaseEnabled } = store
  const signedIn = !!user
  const plus = hasAIPlus(subscription)
  const tier = subscription?.tier || 'FREE'
  const tone = resolveTone(prefs).id

  const [messages, setMessages] = useState([
    { role: 'assistant', text: GREETING[tone] || GREETING.calm, local: true },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [budget, setBudget] = useState(null) // { spentMicro, budgetMicro, remainingMicro }
  const [exhausted, setExhausted] = useState(false)

  // Остаток подтягиваем при открытии вкладки: до первого ответа сервер о нём
  // не расскажет, а знать «лимит кончился» человек должен ДО того, как напишет.
  useEffect(() => {
    let alive = true
    const uid = session?.user?.id
    if (!uid) return
    const cap = budgetForTier(tier)
    if (cap === null) return
    pullAiUsage(uid, periodKey()).then((spent) => {
      if (!alive) return
      setBudget({ spentMicro: spent, budgetMicro: cap, remainingMicro: Math.max(0, cap - spent) })
      if (spent >= cap) setExhausted(true)
    })
    return () => { alive = false }
  }, [session, tier])

  const fileRef = useRef(null)
  const feedRef = useRef(null)
  const inputRef = useRef(null)

  // Автопрокрутка к последнему сообщению — включая момент, когда появляется
  // индикатор «печатает»: иначе ответ приходит за кадром.
  useEffect(() => {
    const el = feedRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const context = useCallback(
    () => buildContext(store, { tier, dateKey: keyOf(), memory: prefs?.aiMemory || [] }),
    [store, tier, prefs],
  )

  // Общий хвост для чата и фото: разложить ответ, обновить бюджет, показать ошибку.
  const applyAnswer = useCallback((data) => {
    setBudget(data.usage || null)
    setMessages((m) => [
      ...m,
      {
        role: 'assistant',
        text: data.ask || data.reply,
        cards: data.cards?.length ? data.cards : undefined,
        asking: !!data.ask,
      },
    ])
    // Долгую память копим только на AI+ — на других тарифах сервер её и не присылает.
    if (data.memory && plus) {
      const prev = prefs?.aiMemory || []
      if (!prev.includes(data.memory)) store.setPref('aiMemory', [...prev, data.memory].slice(-40))
    }
  }, [plus, prefs, store])

  const handleFailure = useCallback((e) => {
    if (e instanceof AIError && e.isBudget) { setExhausted(true); return }
    setError(e.message || 'Не получилось. Попробуйте ещё раз.')
  }, [])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    haptic()
    setError(null)
    setInput('')

    const history = [...messages, { role: 'user', text }]
    setMessages(history)
    setBusy(true)
    try {
      const data = await sendChat({
        // local — приветствие и служебные плашки: платить за них токенами незачем.
        history: history.filter((m) => !m.local).map(({ role, text }) => ({ role, text })),
        context: context(),
        prefs,
        session,
      })
      applyAnswer(data)
    } catch (e) {
      handleFailure(e)
    }
    setBusy(false)
  }

  const pickPhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = '' // тот же файл можно выбрать повторно
    if (!file || busy) return
    haptic()
    setError(null)
    setBusy(true)
    try {
      const image = await fileToImage(file)
      setMessages((m) => [...m, { role: 'user', text: 'Фото еды', photo: image.preview }])
      const data = await sendPhoto({
        image: { media_type: image.media_type, data: image.data },
        note: input.trim() || undefined,
        context: context(),
        prefs,
        session,
      })
      setInput('')
      applyAnswer(data)
    } catch (e) {
      handleFailure(e)
    }
    setBusy(false)
  }

  // Карточка → запись в дневнике. Приём пищи берём из карточки, а если модель
  // его не указала — по времени суток, как при обычном добавлении руками.
  const addCard = (card, msgIndex, cardIndex) => {
    const date = keyOf()
    const day = store.days?.[date]
    haptic(18)
    addFood(date, {
      name: String(card.name || 'Блюдо').slice(0, 80),
      emoji: '🍽️',
      unit: 'г',
      grams: Number(card.grams) || null,
      kcal: Math.max(0, Math.round(Number(card.kcal) || 0)),
      protein: Math.max(0, Math.round(Number(card.protein) || 0)),
      fat: Math.max(0, Math.round(Number(card.fat) || 0)),
      carbs: Math.max(0, Math.round(Number(card.carbs) || 0)),
      type: MEAL_TYPES.includes(card.meal) ? card.meal : undefined,
      mealId: MEAL_TYPES.includes(card.meal) ? `std:${card.meal}` : autoStandardMealId(day),
    })
    setMessages((m) => m.map((msg, i) => (
      i === msgIndex ? { ...msg, added: { ...(msg.added || {}), [cardIndex]: true } } : msg
    )))
  }

  if (exhausted) return <Exhausted tier={tier} onUpgrade={onUpgrade} />

  const share = budget ? usedShare(tier, budget.spentMicro) : 0

  return (
    <div className="screen ai-chat">
      <div className="ai-chat__top">
        {/* Значок тарифа — он же вход на экран тарифов и ввода промокода.
            Отдельной кнопки «купить» тут нет намеренно: экран про еду, а не
            про продажи. Но и совсем без входа нельзя — до этой правки попасть
            на тарифы можно было, только исчерпав лимит, то есть промокод было
            некуда ввести. */}
        {plus ? (
          <div className="ai-badge ai-badge--plus">AI+ · умнее</div>
        ) : (
          <button className="ai-badge ai-badge--action" onClick={onUpgrade} title="Тарифы и промокод">
            {tier === 'AI' ? 'AI' : 'FREE'}
          </button>
        )}
        {budget?.budgetMicro
          ? <BudgetBar share={share} onUpgrade={plus ? null : onUpgrade} />
          : plus ? <span className="ai-chat__unlimited">без лимита</span> : null}
      </div>

      <div className="ai-chat__feed" ref={feedRef}>
        {supabaseEnabled && !signedIn && (
          <div className="ai-notice" role="status">
            Войдите в аккаунт — ассистенту нужен доступ к вашему дневнику и тарифу.
          </div>
        )}
        {messages.map((m, i) => (
          <Bubble
            key={i}
            msg={m}
            onAdd={(card, cardIndex) => addCard(card, i, cardIndex)}
          />
        ))}
        {busy && <div className="ai-bubble ai-bubble--ai ai-typing"><span /><span /><span /></div>}
        {error && <div className="ai-error" role="alert">{error}</div>}
      </div>

      <div className="ai-chat__composer">
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={pickPhoto} />
        <button
          className="iconbtn ai-chat__camera"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label="Сфотографировать еду"
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <textarea
          ref={inputRef}
          className="ai-chat__input"
          value={input}
          rows={1}
          placeholder="Спросите про еду…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
          }}
          disabled={busy}
        />
        <button className="btn ai-chat__send" onClick={send} disabled={busy || !input.trim()} aria-label="Отправить">
          ↑
        </button>
      </div>
    </div>
  )
}

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

function Bubble({ msg, onAdd }) {
  const mine = msg.role === 'user'
  return (
    <div className={`ai-bubble ${mine ? 'ai-bubble--me' : 'ai-bubble--ai'}`}>
      {msg.photo && <img className="ai-bubble__photo" src={msg.photo} alt="" />}
      {msg.text && <p className="ai-bubble__text">{msg.text}</p>}
      {msg.cards?.map((card, i) => (
        <MealCard
          key={i}
          card={card}
          added={!!msg.added?.[i]}
          onAdd={() => onAdd(card, i)}
        />
      ))}
    </div>
  )
}

const CONFIDENCE = { high: null, medium: 'примерно', low: 'на глаз' }

function MealCard({ card, added, onAdd }) {
  const hint = CONFIDENCE[card.confidence]
  return (
    <div className="ai-card">
      <div className="ai-card__head">
        <span className="ai-card__name">{card.name}</span>
        {card.grams ? <span className="ai-card__grams">{Math.round(card.grams)} г</span> : null}
      </div>
      <div className="ai-card__macros">
        <b>{Math.round(card.kcal)}</b> ккал · Б {Math.round(card.protein)} · Ж {Math.round(card.fat)} · У {Math.round(card.carbs)}
        {hint && <span className="ai-card__conf"> · {hint}</span>}
      </div>
      <button className={`btn ${added ? 'soft' : ''} ai-card__add`} onClick={onAdd} disabled={added}>
        {added ? 'Добавлено ✓' : 'Добавить в дневник'}
      </button>
    </div>
  )
}

// Полоса остатка. На последней четверти превращается в кнопку апгрейда:
// это ровно тот момент, когда предложение уместно, а не назойливо.
function BudgetBar({ share, onUpgrade }) {
  const pct = Math.round(share * 100)
  const low = pct >= 75
  const bar = (
    <>
      <div className="ai-budget__track">
        <div className="ai-budget__fill" style={{ width: `${pct}%`, background: pct > 85 ? 'var(--danger)' : 'var(--primary)' }} />
      </div>
      <span className="ai-budget__label">{low && onUpgrade ? 'ещё' : `${100 - pct}%`}</span>
    </>
  )
  if (low && onUpgrade) {
    return (
      <button className="ai-budget ai-budget--action" onClick={onUpgrade} title={`Израсходовано ${pct}% месячного лимита`}>
        {bar}
      </button>
    )
  }
  return <div className="ai-budget" title={`Израсходовано ${pct}% месячного лимита`}>{bar}</div>
}

// Лимит кончился. Показываем дату обнуления — без неё экран читается как
// «всё, конец», хотя на самом деле это до первого числа.
function Exhausted({ tier, onUpgrade }) {
  const reset = resetsAt().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
  const free = tier === 'FREE'
  return (
    <div className="screen ai-home">
      <div className="ai-home__stage">
        <div className="ai-home__orb" aria-hidden>
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </div>
        <h1 className="h1 ai-home__title">Лимит на месяц исчерпан</h1>
        <p className="ai-home__sub">
          {free
            ? 'Бесплатного объёма на этот месяц больше нет. Обновится 1 ' + reset.split(' ')[1] + '.'
            : `Ассистент снова заработает ${reset}.`}
        </p>
        {onUpgrade && (
          <button className="btn" style={{ marginTop: 18 }} onClick={onUpgrade}>
            {free ? 'Посмотреть тарифы' : 'Перейти на AI+ — без лимита'}
          </button>
        )}
      </div>
    </div>
  )
}
