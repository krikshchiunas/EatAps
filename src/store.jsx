import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react'
import { StoreCtx, useStore } from './lib/storeContext.js'
import {
  supabase, supabaseEnabled, pullState, saveAppState, subscribeToAppState,
  pullSubscription, subscribeToSubscription, removeAllRealtimeChannels,
} from './lib/supabase.js'
import { defaultSubscription, checkout as subCheckout, openBillingPortal as subPortal, subFromRow } from './lib/subscription.js'
import { upsertSection, removeSection, swapCustomOrder, effectiveMealId } from './lib/meals.js'
import { createClock } from './lib/hlc.js'
import { getDeviceId } from './lib/deviceId.js'
import { newId } from './lib/uuid.js'
import {
  emptyMeta, blankDay, pickSyncable, normalizeState, mergeState, sameSyncable, clearedState,
  addTombstone, setDayFieldTs, setPrefTs,
  tombMeal, tombSection, tombCustomFood, tombCustomIngredient,
} from './lib/syncModel.js'
import { createSyncEngine, SYNC } from './lib/syncEngine.js'
import { PHASE, authReducer, initialAuthState, isBooting, isSignedIn, canSync } from './lib/authState.js'
import { GUEST, clearCache, clockStorage, migrateLegacyCache, readCache, writeCache } from './lib/localCache.js'
import { normalizeError } from './lib/authErrors.js'
import { onAuthSignal, postAuthSignal } from './lib/tabBus.js'
import { setUpdateSafetyCheck } from './lib/swUpdate.js'
import { log, shortId } from './lib/log.js'

// useStore живёт в lib/storeContext.js, но импортируется отовсюду как
// `from '../store.jsx'` — реэкспортируем, чтобы не трогать все компоненты.
export { useStore }

// Пустое состояние. theme = null означает «пользователь не выбирал» — тогда
// берём системную тему. Раньше системная фиксировалась в состояние при первом
// запуске и уезжала в облако, из-за чего смена темы на одном устройстве
// прилетала на все остальные.
const empty = {
  profile: null,
  theme: null,
  days: {},
  customFoods: [],
  customIngredients: [],
  recents: [],
  prefs: {},
  meta: emptyMeta(),
  subscription: defaultSubscription(),
}

// ── Тема ─────────────────────────────────────────────────────────────────────
const THEME_MIRROR = 'eataps:theme' // отдельный ключ только ради первой отрисовки

function systemTheme() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readThemeMirror() {
  try {
    const v = localStorage.getItem(THEME_MIRROR)
    return v === 'light' || v === 'dark' ? v : null
  } catch { return null }
}

export function effectiveTheme(theme) {
  return theme === 'light' || theme === 'dark' ? theme : systemTheme()
}

// Тему ставим до первого рендера: иначе тёмная тема моргает белым, пока грузится
// состояние аккаунта.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', effectiveTheme(readThemeMirror()))
}

// ── Часы устройства ──────────────────────────────────────────────────────────
// Один экземпляр на всё приложение: метки должны монотонно расти независимо от
// того, кто вошёл и сколько раз пересобрался React-дерево.
const clock = createClock({
  deviceId: typeof window === 'undefined' ? '00000000' : getDeviceId(),
  load: clockStorage.load,
  save: clockStorage.save,
})

// ── Транспорт для движка синхронизации ───────────────────────────────────────
const transport = {
  pull: (uid) => pullState(uid),
  save: (state, baseRevision) => saveAppState(state, baseRevision),
  subscribe: (uid, cb) => subscribeToAppState(uid, cb),
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
    }
  : null

export function StoreProvider({ children }) {
  const [auth, dispatch] = useReducer(authReducer, undefined, initialAuthState)
  const [state, setState] = useState(empty)
  const [syncStatus, setSyncStatus] = useState(SYNC.IDLE)
  // Счётчик для ручного перезапуска загрузки данных аккаунта.
  const [dataNonce, setDataNonce] = useState(0)

  const uid = auth.userId
  const recovering = auth.recovering
  const phase = auth.phase

  const stateRef = useRef(state)
  stateRef.current = state
  const engineRef = useRef(null)
  const engineOwnerRef = useRef(null) // uid, для которого движок реально запущен
  const authRef = useRef(auth)
  authRef.current = auth

  // ── 1. Загрузка: единственный источник событий авторизации ────────────────
  // Ни одного параллельного getSession(): supabase-js сам присылает
  // INITIAL_SESSION с восстановленной сессией. Два источника раньше гонялись,
  // и более медленный затирал более свежий результат.
  useEffect(() => {
    if (!supabaseEnabled) {
      migrateLegacyCache()
      dispatch({ type: 'INITIAL_SESSION', session: null })
      return
    }

    migrateLegacyCache()
    let alive = true

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return
      log.auth(event, { user: shortId(session?.user?.id) })
      switch (event) {
        case 'INITIAL_SESSION': dispatch({ type: 'INITIAL_SESSION', session }); break
        case 'SIGNED_IN': dispatch({ type: 'SIGNED_IN', session }); break
        case 'TOKEN_REFRESHED': dispatch({ type: 'TOKEN_REFRESHED', session }); break
        case 'USER_UPDATED': dispatch({ type: 'USER_UPDATED', session }); break
        case 'PASSWORD_RECOVERY': dispatch({ type: 'PASSWORD_RECOVERY', session }); break
        case 'SIGNED_OUT': dispatch({ type: 'SIGNED_OUT' }); break
        default: break
      }
    })

    // Страховка: если INITIAL_SESSION почему-то не пришёл (недоступное
    // хранилище, зависший запрос), не оставляем приложение в вечной загрузке.
    //
    // getSession() тоже гоняем наперегонки с таймаутом: при мёртвой сети он
    // умеет висеть на обновлении токена сколь угодно долго, и тогда страховка
    // от бесконечной загрузки сама превращалась бы в бесконечную загрузку.
    const guard = setTimeout(async () => {
      if (!alive || authRef.current.phase !== PHASE.INITIALIZING) return
      let session = null
      try {
        const res = await Promise.race([
          supabase.auth.getSession(),
          new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
        ])
        session = res?.data?.session || null
      } catch {}
      if (alive) dispatch({ type: 'INIT_TIMEOUT', session })
    }, 6000)

    return () => {
      alive = false
      clearTimeout(guard)
      data.subscription.unsubscribe()
    }
  }, [])

  // ── 2. Гость: состояние живёт в отдельном локальном кэше ──────────────────
  // AUTH_ERROR (сессия оказалась мёртвой) обрабатывается здесь же и это
  // важно: без него приватные данные ушедшего пользователя оставались бы на
  // экране после автоматического выхода — приложение считало бы его гостем,
  // но продолжало рисовать его дневник.
  useEffect(() => {
    if (phase !== PHASE.ANONYMOUS && phase !== PHASE.AUTH_ERROR) return
    const cached = readCache(GUEST)
    setState((s) => ({
      ...empty,
      theme: readThemeMirror(),           // оформление — настройка устройства, выход её не сбрасывает
      ...(cached ? normalizeState(cached.state) : null),
      subscription: s.subscription,
    }))
    setSyncStatus(SYNC.IDLE)
  }, [phase])

  // ── 3. Аккаунт: один движок синхронизации на пользователя ─────────────────
  // Эффект пересоздаётся только при смене uid / выходе из recovery / ручном
  // повторе. Смена фазы (loading → ready) движок НЕ трогает — иначе он
  // останавливался бы сразу после успешного старта.
  useEffect(() => {
    if (!supabaseEnabled || !uid || recovering) return

    let alive = true
    const ownerAtStart = uid

    // Чей кэш берём за основу. Свой — если он есть. Если человек только что
    // зарегистрировался/вошёл впервые на этом устройстве, «усыновляем»
    // гостевые данные (заполненная анкета, дневник до регистрации).
    const own = readCache(ownerAtStart)
    const guest = own ? null : readCache(GUEST)
    const seed = own?.state || guest?.state || null

    // Показываем кэш немедленно: приложение работает офлайн и не мигает
    // пустыми экранами, пока идёт запрос к серверу.
    setState((s) => ({ ...empty, ...(seed ? normalizeState(seed) : null), subscription: s.subscription }))

    const engine = createSyncEngine({
      userId: ownerAtStart,
      transport,
      clock,
      cache: {
        read: () => readCache(ownerAtStart),
        write: (rec) => writeCache(ownerAtStart, rec),
        clear: () => clearCache(ownerAtStart),
      },
      onState: (next) => {
        if (!alive) return
        setState((s) => ({ ...s, ...next }))
      },
      onStatus: (st) => { if (alive) setSyncStatus(st) },
      onFatal: (err) => {
        // Единственный автоматический выход — мёртвый refresh token. Всё
        // остальное (сеть, RLS, конфликт) выходом из аккаунта не лечится.
        if (!alive) return
        log.error('auth', 'сессия недействительна — выходим локально', err)
        supabase.auth.signOut({ scope: 'local' }).catch(() => {})
        dispatch({ type: 'SESSION_INVALID', error: err })
      },
    })

    engineRef.current = engine
    engineOwnerRef.current = ownerAtStart

    engine.start(seed || empty).then((res) => {
      if (!alive) return
      if (guest) clearCache(GUEST) // гостевые данные усыновлены — на устройстве их больше нет
      if (!res?.fatal) dispatch({ type: 'DATA_LOADED', userId: ownerAtStart })
      if (res?.offline) dispatch({ type: 'DATA_OFFLINE', userId: ownerAtStart })
    }).catch((e) => {
      // Без этой ветки любая неожиданная ошибка внутри start() оставляла бы
      // приложение навсегда в фазе загрузки — то есть на бесконечном спиннере.
      // Данные из кэша уже показаны, поэтому просто выпускаем интерфейс.
      if (!alive) return
      log.error('sync', 'запуск синхронизации не удался', e)
      setSyncStatus(SYNC.ERROR)
      dispatch({ type: 'DATA_LOADED', userId: ownerAtStart })
    })

    return () => {
      alive = false
      engine.stop()
      if (engineRef.current === engine) {
        engineRef.current = null
        engineOwnerRef.current = null
      }
    }
  }, [uid, recovering, dataNonce])

  // ── 4. Любое изменение состояния уходит в конвейер ────────────────────────
  // Один вызов, без флагов «это не пользовательское изменение»: движок сам
  // сравнивает состояние с уже известным и не отправляет то, что не менялось.
  // Поэтому гидратация с сервера не порождает обратную запись.
  useEffect(() => {
    if (!canSync(authRef.current)) return
    if (engineOwnerRef.current !== uid) return
    engineRef.current?.push(state)
  }, [state, uid, phase])

  useEffect(() => {
    if (phase !== PHASE.ANONYMOUS) return
    writeCache(GUEST, { state: pickSyncable(state), revision: 0, dirty: false })
  }, [state, phase])

  // ── 5. Тема ───────────────────────────────────────────────────────────────
  // Пока состояние аккаунта не загружено (и после выхода) state.theme пуст —
  // тогда берём последний явный выбор из зеркального ключа. Иначе оформление
  // на секунду перекидывало бы в системную тему при каждом входе и выходе.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', effectiveTheme(state.theme || readThemeMirror()))
    if (!state.theme) return
    try { localStorage.setItem(THEME_MIRROR, state.theme) } catch {}
  }, [state.theme])

  // ── 6. Другие вкладки ─────────────────────────────────────────────────────
  // Состояние: вкладки пишут в один ключ localStorage, событие storage
  // говорит «сосед сохранил» — сливаем и показываем без перезагрузки.
  const storageOwner = uid || (phase === PHASE.ANONYMOUS ? GUEST : null)
  useEffect(() => {
    if (!storageOwner) return
    const key = `eataps:state:${storageOwner}`
    const onStorage = (e) => {
      if (e.key !== key || !e.newValue) return
      try {
        const rec = JSON.parse(e.newValue)
        if (!rec?.state) return
        setState((s) => {
          const merged = mergeState(rec.state, pickSyncable(s))
          // Если слияние ничего не изменило — не трогаем состояние. Иначе две
          // вкладки бесконечно пересохраняли бы друг другу одно и то же.
          return sameSyncable(merged, s) ? s : { ...s, ...merged }
        })
      } catch {}
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [storageOwner])

  // Вход/выход в соседней вкладке. supabase-js такие события между вкладками
  // не рассылает — без этого одна вкладка оставалась «залогиненной» после
  // выхода в другой.
  useEffect(() => {
    if (!supabaseEnabled) return
    return onAuthSignal(async (kind) => {
      const cur = authRef.current
      if (kind === 'signed-out') {
        if (!cur.userId) return
        // Хранилище уже очищено соседом; гасим собственную сессию в памяти.
        try { await supabase.auth.signOut({ scope: 'local' }) } catch {}
        dispatch({ type: 'SIGNED_OUT' })
      } else if (kind === 'signed-in') {
        if (cur.userId) return
        try {
          const { data } = await supabase.auth.getSession()
          if (data?.session) dispatch({ type: 'SIGNED_IN', session: data.session })
        } catch {}
      }
    })
  }, [])

  // ── 7. Сеть, фон, возврат на вкладку ──────────────────────────────────────
  // Realtime сам по себе не гарантия: пока вкладка спала или сети не было,
  // события могли не дойти. Поэтому при возвращении делаем контрольную сверку.
  useEffect(() => {
    if (!uid) return
    const engine = () => (engineOwnerRef.current === uid ? engineRef.current : null)

    const onOnline = () => { engine()?.retryNow(); engine()?.refresh() }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      // Долгий сон мобильного браузера мог остановить авто-refresh токена.
      supabase?.auth?.getSession?.().catch(() => {})
      engine()?.refresh()
    }
    // Уход со страницы: пробуем дослать накопленное. Даже если не успеем —
    // изменения уже в локальном кэше и уедут при следующем запуске.
    const onHide = () => { engine()?.flush().catch(() => {}) }

    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', onHide)
    }
  }, [uid])

  // Новая версия PWA применяется только когда всё сохранено: перезагрузка
  // посреди отправки — самый обидный способ потерять последнюю правку.
  useEffect(() => {
    setUpdateSafetyCheck(() => !engineRef.current?.hasPendingChanges)
  }, [syncStatus])

  // ── 8. Подписка Stripe (серверный источник истины, вне app_state) ─────────
  useEffect(() => {
    if (!supabaseEnabled || !uid || recovering) return
    let alive = true
    ;(async () => {
      const row = await pullSubscription(uid)
      if (!alive) return
      setState((s) => ({ ...s, subscription: subFromRow(row) }))
    })()
    const unsub = subscribeToSubscription(uid, (row) => {
      if (alive) setState((s) => ({ ...s, subscription: subFromRow(row) }))
    })
    return () => { alive = false; unsub() }
  }, [uid, recovering])

  // Разлогин → возвращаем FREE (иначе UI останется с чужим тиром до перезагрузки).
  useEffect(() => {
    if (uid) return
    setState((s) => (s.subscription?.tier === 'FREE' ? s : { ...s, subscription: defaultSubscription() }))
  }, [uid])

  // Возврат из Stripe Checkout: успех — доопрашиваем несколько раз, пока вебхук
  // не запишет активную подписку (обычно приходит за 1–3 сек, но бывает дольше).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('checkout')
    if (!outcome) return
    params.delete('checkout')
    const clean = window.location.pathname + (params.toString() ? `?${params}` : '') + window.location.hash
    window.history.replaceState(null, '', clean)
    if (outcome !== 'success' || !uid) return
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < 8 && !cancelled; i++) {
        const row = await pullSubscription(uid)
        if (cancelled) return
        const next = subFromRow(row)
        setState((s) => ({ ...s, subscription: next }))
        if (next.tier !== 'FREE' && next.status !== 'inactive') break
        await new Promise((r) => setTimeout(r, 1500))
      }
    })()
    return () => { cancelled = true }
  }, [uid])

  // ── 9. Мутации ────────────────────────────────────────────────────────────
  // Метка времени берётся ДО setState: React в StrictMode вызывает функцию
  // обновления дважды, и tick() внутри неё сжигал бы две метки на одну правку.

  const setProfile = useCallback((profile) => {
    const ts = clock.tick()
    setState((s) => ({ ...s, profile, meta: { ...s.meta, profileTs: ts } }))
  }, [])

  const setTheme = useCallback((theme) => {
    const ts = clock.tick()
    setState((s) => ({ ...s, theme, meta: { ...s.meta, themeTs: ts } }))
  }, [])

  // Правка дня: fn получает день, ts — уже готовую метку для новых записей.
  const editDay = useCallback((date, fn) => {
    const ts = clock.tick()
    setState((s) => {
      const day = s.days[date] || blankDay()
      const next = fn({ ...day }, ts)
      return { ...s, days: { ...s.days, [date]: next } }
    })
  }, [])

  const addFood = useCallback((date, food) => {
    const ts = clock.tick()
    const id = newId()
    const createdAt = new Date().toISOString()
    setState((s) => {
      const day = s.days[date] || blankDay()
      const entry = { id, createdAt, ...food, updatedAt: ts }
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

  // Удаление оставляет тумбстоун: без него запись «воскресала» из копии другого
  // устройства при следующем слиянии.
  const removeFood = useCallback((date, id) => {
    const ts = clock.tick()
    setState((s) => {
      const day = s.days[date] || blankDay()
      const days = { ...s.days, [date]: { ...day, meals: day.meals.filter((m) => m.id !== id) } }
      return { ...s, days, meta: addTombstone(s.meta, tombMeal(date, id), ts) }
    })
  }, [])

  const editFood = useCallback((date, updatedFood) => {
    editDay(date, (d, ts) => ({
      ...d,
      meals: d.meals.map((m) => (m.id === updatedFood.id ? { ...updatedFood, updatedAt: ts } : m)),
    }))
  }, [editDay])

  const upsertMealSection = useCallback((date, section) => {
    editDay(date, (d, ts) => ({ ...d, mealSections: upsertSection(d, { ...section, updatedAt: ts }) }))
  }, [editDay])

  // Удаление пользовательского приёма — вместе со всеми его продуктами.
  const deleteMealSection = useCallback((date, mealId) => {
    const ts = clock.tick()
    setState((s) => {
      const day = s.days[date] || blankDay()
      const doomed = day.meals.filter((m) => effectiveMealId(m) === mealId)
      let meta = addTombstone(s.meta, tombSection(date, mealId), ts)
      for (const m of doomed) meta = addTombstone(meta, tombMeal(date, m.id), ts)
      const next = {
        ...day,
        mealSections: removeSection(day, mealId),
        meals: day.meals.filter((m) => effectiveMealId(m) !== mealId),
      }
      return { ...s, days: { ...s.days, [date]: next }, meta }
    })
  }, [])

  const moveMealSection = useCallback((date, mealId, dir) => {
    editDay(date, (d, ts) => ({
      ...d,
      mealSections: swapCustomOrder(d, mealId, dir).map((sec) => ({ ...sec, updatedAt: ts })),
    }))
  }, [editDay])

  // Скаляры дня версионируются отдельно от списка продуктов: правка настроения
  // на телефоне не должна конфликтовать с добавлением еды на компьютере.
  const setMood = useCallback((date, mood) => {
    const ts = clock.tick()
    setState((s) => {
      const day = s.days[date] || blankDay()
      return {
        ...s,
        days: { ...s.days, [date]: { ...day, mood } },
        meta: setDayFieldTs(s.meta, date, 'mood', ts),
      }
    })
  }, [])

  const toggleWellbeing = useCallback((date, tag) => {
    const ts = clock.tick()
    setState((s) => {
      const day = s.days[date] || blankDay()
      const wellbeing = day.wellbeing.includes(tag)
        ? day.wellbeing.filter((t) => t !== tag)
        : [...day.wellbeing, tag]
      return {
        ...s,
        days: { ...s.days, [date]: { ...day, wellbeing } },
        meta: setDayFieldTs(s.meta, date, 'wellbeing', ts),
      }
    })
  }, [])

  const addCustomFood = useCallback((food) => {
    const ts = clock.tick()
    const entry = { id: newId(), ...food, updatedAt: ts }
    setState((s) => {
      const list = s.customFoods || []
      const exists = list.some((f) => f.name.toLowerCase() === food.name.toLowerCase())
      const customFoods = exists
        ? list.map((f) => (f.name.toLowerCase() === food.name.toLowerCase() ? { ...f, ...food, id: f.id, updatedAt: ts } : f))
        : [entry, ...list]
      return { ...s, customFoods }
    })
    return entry
  }, [])

  const removeCustomFood = useCallback((id) => {
    const ts = clock.tick()
    setState((s) => ({
      ...s,
      customFoods: (s.customFoods || []).filter((f) => f.id !== id),
      meta: addTombstone(s.meta, tombCustomFood(id), ts),
    }))
  }, [])

  const addCustomIngredient = useCallback((ing) => {
    const ts = clock.tick()
    const entry = { id: newId(), ...ing, updatedAt: ts }
    setState((s) => {
      const list = s.customIngredients || []
      if (list.some((f) => f.name.toLowerCase() === ing.name.toLowerCase())) return s
      return { ...s, customIngredients: [entry, ...list] }
    })
    return entry
  }, [])

  const setPref = useCallback((key, val) => {
    const ts = clock.tick()
    setState((s) => ({ ...s, prefs: { ...s.prefs, [key]: val }, meta: setPrefTs(s.meta, key, ts) }))
  }, [])

  const setSubscription = useCallback((sub) => {
    setState((s) => ({ ...s, subscription: { ...defaultSubscription(), ...sub } }))
  }, [])

  const refreshSubscription = useCallback(async () => {
    if (!uid) return null
    const row = await pullSubscription(uid)
    const next = subFromRow(row)
    setState((s) => ({ ...s, subscription: next }))
    return next
  }, [uid])

  const purchaseSubscription = useCallback(async (tier) => subCheckout(tier, { session: auth.session }), [auth.session])
  const openSubscriptionPortal = useCallback(async () => subPortal({ session: auth.session }), [auth.session])

  // Сброс данных. Для аккаунта это не «обнулить локально»: без тумбстоунов всё
  // вернулось бы с сервера при первом же слиянии.
  const resetAll = useCallback(() => {
    const ts = clock.tick()
    setState((s) => ({ ...clearedState(s, ts), subscription: s.subscription }))
    if (!isSignedIn(authRef.current)) clearCache(GUEST)
  }, [])

  // ── 10. Выход ─────────────────────────────────────────────────────────────
  // По умолчанию — только это устройство. Глобальный выход это отдельное
  // осознанное действие: раньше scope не указывался нигде явно, и один
  // неверный вызов выбрасывал человека со всех устройств сразу.
  // discard: true — не пытаться дослать изменения (аккаунт удаляется, слать
  // некуда) и всё равно стереть локальный кэш.
  const signOut = useCallback(async ({ scope = 'local', discard = false } = {}) => {
    const engine = engineRef.current
    dispatch({ type: 'SIGN_OUT_START' })

    // Сначала дослать несохранённое: выход не должен стоить пользователю
    // последних правок.
    let flushed = true
    if (!discard) {
      try { flushed = engine ? await engine.flush() : true } catch { flushed = false }
    }

    const owner = engineOwnerRef.current
    engine?.stop()
    engineRef.current = null
    engineOwnerRef.current = null
    removeAllRealtimeChannels()

    let error = null
    try {
      const res = await supabase.auth.signOut({ scope })
      if (res?.error) error = normalizeError(res.error)
    } catch (e) {
      error = normalizeError(e)
    }

    // Приватные данные не остаются на устройстве после выхода. Кэш сохраняем
    // только если что-то не доехало до сервера — иначе выход означал бы потерю
    // данных. Пользователю об этом честно сообщаем.
    if (owner && (flushed || discard)) clearCache(owner)
    setState((s) => ({ ...empty, subscription: defaultSubscription(), theme: s.theme }))
    setSyncStatus(SYNC.IDLE)
    dispatch({ type: 'SIGNED_OUT' })
    postAuthSignal('signed-out')
    log.auth('выход', { scope, всёОтправлено: flushed })
    return { ok: !error, error, pendingChanges: !flushed }
  }, [])

  // Остановить синхронизацию, не выходя из аккаунта. Нужно ровно перед
  // удалением аккаунта: иначе отложенное сохранение успело бы заново создать
  // строку app_state, которую мы только что стёрли.
  const stopSync = useCallback(() => {
    engineRef.current?.stop()
    engineRef.current = null
    engineOwnerRef.current = null
    setSyncStatus(SYNC.IDLE)
  }, [])

  const retryData = useCallback(() => {
    dispatch({ type: 'RETRY_DATA' })
    setDataNonce((n) => n + 1)
  }, [])

  const retrySync = useCallback(() => {
    engineRef.current?.retryNow()
    engineRef.current?.refresh()
  }, [])

  // Форма входа сообщает о начале и завершении запроса — состояние
  // authenticating нужно, чтобы UI не считал человека гостем, пока ответ в пути.
  const beginSignIn = useCallback(() => dispatch({ type: 'SIGN_IN_START' }), [])
  const endSignIn = useCallback((err) => {
    dispatch({ type: 'SIGN_IN_SETTLED', error: err ? normalizeError(err) : null })
  }, [])

  const completeRecovery = useCallback(() => dispatch({ type: 'RECOVERY_COMPLETED' }), [])

  // Отмена восстановления пароля = выход: recovery-сессия не должна оставаться
  // «обычным входом», иначе ссылка из письма превращается в постоянный доступ.
  const cancelRecovery = useCallback(async () => {
    try { await supabase.auth.signOut({ scope: 'local' }) } catch {}
    dispatch({ type: 'SIGNED_OUT' })
  }, [])

  const dismissAuthError = useCallback(() => dispatch({ type: 'DISMISS_ERROR' }), [])

  const value = useMemo(() => ({
    ...state,
    theme: state.theme,
    resolvedTheme: effectiveTheme(state.theme),
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
    authPhase: phase,
    booting: isBooting(auth),
    signedIn: isSignedIn(auth),
    offline: phase === PHASE.OFFLINE_WITH_CACHED_SESSION,
    authError: auth.error,
    session: auth.session,
    user: auth.session?.user || null,
    syncStatus,
    hasPendingChanges: syncStatus === SYNC.LOCAL || syncStatus === SYNC.OFFLINE,
    auth: authApi,
    signOut,
    stopSync,
    beginSignIn,
    endSignIn,
    announceSignIn,
    recovery: recovering,
    completeRecovery,
    cancelRecovery,
    retryData,
    retrySync,
    dismissAuthError,
    deviceId: clock.deviceId,
  }), [
    state, auth, phase, recovering, syncStatus,
    setProfile, setTheme, addFood, removeFood, editFood, upsertMealSection, deleteMealSection,
    moveMealSection, setMood, toggleWellbeing, addCustomFood, removeCustomFood, addCustomIngredient,
    setPref, setSubscription, purchaseSubscription, openSubscriptionPortal, refreshSubscription,
    resetAll, signOut, stopSync, beginSignIn, endSignIn, completeRecovery, cancelRecovery,
    retryData, retrySync, dismissAuthError,
  ])

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

// Сообщить соседним вкладкам об успешном входе. Вызывает форма входа: только
// она знает, что вход был именно действием пользователя, а не восстановлением
// сессии при запуске.
export function announceSignIn() {
  postAuthSignal('signed-in')
}
