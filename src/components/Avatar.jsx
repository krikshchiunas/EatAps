// Аватар человека или группы.
//
// Жил в FriendsScreen и импортировался оттуда восемью экранами — включая те,
// где никаких друзей нет вовсе (уведомления, настройки, лента). Файл-хозяин
// был выбран случайно, по тому, где аватар понадобился первым.
//
// Без картинки рисуем инициал на мятной подложке, а не «серый силуэт»:
// инициал различает людей в списке, силуэт — нет.
export function Avatar({ src, name, size = 44, ring = false }) {
  const style = { width: size, height: size, borderRadius: '50%', flex: '0 0 auto' }
  if (ring) style.boxShadow = '0 0 0 2px var(--primary-weak)'

  if (src) return <img src={src} alt="" style={{ ...style, objectFit: 'cover' }} />
  return (
    <div style={{
      ...style,
      background: 'var(--mint-soft)', color: 'var(--on-mint)',
      display: 'grid', placeItems: 'center',
      fontSize: size * 0.42, fontWeight: 600,
    }}>
      {(name || '?').trim().slice(0, 1).toUpperCase()}
    </div>
  )
}

// Аватар группы: до трёх лиц участников веером. Название группы часто пустое
// («Без названия»), и тогда единственное, по чему её узнают в списке, — это
// лица; одна общая иконка сделала бы все группы одинаковыми.
export function GroupAvatar({ members = [], size = 44, title }) {
  const faces = members.slice(0, 3)
  if (!faces.length) return <Avatar name={title || 'Г'} size={size} />

  const small = Math.round(size * 0.62)
  return (
    <div style={{ width: size, height: size, position: 'relative', flex: '0 0 auto' }} aria-hidden>
      {faces.map((m, i) => (
        <div
          key={m.user_id || i}
          style={{
            position: 'absolute',
            left: i === 0 ? 0 : 'auto',
            right: i === 1 ? 0 : 'auto',
            bottom: i === 2 ? 0 : 'auto',
            top: i === 2 ? 'auto' : 0,
            // Обводка цветом поверхности: без неё лица сливаются в пятно.
            boxShadow: '0 0 0 2px var(--surface-solid)',
            borderRadius: '50%',
          }}
        >
          <Avatar src={m.avatar_url} name={m.display_name || m.username} size={small} />
        </div>
      ))}
    </div>
  )
}

// Замок закрытого аккаунта — маленький значок рядом с ником. Отдельный
// компонент, потому что он появляется в четырёх списках сразу, и рисовать
// его четырьмя разными способами не нужно.
export function LockBadge({ size = 12 }) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: '0 0 auto', opacity: 0.75 }}
      role="img"
      aria-label="Закрытый аккаунт"
    >
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </svg>
  )
}

export default Avatar
