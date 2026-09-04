import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from './store.jsx'
import { keyOf } from './lib/date.js'
import { fetchUnreadCounts, subscribeToIncoming, fetchUserBrief, startPresence, touchLastSeen } from './lib/supabase.js'
import { unreadNotificationCount, subscribeToNotifications } from './lib/social.js'
import { startScheduler, notifyIncomingMessage, setNotificationPrefs } from './lib/notifications.js'
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
  const [unreadCounts, setUnreadCounts] = useState({})
  const [unreadEvents, setUnreadEvents] = useState(0)
  // Диалог, который просит открыть «Профиль» (уведомление о сообщении). Чат
  // живёт во вкладке «Друзья», поэтому переход идёт через App: id → вкладка.
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

  const refreshUnread = useCallback(async () => {
    if (!user?.id) return
    setUnreadCounts(await fetchUnreadCounts(user.id))
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
    refreshUnread()
    return subscribeToIncoming(user.id, async (payload) => {
      const row = payload?.new
      if (!row?.sender || row.sender === user.id) {
        refreshUnread()
        return
      }

      // Свежий счётчик непрочитанных, чтобы в теле пуша была правильная цифра.
      const counts = await fetchUnreadCounts(user.id)
      setUnreadCounts(counts)

      let brief = senderCache.current.get(row.sender)
      if (!brief) {
        brief = (await fetchUserBrief(row.sender)) || {}
        senderCache.current.set(row.sender, brief)
      }

      notifyIncomingMessage({
        senderId: row.sender,
        senderName: brief.name,
        senderAvatar: brief.avatar,
        unreadCount: counts[row.sender] || 1,
        messageId: row.id,
      })
    })
  }, [user?.id, refreshUnread])

  // Непрочитанные события — с сервера, как и сообщения. Считаются здесь ради
  // бейджа в навигации; тот же самый счётчик показывает «Профиль → События».
  // Второй системы уведомлений нет — оба читают unread_notification_count.
  useEffect(() => {
    if (!user?.id) { setUnreadEvents(0); return }
    const refresh = async () => {
      try { setUnreadEvents(await unreadNotificationCount()) } catch { /* раздел недоступен */ }
    }
    refresh()
    return subscribeToNotifications(user.id, refresh)
  }, [user?.id])

  // Бейджи разъехались вместе с разделами: сообщения остались во вкладке
  // «Друзья», события переехали в «Профиль». Одна общая цифра теперь звала бы
  // не туда, где лежит непрочитанное.
  const unreadMessages = Object.values(unreadCounts).reduce((s, n) => s + n, 0)

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
      {tab === 'feed' && <FeedTab onChatClosed={refreshUnread} />}
      {tab === 'friends' && (
        <FriendsScreen
          unreadCounts={unreadCounts}
          onChatClosed={refreshUnread}
          setTab={setTab}
          openChatWith={chatWith}
          onChatOpened={() => setChatWith(null)}
        />
      )}
      {tab === 'profile' && (
        <ProfileScreen
          setTab={setTab}
          onOpenChat={(userId) => { setChatWith(userId); setTab('friends') }}
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
