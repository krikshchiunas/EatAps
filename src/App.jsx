import { useState, useEffect, useCallback } from 'react'
import { useStore } from './store.jsx'
import { keyOf } from './lib/date.js'
import { fetchUnreadCounts, subscribeToIncoming } from './lib/supabase.js'
import Onboarding from './components/Onboarding.jsx'
import DayScreen from './components/DayScreen.jsx'
import HistoryScreen from './components/HistoryScreen.jsx'
import ProfileScreen from './components/ProfileScreen.jsx'
import FriendsScreen from './components/FriendsScreen.jsx'
import BottomNav from './components/BottomNav.jsx'
import AddMealSheet from './components/AddMealSheet.jsx'
import ResetPasswordSheet from './components/ResetPasswordSheet.jsx'
import PushScreen from './components/PushScreen.jsx'

export default function App() {
  const { profile, addMeal, recovery, clearRecovery, user } = useStore()
  const [tab, setTab] = useState('day')
  const [date, setDate] = useState(keyOf())
  const [sheet, setSheet] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [clipboard, setClipboard] = useState(null)
  const [unreadCounts, setUnreadCounts] = useState({})

  const refreshUnread = useCallback(async () => {
    if (!user?.id) return
    setUnreadCounts(await fetchUnreadCounts(user.id))
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    refreshUnread()
    return subscribeToIncoming(user.id, refreshUnread)
  }, [user?.id, refreshUnread])

  const totalUnread = Object.values(unreadCounts).reduce((s, n) => s + n, 0)

  // Ссылка «сброс пароля» из письма — форма нового пароля поверх всего.
  const recoverySheet = recovery ? <ResetPasswordSheet onClose={clearRecovery} /> : null

  if (!profile) {
    return (
      <div className="app">
        <Onboarding />
        {recoverySheet}
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
      {tab === 'day' && <DayScreen date={date} setDate={setDate} onOpenAdd={() => setSheet(true)} onOpenCalendar={() => setCalendarOpen(true)} clipboard={clipboard} setClipboard={setClipboard} />}
      {tab === 'friends' && <FriendsScreen unreadCounts={unreadCounts} onChatClosed={refreshUnread} setTab={setTab} />}
      {tab === 'profile' && <ProfileScreen />}

      <BottomNav tab={tab} setTab={setTab} onAdd={() => { setTab('day'); setSheet(true) }} totalUnread={totalUnread} />

      {calendarOpen && (
        <PushScreen onClose={() => setCalendarOpen(false)}>
          {(close) => <HistoryScreen onPickDay={pickDay} onClose={close} />}
        </PushScreen>
      )}

      {sheet && (
        <AddMealSheet
          date={date}
          onClose={() => setSheet(false)}
          onAdd={(meal) => addMeal(date, meal)}
        />
      )}
      {recoverySheet}
    </div>
  )
}
