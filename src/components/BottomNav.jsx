const ICONS = {
  day: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="navicon">
      <path d="M12 3.5 4 9.2V20a1 1 0 0 0 1 1h4v-6h6v6h4a1 1 0 0 0 1-1V9.2L12 3.5z" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="navicon">
      <path d="M12 3.5l1.9 4.9 4.9 1.9-4.9 1.9L12 17.1l-1.9-4.9-4.9-1.9 4.9-1.9L12 3.5z" />
      <path d="M18.6 15.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="navicon">
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9h17M8 3v3M16 3v3" />
    </svg>
  ),
  feed: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="navicon">
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
      <path d="M7.5 9h5M7.5 12.5h9M7.5 16h7" />
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

// Два бейджа, а не один общий: непрочитанные сообщения ждут во вкладке
// «Друзья», непрочитанные события — в «Профиле». Общая цифра на одной вкладке
// звала бы не туда, где лежит непрочитанное.
export default function BottomNav({ tab, setTab, friendsUnread = 0, profileUnread = 0 }) {
  return (
    <nav className="bottomnav">
      <button className={tab === 'day' ? 'on' : ''} onClick={() => setTab('day')}>
        {ICONS.day}<span>День</span>
      </button>
      <button className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}>
        {ICONS.ai}<span>AI</span>
      </button>
      <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>
        {ICONS.feed}<span>Лента</span>
      </button>
      <button className={tab === 'friends' ? 'on' : ''} onClick={() => setTab('friends')} style={{ position: 'relative' }}>
        {ICONS.friends}
        {friendsUnread > 0 && (
          <span className="nav-badge">{friendsUnread > 99 ? '99+' : friendsUnread}</span>
        )}
        <span>Друзья</span>
      </button>
      <button className={tab === 'profile' ? 'on' : ''} onClick={() => setTab('profile')} style={{ position: 'relative' }}>
        {ICONS.profile}
        {profileUnread > 0 && (
          <span className="nav-badge">{profileUnread > 99 ? '99+' : profileUnread}</span>
        )}
        <span>Профиль</span>
      </button>
    </nav>
  )
}
