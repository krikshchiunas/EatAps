// ─────────────────────────────────────────────────────────────────────────────
// Профиль пользователя — ОДИН компонент на свой профиль и на профиль друга.
//
// Раньше «витрина» существовала только для чужого аккаунта (FriendAccount), а
// собственный профиль был экраном настроек. Из-за этого человек не мог увидеть
// себя глазами друга, а любая правка витрины делалась в одном месте и
// незаметно расходилась с другим. Теперь разница между «я» и «друг» — это
// isOwnProfile и источник данных, а не второй компонент.
//
// Чем именно отличаются режимы:
//   • свой  — данные из стора (полный день со своими приёмами пищи),
//             кнопка правки профиля, вкладка «Мысли» умеет публиковать;
//   • друг  — данные из friend_state (день без своих приёмов, см. groupDayByMeal),
//             на каждый продукт кнопка реакции, которая уходит В ЛИЧКУ.
//
// Реакция на еду намеренно остаётся личным сообщением, а не публичным
// комментарием: еда в дневнике — не пост, и обсуждать её при всех человек не
// просил. Публичные реакции есть только у «Мыслей».
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'
import { sumDay } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { groupDayByMeal, resolvedTime } from '../lib/meals.js'
import { Avatar } from './FriendsScreen.jsx'
import ThoughtsFeed from './ThoughtsFeed.jsx'

const TABS = [
  { key: 'self', label: 'Я' },
  { key: 'diet', label: 'Питание' },
  { key: 'thoughts', label: 'Мысли' },
]

function Stat({ label, v }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(v || 0)}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
}

// Список-«облако» для «не ем» / «люблю». Пустой список у себя — приглашение
// заполнить, у друга — просто ничего: чужой профиль не место для подсказок.
function ListBlock({ title, hint, items, emoji, tone }) {
  if (!items?.length) return null
  return (
    <div style={{ marginTop: 16 }}>
      <div className="row gap8" style={{ alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 15 }}>{emoji}</span>
        <span style={{ fontSize: 14, fontWeight: 620 }}>{title}</span>
        {hint && <span className="muted" style={{ fontSize: 12 }}>{hint}</span>}
      </div>
      <div className="row wrap gap8">
        {items.map((x) => (
          <span
            key={x}
            className="chip"
            style={tone === 'no'
              ? { background: 'var(--surface-2)', color: 'var(--ink-2)' }
              : { background: 'var(--primary-weak)', color: 'var(--primary-strong)', borderColor: 'var(--primary)' }}
          >
            {x}
          </span>
        ))}
      </div>
    </div>
  )
}

function FavRow({ emoji, label, value }) {
  if (!value) return null
  return (
    <div className="row gap8" style={{ alignItems: 'center', marginTop: 10 }}>
      <span>{emoji}</span>
      <div>
        <div className="muted" style={{ fontSize: 11 }}>{label}</div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
      </div>
    </div>
  )
}

function FoodRow({ food, customFoods, onReact }) {
  const [open, setOpen] = useState(false)
  const composite = (customFoods || []).find(
    (f) => f.name === food.name && f.kind === 'composite' && f.recipe,
  )

  return (
    <div>
      <div className="row between" style={{ alignItems: 'center', padding: '8px 0' }}>
        <div className="row gap10" style={{ alignItems: 'center', minWidth: 0, flex: 1 }}>
          <span className="meal-emoji" style={{ flex: '0 0 auto' }}>{food.emoji || '🍽️'}</span>
          <div style={{ minWidth: 0 }}>
            <div className="meal-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{food.name}</div>
            <div className="row gap8" style={{ alignItems: 'center' }}>
              {food.grams != null && <span className="meal-meta">{food.grams} {food.unit || 'г'}</span>}
              {composite && (
                <button style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 550 }} onClick={() => setOpen((o) => !o)}>
                  {open ? 'Скрыть ▲' : 'Состав ▼'}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="row gap10" style={{ alignItems: 'center', flex: '0 0 auto' }}>
          <span className="tabular" style={{ fontWeight: 650 }}>{food.kcal} ккал</span>
          {onReact && (
            <button
              onClick={() => onReact(food)}
              style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}
              aria-label="Отреагировать"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {open && composite && (
        <div style={{ padding: '6px 8px 10px 36px', background: 'var(--surface-2)', borderRadius: 10, marginBottom: 6 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 6 }}>Состав блюда:</div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>🍞 {composite.recipe.base} × {composite.recipe.slices} шт.</div>
          {(composite.recipe.items || []).filter((i) => i.count > 0).map((i) => (
            <div key={i.name} style={{ fontSize: 13, marginBottom: 2 }}>· {i.name} × {i.count}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function MealSection({ group, customFoods, onReact }) {
  const { section, foods } = group
  const totals = sumDay(foods)
  const time = resolvedTime(section, foods)

  return (
    <div className="card meal-section" style={{ marginBottom: 12 }}>
      <div className="row gap12" style={{ alignItems: 'center', marginBottom: foods.length ? 6 : 0 }}>
        <span className="meal-emoji" style={{ width: 38, height: 38, fontSize: 17, flex: '0 0 auto' }}>{section.emoji}</span>
        <div style={{ minWidth: 0 }}>
          <div className="row gap8" style={{ alignItems: 'baseline' }}>
            <span style={{ fontSize: 15.5, fontWeight: 620 }}>{section.label}</span>
            {time && <span className="tabular" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{time}</span>}
          </div>
          {foods.length > 0 && (
            <div className="tabular" style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
              {totals.kcal} ккал · Б{totals.protein} Ж{totals.fat} У{totals.carbs}
            </div>
          )}
        </div>
      </div>

      {foods.length === 0 ? (
        <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>Пока ничего</p>
      ) : (
        foods.map((f) => <FoodRow key={f.id} food={f} customFoods={customFoods} onReact={onReact} />)
      )}
    </div>
  )
}

export default function UserProfileView({
  isOwnProfile = false,
  userId,
  profile,
  publicId,
  dayOf,
  customFoods,
  friendsCount = null,
  onOpenFriends,
  onEditProfile,
  onReactToMeal,
  signInPrompt = null,
}) {
  const [tab, setTab] = useState('self')
  const [date, setDate] = useState(keyOf())
  const today = keyOf()

  const p = profile || {}
  const name = p.name || (isOwnProfile ? 'Без имени' : 'Друг')
  const day = dayOf(date) || { meals: [] }
  const totals = sumDay(day.meals || [])
  const target = p.targets?.calories
  const groups = groupDayByMeal(day)
  const dayEmpty = groups.every((g) => g.foods.length === 0)
  const hasSelfDetails = Boolean(p.favRestaurant || p.favDish || p.noGos?.length || p.toGos?.length)

  return (
    <>
      {/* ── Шапка: лицо, имя, био, друзья ─────────────────────────────────── */}
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Avatar src={p.avatar} name={name} size={96} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 680, letterSpacing: '-0.3px', marginTop: 12 }}>{name}</div>
        {isOwnProfile && publicId && (
          <div className="tabular" style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3, letterSpacing: '0.04em' }}>
            {publicId}
          </div>
        )}
        {p.bio && (
          <p style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--ink-2)', margin: '10px auto 0', maxWidth: 420, whiteSpace: 'pre-wrap' }}>
            {p.bio}
          </p>
        )}
        {friendsCount != null && (
          <button
            onClick={onOpenFriends}
            style={{ marginTop: 12, fontSize: 14, color: 'var(--ink-2)' }}
            disabled={!onOpenFriends}
          >
            Друзья · <span className="tabular" style={{ fontWeight: 680, color: 'var(--ink)' }}>{friendsCount}</span>
          </button>
        )}
      </div>

      {/* ── Три части профиля ─────────────────────────────────────────────── */}
      <div className="seg" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'self' && (
        <>
          {signInPrompt}
          {/* Био уже стоит в шапке и видно на всех вкладках — здесь его не
              повторяем, иначе один и тот же текст идёт дважды подряд. */}
          {hasSelfDetails ? (
            <div className="card">
              <FavRow emoji="🍴" label="Любимый ресторан" value={p.favRestaurant} />
              <FavRow emoji="🍲" label="Любимое блюдо" value={p.favDish} />
              <ListBlock title="Не ем" hint="избегаю" emoji="🚫" items={p.noGos} tone="no" />
              <ListBlock title="Люблю" hint="и хочу попробовать" emoji="💚" items={p.toGos} tone="yes" />
            </div>
          ) : !p.bio ? (
            <div className="card">
              <p className="muted" style={{ fontSize: 14 }}>
                {isOwnProfile
                  ? 'Пока пусто. Расскажите о себе — это первое, что видят друзья.'
                  : 'Человек пока ничего о себе не рассказал.'}
              </p>
            </div>
          ) : null}
          {isOwnProfile && onEditProfile && (
            <button className="btn ghost" style={{ marginTop: 12 }} onClick={onEditProfile}>
              Редактировать профиль
            </button>
          )}
        </>
      )}

      {tab === 'diet' && (
        <>
          <div className="row between" style={{ alignItems: 'center', marginBottom: 14 }}>
            <button className="iconbtn" onClick={() => setDate(addDays(date, -1))} aria-label="Раньше">‹</button>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 620 }}>{humanDay(date, today)}</div>
              <div className="muted" style={{ fontSize: 12, textTransform: 'capitalize' }}>{humanDow(date)}</div>
            </div>
            <button className="iconbtn" onClick={() => setDate(addDays(date, 1))} disabled={date >= today} style={{ opacity: date >= today ? 0.4 : 1 }} aria-label="Позже">›</button>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row gap8" style={{ justifyContent: 'space-around' }}>
              <Stat label="ккал" v={totals.kcal} />
              <Stat label="белки" v={totals.protein} />
              <Stat label="угл." v={totals.carbs} />
              <Stat label="жиры" v={totals.fat} />
            </div>
            {target > 0 && (
              <p className="muted" style={{ fontSize: 12, textAlign: 'center', marginTop: 8 }}>Цель: {target} ккал</p>
            )}
          </div>

          {dayEmpty ? (
            <div className="card">
              <p className="muted" style={{ fontSize: 14 }}>
                {isOwnProfile ? 'В этот день вы ничего не записали.' : 'В этот день ничего не записано.'}
              </p>
            </div>
          ) : (
            groups.map((g) => (
              <MealSection
                key={g.section.id}
                group={g}
                customFoods={customFoods}
                onReact={onReactToMeal ? (food) => onReactToMeal(food, date) : null}
              />
            ))
          )}
        </>
      )}

      {tab === 'thoughts' && (
        <ThoughtsFeed
          userId={userId}
          isOwnProfile={isOwnProfile}
          authorName={name}
          authorAvatar={p.avatar}
        />
      )}
    </>
  )
}
