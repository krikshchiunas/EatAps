import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase, supabaseEnabled, pullState, pushState } from './lib/supabase.js'

const KEY = 'eataps:v1'
const META = 'eataps:sync'
const StoreCtx = createContext(null)

const empty = { profile: null, theme: 'system', days: {}, customFoods: [], customIngredients: [], recents: [], prefs: {} }

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return empty
    return { ...empty, ...JSON.parse(raw) }
  } catch {
    return empty
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
      signOut: () => supabase.auth.signOut(),
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

  // theme
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      root.setAttribute('data-theme', state.theme === 'system' ? sys : state.theme)
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    if (state.theme === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [state.theme])

  // auth boot + subscription
  useEffect(() => {
    if (!supabaseEnabled) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  // on login → reconcile cloud vs local (last-write-wins)
  const uid = session?.user?.id
  useEffect(() => {
    if (!supabaseEnabled || !uid) return
    let cancelled = false
    ;(async () => {
      setSyncStatus('syncing')
      try {
        const cloud = await pullState(uid)
        const localTs = Number(localStorage.getItem(META) || 0)
        if (cloud && Date.parse(cloud.updatedAt) > localTs) {
          suppressPush.current = true
          setState({ ...empty, ...cloud.state })
        } else {
          const ts = await pushState(uid, stateRef.current)
          localStorage.setItem(META, String(Date.parse(ts)))
        }
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

  const resetAll = useCallback(() => setState(empty), [])

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
