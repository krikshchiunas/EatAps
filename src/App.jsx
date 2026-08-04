import { useState } from 'react'
import { useStore } from './store.jsx'
import { keyOf } from './lib/date.js'
import Onboarding from './components/Onboarding.jsx'
import DayScreen from './components/DayScreen.jsx'
import HistoryScreen from './components/HistoryScreen.jsx'
import ProfileScreen from './components/ProfileScreen.jsx'
import FriendsScreen from './components/FriendsScreen.jsx'
import ChatsScreen from './components/ChatsScreen.jsx'
import BottomNav from './components/BottomNav.jsx'
import AddMealSheet from './components/AddMealSheet.jsx'
import ResetPasswordSheet from './components/ResetPasswordSheet.jsx'

export default function App() {
  const { profile, addMeal, recovery, clearRecovery } = useStore()
  const [tab, setTab] = useState('day')
  const [date, setDate] = useState(keyOf())
  const [sheet, setSheet] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [clipboard, setClipboard] = useState(null)

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
      {tab === 'friends' && <FriendsScreen />}
      {tab === 'chats' && <ChatsScreen />}
      {tab === 'profile' && <ProfileScreen />}

      <BottomNav tab={tab} setTab={setTab} onAdd={() => { setTab('day'); setSheet(true) }} />

      {calendarOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 200, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <HistoryScreen onPickDay={pickDay} onClose={() => setCalendarOpen(false)} />
        </div>
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
