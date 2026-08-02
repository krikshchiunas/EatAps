import { useState } from 'react'
import { useStore } from '../store.jsx'
import { ACTIVITY, GOALS, computeTargets } from '../lib/nutrition.js'
import Ring from './Ring.jsx'
import AvatarPicker from './AvatarPicker.jsx'

const STEPS = ['intro', 'name', 'sex', 'body', 'activity', 'goal', 'result']

export default function Onboarding() {
  const { setProfile } = useStore()
  const [step, setStep] = useState(0)
  const [data, setData] = useState({ name: '', avatar: null, sex: 'male', age: '', height: '', weight: '', activity: 'moderate', goal: 'maintain' })

  const set = (patch) => setData((d) => ({ ...d, ...patch }))
  const name = STEPS[step]
  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1))
  const back = () => setStep((s) => Math.max(s - 1, 0))

  const bodyOk = data.age >= 10 && data.age <= 100 && data.height >= 120 && data.height <= 230 && data.weight >= 30 && data.weight <= 250

  const targets = bodyOk
    ? computeTargets({ ...data, age: +data.age, height: +data.height, weight: +data.weight })
    : null

  const finish = () => {
    setProfile({
      name: data.name.trim() || undefined,
      avatar: data.avatar || undefined,
      sex: data.sex,
      age: +data.age,
      height: +data.height,
      weight: +data.weight,
      activity: data.activity,
      goal: data.goal,
      targets,
      createdAt: Date.now(),
    })
  }

  return (
    <div className="screen" style={{ paddingBottom: 40 }}>
      {step > 0 && (
        <div className="row between" style={{ marginBottom: 22 }}>
          <button className="iconbtn" onClick={back} aria-label="Назад">‹</button>
          <div style={{ display: 'flex', gap: 6 }}>
            {STEPS.slice(1).map((_, i) => (
              <div key={i} style={{ width: i + 1 <= step ? 22 : 8, height: 8, borderRadius: 4, background: i + 1 <= step ? 'var(--primary)' : 'var(--track)', transition: 'all 0.3s ease' }} />
            ))}
          </div>
          <div style={{ width: 40 }} />
        </div>
      )}

      {name === 'intro' && (
        <div style={{ paddingTop: 40, textAlign: 'center' }}>
          <img src="/icon-192.png" width="80" height="80" style={{ borderRadius: 25, margin: '0 auto 24px', display: 'block', boxShadow: 'var(--shadow-card)' }} alt="" />
          <div className="eyebrow">EatAps</div>
          <h1 className="h1" style={{ margin: '8px 0 12px' }}>Больше здоровья<br />за меньше денег</h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 320, margin: '0 auto 40px' }}>
            Ответьте на несколько вопросов — и мы рассчитаем вашу персональную дневную норму калорий и белка.
          </p>
          <button className="btn" onClick={next}>Начать</button>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 16 }}>Займёт меньше минуты</p>
        </div>
      )}

      {name === 'name' && (
        <StepShell title="Как вас зовут?" hint="Имя увидят друзья. Фото — по желанию.">
          <div style={{ marginBottom: 8 }}>
            <AvatarPicker value={data.avatar} onChange={(a) => set({ avatar: a })} />
          </div>
          <div className="field" style={{ marginTop: 18 }}>
            <label>Имя или никнейм</label>
            <input className="input" value={data.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
          </div>
          <Continue onClick={next} />
        </StepShell>
      )}

      {name === 'sex' && (
        <StepShell title="Ваш пол" hint="Нужно для точного расчёта обмена веществ">
          <div className="stack">
            <SelectCard on={data.sex === 'male'} onClick={() => set({ sex: 'male' })} emoji="♂" title="Мужской" />
            <SelectCard on={data.sex === 'female'} onClick={() => set({ sex: 'female' })} emoji="♀" title="Женский" />
          </div>
          <Continue onClick={next} />
        </StepShell>
      )}

      {name === 'body' && (
        <StepShell title="Основные данные" hint="Возраст, рост и вес">
          <div className="field">
            <label>Возраст, лет</label>
            <input className="input" type="number" inputMode="numeric" placeholder="27" value={data.age} onChange={(e) => set({ age: e.target.value })} />
          </div>
          <div className="field">
            <label>Рост, см</label>
            <input className="input" type="number" inputMode="numeric" placeholder="182" value={data.height} onChange={(e) => set({ height: e.target.value })} />
          </div>
          <div className="field">
            <label>Вес, кг</label>
            <input className="input" type="number" inputMode="decimal" placeholder="83" value={data.weight} onChange={(e) => set({ weight: e.target.value })} />
          </div>
          <Continue onClick={next} disabled={!bodyOk} />
        </StepShell>
      )}

      {name === 'activity' && (
        <StepShell title="Уровень активности" hint="Как часто вы двигаетесь и тренируетесь">
          <div className="stack">
            {Object.entries(ACTIVITY).map(([k, v]) => (
              <SelectCard key={k} on={data.activity === k} onClick={() => set({ activity: k })} title={v.label} sub={`× ${v.factor}`} />
            ))}
          </div>
          <Continue onClick={next} />
        </StepShell>
      )}

      {name === 'goal' && (
        <StepShell title="Ваша цель" hint="Под неё подстроим норму калорий и белка">
          <div className="stack">
            {Object.entries(GOALS).map(([k, v]) => (
              <SelectCard key={k} on={data.goal === k} onClick={() => set({ goal: k })} title={v.label} sub={v.kcalAdjust === 0 ? 'калории по норме' : `${v.kcalAdjust > 0 ? '+' : ''}${v.kcalAdjust} ккал/день`} />
            ))}
          </div>
          <Continue onClick={next} />
        </StepShell>
      )}

      {name === 'result' && targets && (
        <div>
          <div className="eyebrow">Ваш профиль готов</div>
          <h1 className="h1" style={{ margin: '6px 0 24px' }}>Дневная норма</h1>
          <div className="card" style={{ textAlign: 'center', paddingTop: 28, paddingBottom: 28 }}>
            <Ring value={0} max={targets.calories} size={190}>
              <div>
                <div className="stat-num tabular" style={{ fontSize: 40 }}>{targets.calories}</div>
                <div className="muted" style={{ fontSize: 14 }}>ккал в день</div>
              </div>
            </Ring>
            <div className="row" style={{ gap: 10, marginTop: 24 }}>
              <MiniStat label="Белки" value={targets.protein} />
              <MiniStat label="Углеводы" value={targets.carbs} />
              <MiniStat label="Жиры" value={targets.fat} />
            </div>
          </div>
          <div className="card" style={{ marginTop: 14, display: 'flex', justifyContent: 'space-around' }}>
            <SmallKV k="Базовый обмен" v={`${targets.bmr} ккал`} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <SmallKV k="С активностью" v={`${targets.tdee} ккал`} />
          </div>
          <button className="btn" style={{ marginTop: 22 }} onClick={finish}>Открыть приложение</button>
        </div>
      )}
    </div>
  )
}

function StepShell({ title, hint, children }) {
  return (
    <div>
      <h1 className="h1">{title}</h1>
      <p className="muted" style={{ margin: '8px 0 26px' }}>{hint}</p>
      {children}
    </div>
  )
}

function SelectCard({ on, onClick, emoji, title, sub }) {
  return (
    <button onClick={onClick} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', width: '100%', borderColor: on ? 'var(--primary)' : 'var(--border)', borderWidth: on ? 2 : 1, padding: on ? 15 : 16 }}>
      {emoji && <span style={{ fontSize: 24, width: 30, textAlign: 'center', color: on ? 'var(--primary)' : 'var(--ink-3)' }}>{emoji}</span>}
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontSize: 17, fontWeight: 600 }}>{title}</span>
        {sub && <span style={{ display: 'block', fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</span>}
      </span>
      <span style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${on ? 'var(--primary)' : 'var(--border-strong)'}`, display: 'grid', placeItems: 'center' }}>
        {on && <span style={{ width: 11, height: 11, borderRadius: '50%', background: 'var(--primary)' }} />}
      </span>
    </button>
  )
}

function Continue({ onClick, disabled }) {
  return <button className="btn" style={{ marginTop: 26 }} onClick={onClick} disabled={disabled}>Продолжить</button>
}

function MiniStat({ label, value }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 14, padding: '12px 8px' }}>
      <div className="stat-num tabular" style={{ fontSize: 20 }}>{value}<span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}>г</span></div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function SmallKV({ k, v }) {
  return (
    <div style={{ textAlign: 'center', flex: 1 }}>
      <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>{k}</div>
      <div className="tabular" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{v}</div>
    </div>
  )
}
