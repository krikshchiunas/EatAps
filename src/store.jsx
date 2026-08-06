import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { supabase, supabaseEnabled, pullState, pushState, pullSubscription, subscribeToSubscription } from './lib/supabase.js'
import { defaultSubscription, checkout as subCheckout, openBillingPortal as subPortal, subFromRow } from './lib/subscription.js'
import { upsertSection, removeSection, swapCustomOrder, effectiveMealId } from './lib/meals.js'

const KEY = 'eataps:v1'
const META = 'eataps:sync'
const LASTUID = 'eataps:lastUid' // чьи данные лежат локально (uid последней синхронизации)
const StoreCtx = createContext(null)

const empty = { profile: null, theme: 'system', days: {}, customFoods: [], customIngredients: [], recents: [], prefs: {}, subscription: defaultSubscription() }

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
  return { meals: [], mealSections: [], mood: null, wellbeing: [], note: '' }
}

const authApi = supabaseEnabled
  ? {
      signUpEmail: (email, password) => supabase.auth.signUp({ email, password }),
      signInEmail: (email, password) => supabase.auth.signInWithPassword({ email, password }),
      signInMagic: (email) => supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } }),
      // prompt=select_account: Google всегда показывает выбор аккаунта, а не
      // молча входит в прошлый — иначе «выйти и войти в другой» невозможно.
      signInOAuth: (provider) =>
        supabase.auth.signInWithOAuth({
          provider,
          options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
        }),
      // wallet — EIP-1193 (Ethereum) или Solana-провайдер из AppKit. Текст ASCII:
      // некоторые кошельки (Phantom) отклоняют кириллицу в сообщении подписи.
      signInWeb3: (chain, wallet) => supabase.auth.signInWithWeb3({ chain, statement: 'Sign in to EatAps', wallet }),
      resetPassword: (email) => supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin }),
      updatePassword: (password) => supabase.auth.updateUser({ password }),
      // LASTUID при выходе НЕ трогаем: это метка «чьи данные лежат локально».
      // Она нужна, чтобы при входе другого человека на этом устройстве его
      // облако не смешалось с чужими локальными днями (см. reconcile ниже).
      // scope 'local' — выход только с ЭТОГО устройства; по умолчанию Supabase
      // разлогинивает все устройства сразу.
      signOut: () => supabase.auth.signOut({ scope: 'local' }),
    }
  : null

export function StoreProvider({ children }) {
  const [state, setState] = useState(load)
  const [session, setSession] = useState(null)
  const [syncStatus, setSyncStatus] = useState('idle') // idle | syncing | synced | error
  const [recovery, setRecovery] = useState(false) // пришли по ссылке сброса пароля

  const stateRef = useRef(state)
  stateRef.current = state
  const bootRef = useRef(false)
  const suppressPush = useRef(false)
  const pushTimer = useRef(null)
  // Пока reconcile при входе не завершился успешно, авто-push запрещён:
  // иначе при сбое сверки можно затереть облако локальными данными.
  const reconciledRef = useRef(false)
  const [syncTick, setSyncTick] = useState(0) // ручной перезапуск reconcile

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

  // auth boot + subscription. PASSWORD_RECOVERY = пользователь пришёл по
  // ссылке «сброс пароля» — App покажет форму нового пароля.
  useEffect(() => {
    if (!supabaseEnabled) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // on login → reconcile cloud vs local.
  // Четыре случая по владельцу локальных данных (LASTUID):
  // 1. Локальные данные — ЭТОГО аккаунта → честный last-write-wins по времени.
  // 2. Локальные данные — ДРУГОГО аккаунта → не смешиваем: облако полностью
  //    заменяет локальное (чужие дни не должны утечь в этот аккаунт).
  //    Если облако пустое — начинаем с чистого листа (онбординг).
  // 3. Локальные данные гостевые (LASTUID пуст), в облаке есть профиль →
  //    облако главнее, гостевые дни/еда ДОЛИВАЮТСЯ и уходят в облако.
  // 4. Гостевые данные, облако пустое (новый аккаунт) → заливаем локальное.
  const uid = session?.user?.id
  useEffect(() => {
    if (!supabaseEnabled || !uid) return
    let cancelled = false
    reconciledRef.current = false
    ;(async () => {
      setSyncStatus('syncing')
      try {
        const cloud = await pullState(uid)
        const localTs = Number(localStorage.getItem(META) || 0)
        const lastUid = localStorage.getItem(LASTUID)
        const sameUser = lastUid === uid
        const foreignLocal = Boolean(lastUid) && !sameUser

        if (sameUser) {
          if (cloud && Date.parse(cloud.updatedAt) > localTs) {
            suppressPush.current = true
            setState({ ...empty, ...cloud.state })
            localStorage.setItem(META, String(Date.parse(cloud.updatedAt)))
          } else {
            const ts = await pushState(uid, stateRef.current)
            localStorage.setItem(META, String(Date.parse(ts)))
          }
        } else if (foreignLocal) {
          // Устройство с данными другого аккаунта: берём только облако.
          suppressPush.current = true
          if (cloud) {
            setState({ ...empty, ...cloud.state, theme: normalizeTheme(cloud.state?.theme) })
            localStorage.setItem(META, String(Date.parse(cloud.updatedAt)))
          } else {
            setState({ ...empty, theme: normalizeTheme(stateRef.current.theme) })
            localStorage.setItem(META, '0')
          }
        } else if (cloud && cloud.state?.profile) {
          // Гостевые данные + существующий аккаунт: доливаем гостевое в облако.
          const merged = mergeCloudOverLocal({ ...empty, ...cloud.state }, stateRef.current)
          suppressPush.current = true
          setState(merged)
          const ts = await pushState(uid, merged)
          localStorage.setItem(META, String(Date.parse(ts)))
        } else {
          const ts = await pushState(uid, stateRef.current)
          localStorage.setItem(META, String(Date.parse(ts)))
        }
        localStorage.setItem(LASTUID, uid)
        reconciledRef.current = true
        if (!cancelled) setSyncStatus('synced')
      } catch {
        if (!cancelled) setSyncStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uid, syncTick])

  // Подписка Stripe: первичный pull после логина + realtime на изменения.
  useEffect(() => {
    if (!supabaseEnabled || !uid) return
    let cancelled = false
    ;(async () => {
      const row = await pullSubscription(uid)
      if (cancelled) return
      setState((s) => ({ ...s, subscription: subFromRow(row) }))
    })()
    const unsub = subscribeToSubscription(uid, (row) => {
      setState((s) => ({ ...s, subscription: subFromRow(row) }))
    })
    return () => { cancelled = true; unsub() }
  }, [uid])

  // Разлогин → возвращаем FREE (иначе UI останется с чужим тиром до перезагрузки).
  useEffect(() => {
    if (!supabaseEnabled || uid) return
    setState((s) => (s.subscription?.tier === 'FREE' ? s : { ...s, subscription: defaultSubscription() }))
  }, [uid])

  // Возврат из Stripe Checkout: успех — доопрашиваем несколько раз, пока вебхук
  // не запишет активную подписку (обычно приходит за 1–3 сек, но бывает дольше).
  // Затем чистим query, чтобы при обновлении вкладки не повторять цикл.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('checkout')
    if (!outcome) return
    // Убираем query сразу, чтобы визуально ничего не мигало и рефреш не триггерил.
    params.delete('checkout')
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash
    window.history.replaceState(null, '', clean)
    if (outcome !== 'success' || !uid) return
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < 8 && !cancelled; i++) {
        const row = await pullSubscription(uid)
        const next = subFromRow(row)
        setState((s) => ({ ...s, subscription: next }))
        if (next.tier !== 'FREE' && next.status !== 'inactive') break
        await new Promise((r) => setTimeout(r, 1500))
      }
    })()
    return () => { cancelled = true }
  }, [uid])

  // Синк упал (офлайн/сбой) → при возвращении сети повторяем reconcile целиком.
  useEffect(() => {
    if (!supabaseEnabled || !uid || syncStatus !== 'error') return
    const retry = () => setSyncTick((t) => t + 1)
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [uid, syncStatus])

  // debounced push on any change while logged in (только после успешной сверки)
  useEffect(() => {
    if (!supabaseEnabled || !uid) return
    // Сначала гасим флаг «это setState самой синхронизации», чтобы он не
    // застрял и не съел первый настоящий пуш пользователя.
    if (suppressPush.current) {
      suppressPush.current = false
      return
    }
    if (!reconciledRef.current) return
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

  // Продукт внутри приёма пищи (day.meals — плоский список, принадлежность приёму
  // считается через effectiveMealId — см. lib/meals.js). createdAt нужен для
  // авто-времени приёма (время первого добавленного продукта).
  const addFood = useCallback((date, food) => {
    setState((s) => {
      const day = s.days[date] || blankDay()
      const entry = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...food }
      const days = { ...s.days, [date]: { ...day, meals: [...day.meals, entry] } }
      const snap = {
        name: food.name,
        emoji: food.emoji || '🍽️',
        unit: food.unit || 'г',
        grams: food.grams ?? null,
        kcal: food.kcal,
        protein: food.protein,
        carbs: food.carbs,
        fat: food.fat,
      }
      const prev = (s.recents || []).find((r) => r.name === food.name)
      const rest = (s.recents || []).filter((r) => r.name !== food.name)
      const recents = [{ ...snap, count: (prev?.count || 0) + 1, ts: Date.now() }, ...rest].slice(0, 40)
      return { ...s, days, recents }
    })
  }, [])

  const removeFood = useCallback((date, id) => {
    editDay(date, (d) => ({ ...d, meals: d.meals.filter((m) => m.id !== id) }))
  }, [editDay])

  const editFood = useCallback((date, updatedFood) => {
    editDay(date, (d) => ({ ...d, meals: d.meals.map((m) => m.id === updatedFood.id ? updatedFood : m) }))
  }, [editDay])

  // Создание/редактирование приёма пищи (время, showTime, переименование custom).
  const upsertMealSection = useCallback((date, section) => {
    editDay(date, (d) => ({ ...d, mealSections: upsertSection(d, section) }))
  }, [editDay])

  // Удаление ТОЛЬКО пользовательского приёма — вместе со всеми его продуктами
  // (UI обязан спросить подтверждение до вызова, если продукты есть — см. п.9).
  const deleteMealSection = useCallback((date, mealId) => {
    editDay(date, (d) => ({
      ...d,
      mealSections: removeSection(d, mealId),
      meals: d.meals.filter((m) => effectiveMealId(m) !== mealId),
    }))
  }, [editDay])

  // Ручной порядок дополнительных приёмов — кнопки «выше/ниже» (dir: -1/+1).
  const moveMealSection = useCallback((date, mealId, dir) => {
    editDay(date, (d) => ({ ...d, mealSections: swapCustomOrder(d, mealId, dir) }))
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

  const setSubscription = useCallback((sub) => {
    setState((s) => ({ ...s, subscription: { ...defaultSubscription(), ...sub } }))
  }, [])

  // Тянем актуальную подписку из Supabase (webhook — источник истины).
  const refreshSubscription = useCallback(async () => {
    if (!uid) return null
    const row = await pullSubscription(uid)
    const next = subFromRow(row)
    setState((s) => ({ ...s, subscription: next }))
    return next
  }, [uid])

  // Покупка: редирект на Stripe Checkout. Реальное состояние приедет по
  // вебхуку в таблицу subscriptions → Realtime канал внизу обновит store.
  const purchaseSubscription = useCallback(async (tier) => {
    return subCheckout(tier, { session })
  }, [session])

  // Портал Stripe: смена карты, апгрейд/даунгрейд, отмена — всё внутри Stripe.
  const openSubscriptionPortal = useCallback(async () => {
    return subPortal({ session })
  }, [session])

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
    subscription: state.subscription || defaultSubscription(),
    dayOf: (date) => state.days[date] || blankDay(),
    setProfile,
    setTheme,
    addFood,
    removeFood,
    editFood,
    upsertMealSection,
    deleteMealSection,
    moveMealSection,
    setMood,
    toggleWellbeing,
    addCustomFood,
    removeCustomFood,
    addCustomIngredient,
    setPref,
    setSubscription,
    purchaseSubscription,
    openSubscriptionPortal,
    refreshSubscription,
    resetAll,
    // auth / sync
    supabaseEnabled,
    session,
    user: session?.user || null,
    syncStatus,
    auth: authApi,
    recovery,
    clearRecovery: () => setRecovery(false),
  }

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
