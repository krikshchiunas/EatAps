import { useState } from 'react'
import { useStore } from './store.jsx'
import { keyOf } from './lib/date.js'
import Onboarding from './components/Onboarding.jsx'
import DayScreen from './components/DayScreen.jsx'
import HistoryScreen from './components/HistoryScreen.jsx'
import ProfileScreen from './components/ProfileScreen.jsx'
import BottomNav from './components/BottomNav.jsx'
import AddMealSheet from './components/AddMealSheet.jsx'

export default function App() {
  const { profile, addMeal } = useStore()
  const [tab, setTab] = useState('day')
  const [date, setDate] = useState(keyOf())
  const [sheet, setSheet] = useState(false)

  if (!profile) {
    return (
      <div className="app">
        <Onboarding />
      </div>
    )
  }

  const pickDay = (k) => {
    setDate(k)
    setTab('day')
  }

  return (
    <div className="app">
      {tab === 'day' && <DayScreen date={date} setDate={setDate} onOpenAdd={() => setSheet(true)} />}
      {tab === 'history' && <HistoryScreen onPickDay={pickDay} />}
      {tab === 'profile' && <ProfileScreen />}

      <BottomNav tab={tab} setTab={setTab} onAdd={() => { setTab('day'); setSheet(true) }} />

      {sheet && (
        <AddMealSheet
          onClose={() => setSheet(false)}
          onAdd={(meal) => addMeal(date, meal)}
        />
      )}
    </div>
  )
}
