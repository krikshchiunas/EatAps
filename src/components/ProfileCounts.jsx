// Счётчики профиля: подписчики, подписки, друзья, мысли.
//
// Отдельный файл, потому что эту строку рисуют два экрана — свой профиль
// (ProfileScreen) и чужой (PublicProfile). Раньше она жила внутри
// PublicProfile, и перенос подписчиков в собственный профиль означал бы
// вторую копию с собственной вёрсткой. Свой и чужой профиль обязаны совпадать
// визуально: иначе человек не понимает, что именно видят о нём другие.

export function Count({ label, value, onClick, active }) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        flex: 1, background: 'none', border: 0, padding: '6px 0',
        color: 'inherit', cursor: onClick ? 'pointer' : 'default',
        borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
      }}
    >
      {/* Прочерк вместо нуля, пока счётчик не приехал: ноль — это утверждение,
          а мы ещё не знаем. */}
      <div className="tabular" style={{ fontSize: 19, fontWeight: 700 }}>{value ?? '—'}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </button>
  )
}

export default function ProfileCounts({ card, tab, onPick, showThoughts = true }) {
  const pick = (key) => (onPick ? () => onPick(key) : null)
  return (
    <div className="row" style={{ marginBottom: 16 }}>
      <Count label="Подписчики" value={card?.followers_count} active={tab === 'followers'} onClick={pick('followers')} />
      <Count label="Подписки"   value={card?.following_count} active={tab === 'following'} onClick={pick('following')} />
      <Count label="Друзья"     value={card?.friends_count}   active={tab === 'friends'}   onClick={pick('friends')} />
      {showThoughts && (
        <Count label="Мысли" value={card?.posts_count} active={tab === 'thoughts'} onClick={pick('thoughts')} />
      )}
    </div>
  )
}
