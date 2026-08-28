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
import { useEffect, useMemo, useState } from 'react'
import { sumDay } from '../lib/nutrition.js'
import { keyOf, addDays, humanDay, humanDow } from '../lib/date.js'
import { groupDayByMeal, resolvedTime } from '../lib/meals.js'
import { foodHabits } from '../lib/stats.js'
import { Avatar } from './FriendsScreen.jsx'
import ThoughtsFeed from './ThoughtsFeed.jsx'

// Порядок вкладок: сначала то, что человек сказал сам («Мысли»), потом то, что
// он ест, и только потом анкета. Профиль читают сверху вниз, а самое живое в
// нём — мысли, а не поля о себе.
const TABS = [
  { key: 'thoughts', label: 'Мысли' },
  { key: 'diet', label: 'Питание' },
  { key: 'self', label: 'О себе' },
]

function Stat({ label, v }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 20, fontWeight: 700 }}>{Math.round(v || 0)}</div>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
    </div>
  )
}

// Строка «О себе»: служебная подпись сверху, значение под ней.
//
// Ни эмодзи, ни счётчиков, ни пояснений справа. Раньше здесь была строка с
// иконкой и хвостом вида «12 раз»: цифра превращала рассказ о себе в отчёт по
// дневнику, а иконка спорила с подписью за внимание. Осталась подпись
// (светло-серая, служебная) и то, ради чего строка существует, — значение.
function ProfileRow({ label, value, multiline = false }) {
  if (!value) return null
  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.3 }}>{label}</div>
      <div style={{
        fontSize: 15, lineHeight: 1.45, marginTop: 3, color: 'var(--ink)',
        whiteSpace: multiline ? 'pre-wrap' : 'normal',
      }}>
        {value}
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
  username,
  dayOf,
  days,
  customFoods,
  counts = null,
  onEditProfile,
  onReactToMeal,
  signInPrompt = null,
  focusTab = null,
  onFocusHandled,
}) {
  const [tab, setTab] = useState('thoughts')
  const [date, setDate] = useState(keyOf())
  const today = keyOf()

  // Внешняя навигация (событие «отреагировали на вашу мысль») открывает нужную
  // вкладку этого же профиля. Вызывающий сбрасывает focusTab обратно в null,
  // поэтому повторное нажатие по такому же событию срабатывает снова.
  useEffect(() => {
    if (!focusTab) return
    setTab(focusTab)
    onFocusHandled?.()
  }, [focusTab])

  const p = profile || {}
  const name = p.name || (isOwnProfile ? 'Без имени' : 'Друг')
  const day = dayOf(date) || { meals: [] }
  const totals = sumDay(day.meals || [])
  const target = p.targets?.calories
  const groups = groupDayByMeal(day)
  const dayEmpty = groups.every((g) => g.foods.length === 0)

  // «Я это обожаю» / «Ок» — не поля анкеты, а факт из дневника. Считаются
  // здесь, потому что дневник есть в обоих режимах: свой — из стора, друга — из
  // friend_state. Отдельного переключателя приватности у них нет: еда друга и
  // так видна на вкладке «Питание», и это тот же самый круг людей.
  const habits = useMemo(() => foodHabits(days), [days])

  const hasSelfDetails = Boolean(p.bio || p.guiltyPleasure || habits.most || habits.rare)

  return (
    <>
      {/* ── Шапка: лицо, имя, друзья ──────────────────────────────────────── */}
      {/* Био здесь больше нет: оно переехало в «О себе», к остальному
          рассказу о себе. В шапке оно висело над всеми тремя вкладками. */}
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Avatar src={p.avatar} name={name} size={112} />
        </div>
        <div style={{ fontSize: 22, fontWeight: 680, letterSpacing: '-0.3px', marginTop: 12 }}>{name}</div>
        {/* Ник показываем и в своём профиле, и в чужом: это адрес человека,
            по которому его находят, а не служебный код. Без приставки «@» —
            так же, как он записан в базе и как его вводят в поиске. */}
        {username && (
          <div style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 3 }}>
            {username}
          </div>
        )}
      </div>

      {/* Счётчики (подписчики / подписки / друзья) приходят сверху отдельным
          узлом: их источник — сервер, а этот компонент работает и без сети,
          на локальном профиле. Раньше здесь стояла одна кнопка «Друзья · N». */}
      {counts}

      {/* Приглашение войти стоит НАД вкладками. Внутри «О себе» оно было бы
          спрятано: эта вкладка теперь третья, и гость до неё не доходит. */}
      {signInPrompt}

      {/* ── Три части профиля ─────────────────────────────────────────────── */}
      <div className="seg" style={{ marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? 'on' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'self' && (
        <>
          {hasSelfDetails ? (
            /* Четыре строки — весь рассказ о себе. Списки «да в еде» / «нет в
               еде» отсюда убраны вместе со всей моделью тегов: их нельзя ни
               завести, ни отредактировать, и в профиле их больше нет. */
            <div className="card" style={{ display: 'grid', gap: 16 }}>
              <ProfileRow label="Био" value={p.bio} multiline />
              <ProfileRow label="Я это обожаю" value={habits.most?.name} />
              <ProfileRow label="Ок" value={habits.rare?.name} />
              <ProfileRow label="MY guilty pleasure" value={p.guiltyPleasure} />
            </div>
          ) : (
            <div className="card">
              <p className="muted" style={{ fontSize: 14 }}>
                {isOwnProfile
                  ? 'Пока пусто. Расскажите о себе — это первое, что видят друзья.'
                  : 'Человек пока ничего о себе не рассказал.'}
              </p>
            </div>
          )}
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
