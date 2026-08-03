const ICONS = {
  day: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="navicon">
      <path d="M12 3.5 4 9.2V20a1 1 0 0 0 1 1h4v-6h6v6h4a1 1 0 0 0 1-1V9.2L12 3.5z" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="navicon">
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9h17M8 3v3M16 3v3" />
    </svg>
  ),
  friends: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="navicon">
      <circle cx="9" cy="8.5" r="3" />
      <path d="M2.5 19.5c0-3 2.9-4.8 6.5-4.8s6.5 1.8 6.5 4.8" />
      <path d="M16 5.2a3 3 0 0 1 0 6M18 14.9c2.6.4 4.5 2 4.5 4.6" />
    </svg>
  ),
  profile: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="navicon">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c0-3.5 3.1-5.5 7-5.5s7 2 7 5.5" />
    </svg>
  ),
}

export default function BottomNav({ tab, setTab, onAdd }) {
  return (
    <nav className="bottomnav">
      <button className={tab === 'day' ? 'on' : ''} onClick={() => setTab('day')}>
        {ICONS.day}<span>День</span>
      </button>
      <div className="fab-slot">
        <button className="fab" onClick={onAdd} aria-label="Добавить приём пищи">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="26" height="26">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
      <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')}>
        {ICONS.friends}<span>Друзья</span>
      </button>
      <button className={tab === 'profile' ? 'on' : ''} onClick={() => setTab('profile')}>
        {ICONS.profile}<span>Профиль</span>
      </button>
    </nav>
  )
}
