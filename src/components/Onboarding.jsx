import { useState, useEffect, useRef, Suspense } from 'react'
import { useStore } from '../store.jsx'
import { ACTIVITY, GOALS, computeTargets } from '../lib/nutrition.js'
import { lazyWithReload } from '../lib/lazyWithReload.js'
import { hasAnyAccountCache } from '../lib/localCache.js'
import LazyBoundary from './LazyBoundary.jsx'
import Ring from './Ring.jsx'
import AvatarPicker from './AvatarPicker.jsx'
import LanguageButton from './LanguageButton.jsx'
import { t } from '../lib/i18n.js'

// Вход/регистрация тянут тяжёлый Web3-стек (AppKit) — грузим лениво,
// только когда пользователь открывает окно входа.
const AuthSheet = lazyWithReload(() => import('./AuthSheet.jsx'))

// Опросник открывается сразу: интро-экрана над ним больше нет.
const STEPS = ['name', 'sex', 'body', 'activity', 'goal', 'result']

export default function Onboarding() {
  const { setProfile, supabaseEnabled, signedIn } = useStore()
  const [step, setStep] = useState(0)
  const [auth, setAuth] = useState(null) // null | { mode: 'login' | 'register' }
  const registeredRef = useRef(false) // email-регистрация прошла — сохранить анкету при закрытии шторки
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

  // Вошёл в существующий аккаунт. Если в облаке уже есть профиль — App сам
  // переключится на приложение (profile != null, этот компонент размонтируется).
  // Если облако пустое (аккаунт есть, а анкету не заполняли) — остаёмся в
  // опроснике, только закрываем шторку входа.
  useEffect(() => {
    if (!signedIn) return
    setAuth(null)
  }, [signedIn])

  // Аккаунта ещё нет — после опросника предложим его завести. Гостевой путь
  // остаётся: на последнем шаге есть «Продолжить без аккаунта».
  const needsRegister = supabaseEnabled && !signedIn

  return (
    <div className="screen" style={{ paddingBottom: 40 }}>
      <div className="row between" style={{ marginBottom: 22 }}>
        {step > 0
          ? <button className="iconbtn" onClick={back} aria-label={t('common.back')}>‹</button>
          : <div style={{ width: 40 }} />}
        <div style={{ display: 'flex', gap: 6 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ width: i <= step ? 22 : 8, height: 8, borderRadius: 4, background: i <= step ? 'var(--primary)' : 'var(--track)', transition: 'all 0.3s ease' }} />
          ))}
        </div>
        {/* Язык — с первого экрана: человек, открывший приложение не на своём
            языке, иначе не дочитал бы анкету до настроек. */}
        <LanguageButton />
      </div>

      {name === 'name' && (
        <StepShell title={t('onboarding.nameTitle')} hint={t('onboarding.nameHint')}>
          <div style={{ marginBottom: 8 }}>
            <AvatarPicker value={data.avatar} onChange={(a) => set({ avatar: a })} />
          </div>
          <div className="field" style={{ marginTop: 18 }}>
            <label>{t('onboarding.nameLabel')}</label>
            <input className="input" value={data.name} onChange={(e) => set({ name: e.target.value })} maxLength={40} />
          </div>
          <Continue onClick={next} />

          {/* Вход перенесён сюда с бывшего интро-экрана: анкету теперь видно
              сразу, а войти в существующий аккаунт можно с первого шага. */}
          {supabaseEnabled && !signedIn && (
            <>
              <button
                className="btn ghost"
                style={{ marginTop: 12 }}
                onClick={() => setAuth({ mode: 'login' })}
              >
                {t('onboarding.haveAccount')}
              </button>
              {hasAnyAccountCache() && (
                <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 14, textAlign: 'center' }}>
                  {t('onboarding.cachedAccount')}
                </p>
              )}
            </>
          )}
        </StepShell>
      )}

      {name === 'sex' && (
        <StepShell title={t('onboarding.sexTitle')} hint={t('onboarding.sexHint')}>
          <div className="stack">
            <SelectCard on={data.sex === 'male'} onClick={() => set({ sex: 'male' })} emoji="♂" title={t('onboarding.male')} />
            <SelectCard on={data.sex === 'female'} onClick={() => set({ sex: 'female' })} emoji="♀" title={t('onboarding.female')} />
          </div>
          <Continue onClick={next} />
        </StepShell>
      )}

      {name === 'body' && (
        <StepShell title={t('onboarding.bodyTitle')} hint={t('onboarding.bodyHint')}>
          <div className="field">
            <label>{t('onboarding.age')}</label>
            <input className="input" type="number" inputMode="numeric" placeholder="27" value={data.age} onChange={(e) => set({ age: e.target.value })} />
          </div>
          <div className="field">
            <label>{t('onboarding.height')}</label>
            <input className="input" type="number" inputMode="numeric" placeholder="182" value={data.height} onChange={(e) => set({ height: e.target.value })} />
          </div>
          <div className="field">
            <label>{t('onboarding.weight')}</label>
            <input className="input" type="number" inputMode="decimal" placeholder="83" value={data.weight} onChange={(e) => set({ weight: e.target.value })} />
          </div>
          <Continue onClick={next} disabled={!bodyOk} />
        </StepShell>
      )}

      {name === 'activity' && (
        <StepShell title={t('onboarding.activityTitle')} hint={t('onboarding.activityHint')}>
          <div className="stack">
            {Object.entries(ACTIVITY).map(([k, v]) => (
              <SelectCard key={k} on={data.activity === k} onClick={() => set({ activity: k })} title={v.label} sub={`× ${v.factor}`} />
            ))}
          </div>
          <Continue onClick={next} />
        </StepShell>
      )}

      {name === 'goal' && (
        <StepShell title={t('onboarding.goalTitle')} hint={t('onboarding.goalHint')}>
          <div className="stack">
            {Object.entries(GOALS).map(([k, v]) => (
              <SelectCard key={k} on={data.goal === k} onClick={() => set({ goal: k })} title={v.label} sub={v.kcalAdjust === 0 ? t('onboarding.kcalNormal') : t('onboarding.kcalPerDay', { n: `${v.kcalAdjust > 0 ? '+' : ''}${v.kcalAdjust}` })} />
            ))}
          </div>
          <Continue onClick={next} />
        </StepShell>
      )}

      {name === 'result' && targets && (
        <div>
          <div className="eyebrow">{t('onboarding.ready')}</div>
          <h1 className="h1" style={{ margin: '6px 0 24px' }}>{t('onboarding.dailyNorm')}</h1>
          <div className="card" style={{ textAlign: 'center', paddingTop: 28, paddingBottom: 28 }}>
            <Ring value={0} max={targets.calories} size={190}>
              <div>
                <div className="stat-num tabular" style={{ fontSize: 40 }}>{targets.calories}</div>
                <div className="muted" style={{ fontSize: 14 }}>{t('onboarding.kcalADay')}</div>
              </div>
            </Ring>
            <div className="row" style={{ gap: 10, marginTop: 24 }}>
              <MiniStat label={t('macro.protein')} value={targets.protein} />
              <MiniStat label={t('macro.carbs')} value={targets.carbs} />
              <MiniStat label={t('macro.fat')} value={targets.fat} />
            </div>
          </div>
          <div className="card" style={{ marginTop: 14, display: 'flex', justifyContent: 'space-around' }}>
            <SmallKV k={t('onboarding.bmr')} v={t('units.kcalN', { n: targets.bmr })} />
            <div style={{ width: 1, background: 'var(--border)' }} />
            <SmallKV k={t('onboarding.tdee')} v={t('units.kcalN', { n: targets.tdee })} />
          </div>
          {needsRegister ? (
            <>
              <button className="btn" style={{ marginTop: 22 }} onClick={() => setAuth({ mode: 'register' })}>
                {t('onboarding.registerSave')}
              </button>
              <button
                style={{ display: 'block', margin: '14px auto 0', fontSize: 15, color: 'var(--ink-3)', fontWeight: 550 }}
                onClick={finish}
              >
                {t('onboarding.continueGuest')}
              </button>
            </>
          ) : (
            <button className="btn" style={{ marginTop: 22 }} onClick={finish}>{t('onboarding.openApp')}</button>
          )}
        </div>
      )}

      {auth && (
        <LazyBoundary onClose={() => setAuth(null)}>
          <Suspense fallback={null}>
            {/* onBeforeAuth сохраняет анкету до OAuth-редиректа; onRegistered —
                после email-регистрации анкета сохраняется при закрытии шторки,
                чтобы человек успел прочитать «подтвердите почту». */}
            <AuthSheet
              mode={auth.mode}
              onBeforeAuth={finish}
              onRegistered={() => { registeredRef.current = true }}
              onClose={() => {
                setAuth(null)
                if (registeredRef.current) finish()
              }}
            />
          </Suspense>
        </LazyBoundary>
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
    <button onClick={onClick} className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, textAlign: 'start', width: '100%', borderColor: on ? 'var(--primary)' : 'var(--border)', borderWidth: on ? 2 : 1, padding: on ? 15 : 16 }}>
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
  return <button className="btn" style={{ marginTop: 26 }} onClick={onClick} disabled={disabled}>{t('common.continue')}</button>
}

function MiniStat({ label, value }) {
  return (
    <div style={{ flex: 1, background: 'var(--surface-2)', borderRadius: 14, padding: '12px 8px' }}>
      <div className="stat-num tabular" style={{ fontSize: 20 }}>{value}<span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}>{t('units.g')}</span></div>
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
