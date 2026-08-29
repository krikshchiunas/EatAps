// ─────────────────────────────────────────────────────────────────────────────
// «Мои данные и норма» — редактирование анкеты после онбординга.
//
// До этого экрана данные для расчёта (пол, возраст, рост, вес, активность,
// цель) задавались ровно один раз, при первом запуске, и меняться не могли
// вообще: в Настройках они лежали строками без обработчика с подписью
// «Задаются при первом запуске». То есть человек, который сменил цель с
// «похудеть» на «поддерживать» или просто стал старше, был вынужден удалять
// аккаунт. Здесь это чинится.
//
// Ключевое требование к экрану: показывать последствие ДО сохранения. Норма
// пересчитывается на каждое нажатие, и рядом видно, куда поехали калории и
// белок — иначе выбор «умеренная активность» вместо «лёгкой» остаётся для
// человека абстракцией.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useMemo } from 'react'
import { useStore } from '../store.jsx'
import { ACTIVITY, GOALS, computeTargets } from '../lib/nutrition.js'
import { bmi, bmiBand, profileTargets, WEIGHT_MIN, WEIGHT_MAX } from '../lib/body.js'
import { Panel, Group } from './SettingsPanels.jsx'

const AGE_MIN = 10
const AGE_MAX = 100
const HEIGHT_MIN = 120
const HEIGHT_MAX = 230

const num = (v) => (v === '' || v == null ? NaN : Number(v))
const inRange = (v, lo, hi) => Number.isFinite(num(v)) && num(v) >= lo && num(v) <= hi

// Активность описываем словами, а не множителем: «× 1.55» ничего не говорит
// человеку, который не считает TDEE вручную.
// Формулировки повторяют то, что реально делает computeTargets: дефицит
// ограничен четвертью расхода, профицит — пятой частью. Обещать «−500 ккал»
// без оговорки нечестно: для небольшого расхода столько не отнимается.
const GOAL_HINT = {
  lose: 'Минус 500 ккал в день, но не больше четверти расхода',
  maintain: 'Калории по расходу',
  gain: 'Плюс 350 ккал в день, но не больше пятой части расхода',
}

const ACTIVITY_HINT = {
  sedentary: 'Сидячая работа, почти без ходьбы',
  light: 'Прогулки, 1–2 лёгкие тренировки в неделю',
  moderate: '3–5 тренировок в неделю или много ходьбы',
  high: 'Ежедневные тренировки или физическая работа',
}

export default function BodyPanel({ onClose }) {
  const { profile, setProfile } = useStore()
  const [d, setD] = useState(() => ({
    sex: profile?.sex === 'female' ? 'female' : 'male',
    age: profile?.age != null ? String(profile.age) : '',
    height: profile?.height != null ? String(profile.height) : '',
    weight: profile?.weight != null ? String(profile.weight) : '',
    activity: ACTIVITY[profile?.activity] ? profile.activity : 'light',
    goal: GOALS[profile?.goal] ? profile.goal : 'maintain',
    weightGoal: profile?.weightGoal != null ? String(profile.weightGoal) : '',
  }))
  const [saved, setSaved] = useState(false)
  const set = (patch) => { setD((p) => ({ ...p, ...patch })); setSaved(false) }

  const errors = {
    age: d.age !== '' && !inRange(d.age, AGE_MIN, AGE_MAX) ? `от ${AGE_MIN} до ${AGE_MAX}` : null,
    height: d.height !== '' && !inRange(d.height, HEIGHT_MIN, HEIGHT_MAX) ? `от ${HEIGHT_MIN} до ${HEIGHT_MAX} см` : null,
    weight: d.weight !== '' && !inRange(d.weight, WEIGHT_MIN, WEIGHT_MAX) ? `от ${WEIGHT_MIN} до ${WEIGHT_MAX} кг` : null,
    weightGoal: d.weightGoal !== '' && !inRange(d.weightGoal, WEIGHT_MIN, WEIGHT_MAX) ? `от ${WEIGHT_MIN} до ${WEIGHT_MAX} кг` : null,
  }
  const complete = inRange(d.age, AGE_MIN, AGE_MAX) && inRange(d.height, HEIGHT_MIN, HEIGHT_MAX) && inRange(d.weight, WEIGHT_MIN, WEIGHT_MAX)
  const valid = complete && !errors.weightGoal

  const next = useMemo(() => (complete
    ? computeTargets({ sex: d.sex, age: num(d.age), height: num(d.height), weight: num(d.weight), activity: d.activity, goal: d.goal })
    : null), [complete, d.sex, d.age, d.height, d.weight, d.activity, d.goal])

  // Сравниваем с нормой, посчитанной по ТЕКУЩЕЙ анкете, а не с сохранённой:
  // иначе, открыв экран и ничего не тронув, человек видел бы «+8 г белка»
  // просто потому, что формулу с тех пор уточнили.
  const prev = useMemo(() => profileTargets(profile), [profile])
  const b = complete ? bmi(num(d.weight), num(d.height)) : null
  const band = bmiBand(b)

  const save = () => {
    if (!valid || !next) return
    const p = {
      ...profile,
      sex: d.sex,
      age: num(d.age),
      height: num(d.height),
      weight: num(d.weight),
      activity: d.activity,
      goal: d.goal,
      targets: next,
    }
    // Пустое поле = «целевого веса нет». Оставлять старое значение нельзя:
    // человек его сознательно стёр.
    if (inRange(d.weightGoal, WEIGHT_MIN, WEIGHT_MAX)) p.weightGoal = Math.round(num(d.weightGoal) * 10) / 10
    else delete p.weightGoal
    setProfile(p)
    setSaved(true)
  }

  return (
    <Panel title="Мои данные и норма" onClose={onClose}>
      <Group title="Цель" note="Под цель подстраивается дефицит или профицит калорий и норма белка.">
        {Object.entries(GOALS).map(([k, v]) => (
          <Pick key={k} on={d.goal === k} onClick={() => set({ goal: k })} title={v.label}
            sub={GOAL_HINT[k]} />
        ))}
      </Group>

      <Group title="Активность" note="Это средний уровень. Активность отдельного дня отмечается на экране дня и пересчитывает норму именно за тот день.">
        {Object.entries(ACTIVITY).map(([k, v]) => (
          <Pick key={k} on={d.activity === k} onClick={() => set({ activity: k })} title={v.label} sub={ACTIVITY_HINT[k]} />
        ))}
      </Group>

      <Group title="Тело">
        <div className="set-row" style={{ display: 'block' }}>
          <div className="seg" style={{ margin: '2px 0' }}>
            <button className={d.sex === 'male' ? 'on' : ''} onClick={() => set({ sex: 'male' })} aria-pressed={d.sex === 'male'}>Мужской</button>
            <button className={d.sex === 'female' ? 'on' : ''} onClick={() => set({ sex: 'female' })} aria-pressed={d.sex === 'female'}>Женский</button>
          </div>
        </div>
        <NumRow label="Возраст" unit="лет" value={d.age} onChange={(v) => set({ age: v })} error={errors.age} />
        <NumRow label="Рост" unit="см" value={d.height} onChange={(v) => set({ height: v })} error={errors.height} />
        <NumRow label="Вес" unit="кг" value={d.weight} onChange={(v) => set({ weight: v })} error={errors.weight} decimal />
      </Group>

      <Group title="Целевой вес" note="Необязательно. Нужен только для прогноза на графике веса — на норму калорий не влияет. Пустое поле убирает цель.">
        <NumRow label="Хочу весить" unit="кг" value={d.weightGoal} onChange={(v) => set({ weightGoal: v })} error={errors.weightGoal} decimal placeholder="—" />
      </Group>

      {next ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="set-title" style={{ padding: 0, marginBottom: 12 }}>Новая дневная норма</div>
          <div className="row between" style={{ alignItems: 'baseline', marginBottom: 12 }}>
            <span className="stat-num tabular" style={{ fontSize: 34 }}>{next.calories}</span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="muted" style={{ fontSize: 14 }}>ккал в день</span>
              <Delta from={prev?.calories} to={next.calories} />
            </span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <Macro label="Белки" value={next.protein} from={prev?.protein} />
            <Macro label="Углеводы" value={next.carbs} from={prev?.carbs} />
            <Macro label="Жиры" value={next.fat} from={prev?.fat} />
          </div>
          <div className="divider" />
          <KV k="Базовый обмен" v={`${next.bmr} ккал`} />
          <KV k="Расход с активностью" v={`${next.tdee} ккал`} />
          <KV k="Белок" v={`${next.proteinPerKg} г на кг${next.proteinRefWeight !== num(d.weight) ? ` расчётной массы (${next.proteinRefWeight} кг)` : ''}`} />
          {b != null && band && <KV k="ИМТ" v={`${b.toFixed(1)} — ${band.label}`} />}
          {next.proteinRefWeight !== num(d.weight) && (
            <p className="set-note" style={{ padding: 0, marginTop: 10 }}>
              Белок считается не от общего веса, а от скорректированной массы: жировая ткань белок не потребляет,
              и норма «от общего веса» была бы недостижимо большой.
            </p>
          )}
          {b != null && (
            <p className="set-note" style={{ padding: 0, marginTop: 6 }}>
              ИМТ — грубый популяционный ориентир, а не диагноз: он не различает мышцы и жир.
            </p>
          )}
        </div>
      ) : (
        <p className="set-note" style={{ marginBottom: 16 }}>Заполните возраст, рост и вес — покажем норму.</p>
      )}

      <button className="btn" disabled={!valid} onClick={save}>
        {saved ? 'Сохранено ✓' : 'Сохранить'}
      </button>
      <p className="set-note" style={{ marginTop: 10, marginBottom: 24 }}>
        Новая норма применится ко всем дням, где вес и активность не отмечены вручную.
        Уже записанная еда не изменится.
      </p>
    </Panel>
  )
}

function Pick({ on, onClick, title, sub }) {
  return (
    <button className="set-row" onClick={onClick} aria-pressed={on} style={{ alignItems: 'flex-start', textAlign: 'left' }}>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ fontWeight: on ? 650 : 500, color: on ? 'var(--primary)' : 'var(--ink)' }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.4 }}>{sub}</span>}
      </span>
      <span aria-hidden="true" style={{ flex: '0 0 auto', color: on ? 'var(--primary)' : 'var(--ink-3)', fontSize: 17, marginLeft: 10 }}>
        {on ? '●' : '○'}
      </span>
    </button>
  )
}

function NumRow({ label, unit, value, onChange, error, decimal, placeholder }) {
  return (
    <div className="set-row" style={{ alignItems: 'center' }}>
      <span style={{ minWidth: 0, flex: 1 }}>
        {label}
        {error && <span style={{ display: 'block', fontSize: 12, color: 'var(--danger)', marginTop: 2 }}>{error}</span>}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
        <input
          className="input"
          type="number"
          inputMode={decimal ? 'decimal' : 'numeric'}
          value={value}
          placeholder={placeholder}
          aria-label={`${label}, ${unit}`}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 92, height: 40, textAlign: 'right', padding: '0 10px', borderColor: error ? 'var(--danger)' : undefined }}
        />
        <span className="muted" style={{ fontSize: 13, width: 24 }}>{unit}</span>
      </span>
    </div>
  )
}

function Macro({ label, value, from }) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
      <div className="tabular" style={{ fontSize: 19, fontWeight: 650 }}>{value}<span style={{ fontSize: 12, color: 'var(--ink-3)' }}> г</span></div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{label}</div>
      <Delta from={from} to={value} />
    </div>
  )
}

// Разница со старой нормой. Молчит, когда её нет или она нулевая: «+0» —
// это шум, а не информация.
function Delta({ from, to }) {
  if (!Number.isFinite(Number(from)) || !Number.isFinite(Number(to))) return null
  const diff = Math.round(Number(to) - Number(from))
  if (diff === 0) return null
  return (
    <span className="tabular" style={{ fontSize: 12, fontWeight: 600, color: diff > 0 ? 'var(--good)' : 'var(--warn)' }}>
      {diff > 0 ? '+' : '−'}{Math.abs(diff)}
    </span>
  )
}

function KV({ k, v }) {
  return (
    <div className="row between" style={{ fontSize: 13.5, padding: '5px 0', gap: 12 }}>
      <span style={{ color: 'var(--ink-2)' }}>{k}</span>
      <span className="tabular" style={{ color: 'var(--ink)', fontWeight: 550, textAlign: 'right' }}>{v}</span>
    </div>
  )
}
