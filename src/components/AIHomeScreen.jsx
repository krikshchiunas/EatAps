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
import { hasAI, hasAIPlus, hasAIPremium, planByTier } from '../lib/subscription.js'
import { sendChat, sendPhoto, fileToImageWithin, PHOTO_PAYLOAD_BUDGET, AIError } from '../lib/aiClient.js'
import { buildContext } from '../lib/aiContext.js'
import { resolveTone } from '../lib/aiPrompt.js'
import { usedShare, budgetForTier, periodKey, maxPhotosForTier, MAX_PHOTOS_ANY } from '../lib/aiBudget.js'
import { pullAiUsage } from '../lib/supabase.js'
import { keyOf } from '../lib/date.js'
import { autoStandardMealId } from '../lib/meals.js'
import { t } from '../lib/i18n.js'

const haptic = (ms = 12) => { try { navigator.vibrate?.(ms) } catch {} }

// Приветствие — первое подтверждение, что тон переключился: человек меняет
// голос в настройках и сразу видит разницу, не отправив ни одного сообщения.
// Текст берётся при показе, а не при создании сообщения: смена языка
// переводит и его.
const greeting = (tone) => t(`ai.greeting.${tone}`)

export default function AIHomeScreen({ onUpgrade }) {
  const store = useStore()
  const { subscription, session, prefs, addFood, user, supabaseEnabled } = store
  const signedIn = !!user
  const plus = hasAIPlus(subscription)
  const premium = hasAIPremium(subscription)
  const tier = subscription?.tier || 'FREE'
  const tone = resolveTone(prefs).id
  // Сколько фото за раз: Free — 1, Carrot+ — 3, Pro — 5, Premium — 10.
  // Неактивная подписка (просрочена, отменена) считается бесплатной — так же
  // решает и сервер, иначе интерфейс разрешил бы то, в чём сервер откажет.
  const maxPhotos = maxPhotosForTier(hasAI(subscription) ? tier : 'FREE')

  const [messages, setMessages] = useState([
    { role: 'assistant', greeting: tone, local: true },
  ])
  const [input, setInput] = useState('')
  // Прикреплённые, но ещё не отправленные фото: [{ id, media_type, data, preview }].
  // Уходят одним запросом вместе с текстом — как в мессенджере.
  const [photos, setPhotos] = useState([])
  const [attaching, setAttaching] = useState(false)
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
  const galleryRef = useRef(null)
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
        // reply и ask — РАЗНЫЕ вещи: первое отвечает на сказанное, второе
        // уточняет недостающее. Раньше здесь стояло `data.ask || data.reply`,
        // и ответ молча пропадал каждый раз, когда ассистент заодно задавал
        // вопрос: на «добавь бутерброд» человек видел голое «С чем именно?»
        // вместо «Бутерброды очень разные. С чем именно?».
        text: data.fallback
          ? t('ai.malformed')
          : [data.reply, data.ask].filter(Boolean).join(' ') || data.reply || data.ask,
        cards: data.cards?.length ? data.cards : undefined,
        asking: !!data.ask,
        // Ответ упёрся в потолок — показываем это, а не выдаём обрывок за
        // законченную мысль.
        truncated: !!data.truncated,
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
    setError(e.message || t('ai.genericError'))
  }, [])

  const send = async () => {
    if (photos.length) return sendPhotos()
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

  // Фото + текст одним сообщением. Текст человека — это и вопрос к модели, и
  // подпись в ленте; без текста подписываем «Фото еды», чтобы следующий вопрос
  // в чате («а сколько там белка?») имел в истории, к чему относиться.
  const sendPhotos = async () => {
    if (busy || !photos.length) return
    const note = input.trim()
    const batch = photos
    haptic()
    setError(null)
    setInput('')
    setPhotos([])
    setMessages((m) => [...m, {
      role: 'user',
      text: note || (batch.length > 1 ? t('ai.photosCount', { n: batch.length }) : t('ai.photoMsg')),
      photos: batch.map((p) => p.preview),
    }])
    setBusy(true)
    try {
      const data = await sendPhoto({
        images: batch.map(({ media_type, data }) => ({ media_type, data })),
        note: note || undefined,
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

  // Камера отдаёт один снимок, галерея — сколько выбрали. Всё складываем в
  // черновик; лишнее сверх лимита тарифа отбрасываем и говорим об этом.
  const attachPhotos = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = '' // тот же файл можно выбрать повторно
    if (!files.length || busy) return
    haptic()
    setError(null)
    const room = maxPhotos - photos.length
    if (room <= 0) { setError(limitText); return }
    setAttaching(true)
    const added = []
    let failed = false
    const share = Math.floor(PHOTO_PAYLOAD_BUDGET / maxPhotos)
    for (const file of files.slice(0, room)) {
      try {
        const image = await fileToImageWithin(file, share)
        added.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, ...image })
      } catch {
        failed = true
      }
    }
    setAttaching(false)
    setPhotos((prev) => [...prev, ...added].slice(0, maxPhotos))
    if (files.length > room) setError(limitText)
    else if (failed) setError(t('ai.photoUnreadable'))
    inputRef.current?.focus()
  }

  // На старших тарифах просто называем предел; на младших — подсказываем,
  // что больше фото есть в тарифах выше.
  const limitText = maxPhotos >= MAX_PHOTOS_ANY
    ? t('ai.maxPhotos', { n: maxPhotos })
    : t('ai.maxPhotosUpgrade', { n: maxPhotos })

  const removePhoto = (id) => {
    haptic()
    setPhotos((prev) => prev.filter((p) => p.id !== id))
  }

  // Карточка → запись в дневнике. Приём пищи берём из карточки, а если модель
  // его не указала — по времени суток, как при обычном добавлении руками.
  const addCard = (card, msgIndex, cardIndex) => {
    const date = keyOf()
    const day = store.days?.[date]
    haptic(18)
    addFood(date, {
      name: String(card.name || t('meal.dish')).slice(0, 80),
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
        {premium ? (
          <div className="ai-badge ai-badge--plus">{planByTier(tier)?.name} · {t('ai.smarter')}</div>
        ) : plus ? (
          <div className="ai-badge ai-badge--plus">{planByTier(tier)?.name} · {t('ai.unlimited')}</div>
        ) : (
          <button className="ai-badge ai-badge--action" onClick={onUpgrade} title={t('ai.plansAndPromo')}>
            {tier === 'AI' ? planByTier(tier)?.name : 'Carrot Free'}
          </button>
        )}
        {budget?.budgetMicro
          ? <BudgetBar share={share} onUpgrade={plus ? null : onUpgrade} />
          : plus ? <span className="ai-chat__unlimited">{t('ai.unlimited')}</span> : null}
      </div>

      <div className="ai-chat__feed" ref={feedRef}>
        {supabaseEnabled && !signedIn && (
          <div className="ai-notice" role="status">
            {t('ai.signInNotice')}
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
        {photos.length > 0 && (
          <div className="ai-attach" aria-label={t('ai.photosCount', { n: photos.length })}>
            {photos.map((p) => (
              <div key={p.id} className="ai-attach__item">
                <img src={p.preview} alt="" />
                <button
                  type="button"
                  className="ai-attach__remove"
                  onClick={() => removePhoto(p.id)}
                  disabled={busy}
                  aria-label={t('ai.removePhoto')}
                >×</button>
              </div>
            ))}
            {attaching && <div className="ai-attach__item ai-attach__item--loading" aria-hidden />}
          </div>
        )}
        {/* Два поля, а не одно: capture="environment" на iPhone открывает
            сразу камеру и не даёт выбрать уже сделанный снимок. Поле галереи
            без capture и с multiple — можно выбрать несколько фото разом. */}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={attachPhotos} />
        <input ref={galleryRef} type="file" accept="image/*" multiple={maxPhotos > 1} hidden onChange={attachPhotos} />
        <button
          className="iconbtn ai-chat__camera"
          onClick={() => fileRef.current?.click()}
          disabled={busy || attaching || photos.length >= maxPhotos}
          aria-label={t('ai.camera')}
          title={t('ai.camera')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <button
          className="iconbtn ai-chat__camera"
          onClick={() => galleryRef.current?.click()}
          disabled={busy || attaching || photos.length >= maxPhotos}
          aria-label={t('ai.gallery')}
          title={t('ai.gallery')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>
        <textarea
          ref={inputRef}
          className="ai-chat__input"
          value={input}
          rows={1}
          placeholder={t('ai.inputPh')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
          }}
          disabled={busy}
        />
        <button className="btn ai-chat__send" onClick={send} disabled={busy || attaching || (!input.trim() && !photos.length)} aria-label={t('common.send')}>
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
      {msg.photos?.length > 0 && (
        <div className={`ai-bubble__photos ${msg.photos.length > 1 ? 'ai-bubble__photos--grid' : ''}`}>
          {msg.photos.map((src, i) => <img key={i} className="ai-bubble__photo" src={src} alt="" />)}
        </div>
      )}
      {msg.greeting && <p className="ai-bubble__text">{greeting(msg.greeting)}</p>}
      {msg.text && <p className="ai-bubble__text">{msg.text}</p>}
      {msg.truncated && (
        <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
          {t('ai.truncated')}
        </p>
      )}
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

const CONFIDENCE = { high: null, medium: 'ai.confidence.medium', low: 'ai.confidence.low' }

function MealCard({ card, added, onAdd }) {
  const hint = CONFIDENCE[card.confidence] && t(CONFIDENCE[card.confidence])
  return (
    <div className="ai-card">
      <div className="ai-card__head">
        <span className="ai-card__name">{card.name}</span>
        {card.grams ? <span className="ai-card__grams">{t('units.gN', { n: Math.round(card.grams) })}</span> : null}
      </div>
      <div className="ai-card__macros">
        <b>{Math.round(card.kcal)}</b> {t('units.kcal')} · {t('macro.p')} {Math.round(card.protein)} · {t('macro.f')} {Math.round(card.fat)} · {t('macro.c')} {Math.round(card.carbs)}
        {hint && <span className="ai-card__conf"> · {hint}</span>}
      </div>
      <button className={`btn ${added ? 'soft' : ''} ai-card__add`} onClick={onAdd} disabled={added}>
        {added ? t('ai.added') : t('ai.addToDiary')}
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
      <span className="ai-budget__label">{low && onUpgrade ? t('ai.budgetMore') : `${100 - pct}%`}</span>
    </>
  )
  if (low && onUpgrade) {
    return (
      <button className="ai-budget ai-budget--action" onClick={onUpgrade} title={t('ai.budgetUsed', { pct })}>
        {bar}
      </button>
    )
  }
  return <div className="ai-budget" title={t('ai.budgetUsed', { pct })}>{bar}</div>
}

// Лимит кончился. Показываем дату обнуления — без неё экран читается как
// «всё, конец», хотя на самом деле это до первого числа.
function Exhausted({ tier, onUpgrade }) {
  const free = tier === 'FREE'
  return (
    <div className="screen ai-home">
      <div className="ai-home__stage">
        <div className="ai-home__orb" aria-hidden>
          <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </div>
        <h1 className="h1 ai-home__title">{t('ai.exhausted.title')}</h1>
        <p className="ai-home__sub">
          {free ? t('ai.exhausted.free') : t('ai.exhausted.paid')}
        </p>
        {onUpgrade && (
          <button className="btn" style={{ marginTop: 18 }} onClick={onUpgrade}>
            {free ? t('ai.exhausted.seePlans') : t('ai.exhausted.goPro')}
          </button>
        )}
      </div>
    </div>
  )
}
