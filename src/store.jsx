import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase, supabaseEnabled, pullState, pushState } from './lib/supabase.js'

const KEY = 'eataps:v1'
const META = 'eataps:sync'
const LASTUID = 'eataps:lastUid' // чьи данные лежат локально (uid последней синхронизации)
const StoreCtx = createContext(null)

const empty = { profile: null, theme: 'system', days: {}, customFoods: [], customIngredients: [], recents: [], prefs: {} }

// Тема: «система» больше не хранится как режим — при первом запуске берём
// текущую настройку телефона и фиксируем как 'light'/'dark'. Дальше пользователь
// меняет вручную в профиле. 'system' и мусор нормализуются в конкретный режим.
function systemTheme() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function normalizeTheme(t) {
  return t === 'light' || t === 'dark' ? t : systemTheme()
}

// Слияние при входе в СУЩЕСТВУЮЩИЙ аккаунт, когда локальные данные — не его
// (гость, другой аккаунт, свежий опросник). Облако — источник истины для
// профиля (ник, фото, цели); локальные дни/еда/недавние ДОЛИВАЮТСЯ, но никогда
// не перетирают облачные. Это защита от «вошёл — и облако затёрлось дефолтом».
export function mergeCloudOverLocal(cloud, local) {
  const uniqByName = (primary = [], extra = []) => {
    const seen = new Set(primary.map((x) => (x.name || '').toLowerCase()))
    return [...primary, ...extra.filter((x) => !seen.has((x.name || '').toLowerCase()))]
  }
  return {
    ...local,
    ...cloud,
    profile: cloud.profile || local.profile,
    theme: normalizeTheme(cloud.theme || local.theme),
    days: { ...local.days, ...cloud.days },
    customFoods: uniqByName(cloud.customFoods, local.customFoods),
    customIngredients: uniqByName(cloud.customIngredients, local.customIngredients),
    recents: uniqByName(cloud.recents, local.recents).slice(0, 40),
    prefs: { ...local.prefs, ...cloud.prefs },
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    const base = raw ? { ...empty, ...JSON.parse(raw) } : empty
    return { ...base, theme: normalizeTheme(base.theme) } // мигрируем legacy 'system' → конкретный режим
  } catch {
    return { ...empty, theme: systemTheme() }
  }
}

function blankDay() {
  return { meals: [], mood: null, wellbeing: [], note: '' }
}

const authApi = supabaseEnabled
  ? {
      signUpEmail: (email, password) => supabase.auth.signUp({ email, password }),
      signInEmail: (email, password) => supabase.auth.signInWithPassword({ email, password }),
      signInMagic: (email) => supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } }),
      signInOAuth: (provider) => supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } }),
      // wallet — EIP-1193 (Ethereum) или Solana-провайдер из AppKit. Текст ASCII:
      // некоторые кошельки (Phantom) отклоняют кириллицу в сообщении подписи.
      signInWeb3: (chain, wallet) => supabase.auth.signInWithWeb3({ chain, statement: 'Sign in to EatAps', wallet }),
      resetPassword: (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
      // После выхода локальные данные считаются «ничейными»: следующий вход
      // в любой аккаунт возьмёт профиль из облака, а не затрёт его локальным.
      signOut: () => {
        localStorage.removeItem(LASTUID)
        return supabase.auth.signOut()
      },
    }
  : null

export function StoreProvider({ children }) {
  const [state, setState] = useState(load)
  const [session, setSession] = useState(null)
  const [syncStatus, setSyncStatus] = useState('idle') // idle | syncing | synced | error

  const stateRef = useRef(state)
  stateRef.current = state
  const bootRef = useRef(false)
  const suppressPush = useRef(false)
  const pushTimer = useRef(null)

  // persist locally + track local change time
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
      if (bootRef.current) localStorage.setItem(META, String(Date.now()))
      else bootRef.current = true
    } catch {}
  }, [state])

  // theme — тема всегда конкретная ('light'/'dark'); систему больше не «следим»
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', normalizeTheme(state.theme))
  }, [state.theme])

  // auth boot + subscription
  useEffect(() => {
    if (!supabaseEnabled) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // on login → reconcile cloud vs local.
  // Три случая:
  // 1. Локальные данные — от ЭТОГО же аккаунта (lastUid совпал) → честный
  //    last-write-wins по метке времени, как раньше.
  // 2. Локальные данные — чужие/гостевые, а в облаке есть профиль → облако
  //    главнее (ник, фото, цели восстанавливаются), локальные дни доливаются.
  // 3. Облако пустое (новый аккаунт) → заливаем локальное состояние.
  const uid = session?.user?.id
  useEffect(() => {
    if (!supabaseEnabled || !uid) return
    let cancelled = false
    ;(async () => {
      setSyncStatus('syncing')
      try {
        const cloud = await pullState(uid)
        const localTs = Number(localStorage.getItem(META) || 0)
        const sameUser = localStorage.getItem(LASTUID) === uid

        if (cloud && cloud.state?.profile && !sameUser) {
          // Вход в существующий аккаунт с «не его» локальными данными.
          const merged = mergeCloudOverLocal({ ...empty, ...cloud.state }, stateRef.current)
          suppressPush.current = true
          setState(merged)
          const ts = await pushState(uid, merged) // долитые локальные дни — в облако
          localStorage.setItem(META, String(Date.parse(ts)))
        } else if (cloud && sameUser && Date.parse(cloud.updatedAt) > localTs) {
          suppressPush.current = true
          setState({ ...empty, ...cloud.state })
          localStorage.setItem(META, String(Date.parse(cloud.updatedAt)))
        } else {
          const ts = await pushState(uid, stateRef.current)
          localStorage.setItem(META, String(Date.parse(ts)))
        }
        localStorage.setItem(LASTUID, uid)
        if (!cancelled) setSyncStatus('synced')
      } catch {
        if (!cancelled) setSyncStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uid])

  // debounced push on any change while logged in
  useEffect(() => {
    if (!supabaseEnabled || !uid) return
    if (suppressPush.current) {
      suppressPush.current = false
      return
    }
    clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(async () => {
      try {
        setSyncStatus('syncing')
        const ts = await pushState(uid, stateRef.current)
        localStorage.setItem(META, String(Date.parse(ts)))
        setSyncStatus('synced')
      } catch {
        setSyncStatus('error')
      }
    }, 1200)
    return () => clearTimeout(pushTimer.current)
  }, [state, uid])

  const setProfile = useCallback((profile) => setState((s) => ({ ...s, profile })), [])
  const setTheme = useCallback((theme) => setState((s) => ({ ...s, theme })), [])

  const editDay = useCallback((date, fn) => {
    setState((s) => {
      const day = s.days[date] || blankDay()
      return { ...s, days: { ...s.days, [date]: fn({ ...day }) } }
    })
  }, [])

  const addMeal = useCallback((date, meal) => {
    setState((s) => {
      const day = s.days[date] || blankDay()
      const days = { ...s.days, [date]: { ...day, meals: [...day.meals, { id: crypto.randomUUID(), ...meal }] } }
      const snap = {
        name: meal.name,
        emoji: meal.emoji || '🍽️',
        unit: meal.unit || 'г',
        grams: meal.grams ?? null,
        kcal: meal.kcal,
        protein: meal.protein,
        carbs: meal.carbs,
        fat: meal.fat,
      }
      const prev = (s.recents || []).find((r) => r.name === meal.name)
      const rest = (s.recents || []).filter((r) => r.name !== meal.name)
      const recents = [{ ...snap, count: (prev?.count || 0) + 1, ts: Date.now() }, ...rest].slice(0, 40)
      return { ...s, days, recents }
    })
  }, [])

  const removeMeal = useCallback((date, id) => {
    editDay(date, (d) => ({ ...d, meals: d.meals.filter((m) => m.id !== id) }))
  }, [editDay])

  const setMood = useCallback((date, mood) => {
    editDay(date, (d) => ({ ...d, mood }))
  }, [editDay])

  const toggleWellbeing = useCallback((date, tag) => {
    editDay(date, (d) => ({
      ...d,
      wellbeing: d.wellbeing.includes(tag) ? d.wellbeing.filter((t) => t !== tag) : [...d.wellbeing, tag],
    }))
  }, [editDay])

  const addCustomFood = useCallback((food) => {
    const entry = { id: crypto.randomUUID(), ...food }
    setState((s) => {
      const exists = (s.customFoods || []).some((f) => f.name.toLowerCase() === food.name.toLowerCase())
      const customFoods = exists
        ? s.customFoods.map((f) => (f.name.toLowerCase() === food.name.toLowerCase() ? { ...f, ...food, id: f.id } : f))
        : [entry, ...(s.customFoods || [])]
      return { ...s, customFoods }
    })
    return entry
  }, [])

  const removeCustomFood = useCallback((id) => {
    setState((s) => ({ ...s, customFoods: (s.customFoods || []).filter((f) => f.id !== id) }))
  }, [])

  const addCustomIngredient = useCallback((ing) => {
    const entry = { id: crypto.randomUUID(), ...ing }
    setState((s) => {
      const list = s.customIngredients || []
      if (list.some((f) => f.name.toLowerCase() === ing.name.toLowerCase())) return s
      return { ...s, customIngredients: [entry, ...list] }
    })
    return entry
  }, [])

  const setPref = useCallback((key, val) => {
    setState((s) => ({ ...s, prefs: { ...s.prefs, [key]: val } }))
  }, [])

  const resetAll = useCallback(() => {
    // Сброс обнуляет и метки синхронизации: пустое локальное состояние не
    // должно считаться «новее облака» при следующем входе.
    localStorage.removeItem(LASTUID)
    localStorage.removeItem(META)
    setState({ ...empty, theme: systemTheme() })
  }, [])

  const value = {
    ...state,
    customFoods: state.customFoods || [],
    customIngredients: state.customIngredients || [],
    recents: state.recents || [],
    prefs: state.prefs || {},
    dayOf: (date) => state.days[date] || blankDay(),
    setProfile,
    setTheme,
    addMeal,
    removeMeal,
    setMood,
    toggleWellbeing,
    addCustomFood,
    removeCustomFood,
    addCustomIngredient,
    setPref,
    resetAll,
    // auth / sync
    supabaseEnabled,
    session,
    user: session?.user || null,
    syncStatus,
    auth: authApi,
  }

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
