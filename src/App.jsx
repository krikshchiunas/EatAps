import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from './store.jsx'
import { keyOf } from './lib/date.js'
import { fetchUserBrief, startPresence, touchLastSeen } from './lib/supabase.js'
import { subscribeToNotifications, subscribeToFollowRequests, refreshMuteCache } from './lib/social.js'
import { unreadTotals, subscribeToInbox } from './lib/messaging.js'
import {
  startScheduler, notifyIncomingMessage, notifySocialEvent,
  setNotificationPrefs, setMutedMessageUsers,
} from './lib/notifications.js'
import { typeOfMealId } from './lib/meals.js'
import Onboarding from './components/Onboarding.jsx'
import AuthNotice from './components/AuthNotice.jsx'
import DayScreen from './components/DayScreen.jsx'
import HistoryScreen from './components/HistoryScreen.jsx'
import StatsScreen from './components/StatsScreen.jsx'
import ProfileScreen from './components/ProfileScreen.jsx'
import FriendsScreen from './components/FriendsScreen.jsx'
import FeedTab from './components/FeedTab.jsx'
import BottomNav from './components/BottomNav.jsx'
import AddMealSheet from './components/AddMealSheet.jsx'
import Toast from './components/Toast.jsx'
import { amountLabel } from './lib/foods.js'
import ResetPasswordSheet from './components/ResetPasswordSheet.jsx'
import PushScreen from './components/PushScreen.jsx'
import AITab from './components/AITab.jsx'

export default function App() {
  const store = useStore()
  const { profile, days, dayOf, addFood, removeFood, recovery, booting, user, prefs } = store
  const [tab, setTab] = useState('day')
  const [date, setDate] = useState(keyOf())
  const [sheet, setSheet] = useState(null) // null | { mealId, mealLabel }
  // Отмена последнего добавления ПОСЛЕ закрытия листа.
  //
  // Тост живёт внутри AddMealSheet и умирает вместе с ним, поэтому у главного
  // пути — выбрать продукт, указать порцию, «Добавить» — отмены не было вообще:
  // лист закрывался, и единственным способом исправить промах оставалось
  // свайп-удаление в дневнике. Запоминаем последнее добавление и показываем
  // тост здесь, где он переживёт закрытие.
  const lastAdd = useRef(null)
  const [addUndo, setAddUndo] = useState(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [clipboard, setClipboard] = useState(null)
  // Все бейджи одним запросом и из ОДНОГО источника — сервера. Раньше
  // непрочитанные сообщения считались на клиенте по выборке за 30 дней, а
  // события — отдельной функцией; две системы счёта неизбежно расходились, и
  // на телефоне светился бейдж, которого на ноутбуке не было.
  const [totals, setTotals] = useState({
    messages: 0, messageRequests: 0, followRequests: 0, notifications: 0,
  })
  // Диалог, который просит открыть «Профиль» (уведомление о сообщении). Чат
  // живёт во вкладке «Общение», поэтому переход идёт через App: адрес → вкладка.
  //
  // Адрес — это { userId } для личной переписки и { conversationId } для
  // групповой: у группы собеседника нет, и открыть её по id человека нечем.
  const [chatWith, setChatWith] = useState(null)

  // Актуальный стор для планировщика (не пересоздаём таймер при каждом изменении).
  const stateRef = useRef({ profile, days })
  stateRef.current = { profile, days }

  // Настройки уведомлений едут в модуль, который решает, показывать пуш или
  // нет. Отдельным эффектом: prefs синхронизируются между устройствами, и
  // выключенное на телефоне не должно продолжать пищать на ноутбуке.
  useEffect(() => { setNotificationPrefs(prefs) }, [prefs])

  // Локальные напоминания в 15:00 (обед) и 18:00 (недобор). Один раз в день.
  useEffect(() => {
    if (!profile) return
    return startScheduler(() => stateRef.current)
  }, [profile])

  const refreshTotals = useCallback(async () => {
    if (!user?.id) {
      setTotals({ messages: 0, messageRequests: 0, followRequests: 0, notifications: 0 })
      return
    }
    try { setTotals(await unreadTotals()) } catch { /* раздел недоступен */ }
  }, [user?.id])

  // Присутствие «онлайн» + отметка «был(а) в сети». Живут на уровне приложения,
  // а не чата: друг должен считаться онлайн, даже если сейчас смотрит дневник.
  // Heartbeat раз в минуту и при возврате на вкладку — чаще нет смысла, точность
  // «был(а) в 14:32» этого не требует.
  useEffect(() => {
    if (!user?.id) return
    const stop = startPresence(user.id)
    touchLastSeen()
    const beat = setInterval(touchLastSeen, 60_000)
    const onVis = () => { if (document.visibilityState === 'visible') touchLastSeen() }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(beat)
      document.removeEventListener('visibilitychange', onVis)
      touchLastSeen() // фиксируем момент ухода
      stop()
    }
  }, [user?.id])

  // Кэш имени/аватарки отправителей — один лукап на друга за сессию.
  const senderCache = useRef(new Map())

  useEffect(() => {
    if (!user?.id) return
    senderCache.current = new Map()
    refreshTotals()
    return subscribeToInbox(user.id, async (payload) => {
      const row = payload?.new
      // Счётчики обновляем на ЛЮБОЕ событие: смена состояния участия и
      // прочтение с другого устройства меняют бейдж не меньше, чем новое
      // сообщение.
      const counts = await unreadTotals().catch(() => null)
      if (counts) setTotals(counts)

      if (!row?.sender || row.sender === user.id || !row.text && !row.image_url && !row.media && !row.meal_ref) return

      let brief = senderCache.current.get(row.sender)
      if (!brief) {
        brief = (await fetchUserBrief(row.sender)) || {}
        senderCache.current.set(row.sender, brief)
      }

      notifyIncomingMessage({
        senderId: row.sender,
        senderName: brief.name,
        senderAvatar: brief.avatar,
        unreadCount: counts?.messages || 1,
        messageId: row.id,
        conversationId: row.conversation_id || null,
      })
    })
  }, [user?.id, refreshTotals])

  // Заглушённые собеседники: список ведёт сервер, но решение «показывать
  // пуш» принимается синхронно в обработчике входящего — там ходить в базу
  // уже поздно. Поэтому держим кэш; при входе он заполняется здесь, а дальше
  // его обновляет сам setMute — в единственной точке, где заглушения меняются.
  useEffect(() => {
    if (!user?.id) { setMutedMessageUsers([]); return }
    refreshMuteCache()
  }, [user?.id])

  // Социальные события: бейдж «Профиль» и пуш. Пуш шлём только на СВЕЖЕЕ
  // событие (пришло по realtime), а не на каждый пересчёт: иначе перезаход в
  // приложение звенел бы всей накопленной историей.
  useEffect(() => {
    if (!user?.id) return
    const off = subscribeToNotifications(user.id, async (payload) => {
      refreshTotals()
      const row = payload?.new
      if (payload?.eventType !== 'INSERT' || !row?.actor_id) return
      let brief = senderCache.current.get(row.actor_id)
      if (!brief) {
        brief = (await fetchUserBrief(row.actor_id)) || {}
        senderCache.current.set(row.actor_id, brief)
      }
      notifySocialEvent({
        type: row.type,
        actorId: row.actor_id,
        actorName: brief.name,
        actorAvatar: brief.avatar,
      })
    })
    const offReq = subscribeToFollowRequests(user.id, refreshTotals)
    return () => { off(); offReq() }
  }, [user?.id, refreshTotals])

  // Бейджи разъехались вместе с разделами: переписка во вкладке «Общение»,
  // события и просьбы о подписке — в «Профиле». Одна общая цифра звала бы не
  // туда, где лежит непрочитанное.
  const unreadMessages = totals.messages + totals.messageRequests
  const unreadEvents = totals.notifications + totals.followRequests

  // Ссылка «сброс пароля» из письма. Это отдельный режим, а не оверлей поверх
  // приложения: пока пароль не сменён, восстановительная сессия не считается
  // обычным входом и данные аккаунта не грузятся.
  if (recovery) return <ResetPasswordSheet />

  // Пока неизвестно, есть ли сессия и чьи данные локально, не рендерим ничего:
  // ни онбординг, ни главный экран с дефолтами — и никакого экрана загрузки.
  // Приложение появляется сразу, как только состояние сессии известно.
  if (booting) return null

  if (!profile) {
    return (
      <div className="app">
        <Onboarding />
        <AuthNotice />
      </div>
    )
  }

  const pickDay = (k) => {
    setDate(k)
    setTab('day')
    setCalendarOpen(false)
  }

  return (
    <div className="app">
      {tab === 'day' && <DayScreen date={date} setDate={setDate} onOpenAdd={(mealId, mealLabel) => setSheet({ mealId, mealLabel })} onOpenCalendar={() => setCalendarOpen(true)} onOpenStats={() => setStatsOpen(true)} clipboard={clipboard} setClipboard={setClipboard} />}
      {tab === 'ai' && <AITab />}
      {tab === 'feed' && <FeedTab onChatClosed={refreshTotals} />}
      {tab === 'friends' && (
        <FriendsScreen
          requestCount={totals.messageRequests}
          onChanged={refreshTotals}
          setTab={setTab}
          openChatWith={chatWith}
          onChatOpened={() => setChatWith(null)}
        />
      )}
      {tab === 'profile' && (
        <ProfileScreen
          setTab={setTab}
          onOpenChat={(target) => {
            setChatWith(typeof target === 'string' ? { userId: target } : target)
            setTab('friends')
          }}
        />
      )}

      <BottomNav tab={tab} setTab={setTab} friendsUnread={unreadMessages} profileUnread={unreadEvents} />

      {calendarOpen && (
        <PushScreen onClose={() => setCalendarOpen(false)}>
          {(close) => <HistoryScreen onPickDay={pickDay} onClose={close} />}
        </PushScreen>
      )}

      {statsOpen && (
        <PushScreen onClose={() => setStatsOpen(false)}>
          {(close) => <StatsScreen onClose={close} />}
        </PushScreen>
      )}

      {sheet && (
        <AddMealSheet
          mealId={sheet.mealId}
          mealLabel={sheet.mealLabel}
          mealType={typeOfMealId(sheet.mealId)}
          onClose={() => {
            setSheet(null)
            const a = lastAdd.current
            lastAdd.current = null
            if (!a?.ids.length) return
            setAddUndo({
              msg: a.label,
              undo: () => {
                for (const id of a.ids) removeFood(date, id)
                setAddUndo({ msg: 'Отменено' })
              },
            })
          }}
          onAdd={(food) => {
            const id = addFood(date, food)
            const amount = food.grams > 0 ? amountLabel(food.grams, food.unit || 'г') : `${food.kcal} ккал`
            if (id) lastAdd.current = { ids: [id], label: `${food.name} · ${amount}` }
            return id
          }}
          // Добавление НЕСКОЛЬКИХ записей разом (блюдо из шаблона). Отмена
          // обязана убирать их все: человек добавил одним касанием — и убрать
          // должен одним, а не выкапывать три строки из дневника по одной.
          onAddMany={(foods, label) => {
            const ids = foods.map((f) => addFood(date, f)).filter(Boolean)
            if (ids.length) lastAdd.current = { ids, label }
            return ids
          }}
          onRemove={(id) => {
            // Отменили внутри листа — отменять это же повторно уже нечего.
            if (lastAdd.current?.ids.includes(id)) lastAdd.current = null
            removeFood(date, id)
          }}
        />
      )}
      <Toast toast={addUndo} onDone={() => setAddUndo(null)} />
      <AuthNotice />
    </div>
  )
}
