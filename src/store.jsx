import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react'
import { StoreCtx, useStore } from './lib/storeContext.js'
import {
  supabase, supabaseEnabled, pullState, saveAppState, subscribeToAppState,
  pullSubscription, subscribeToSubscription, removeAllRealtimeChannels,
  pullPromoGrants, redeemPromo,
} from './lib/supabase.js'
import { defaultSubscription, checkout as subCheckout, openBillingPortal as subPortal, subFromRow, effectiveSubscription } from './lib/subscription.js'
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

  // ── 8. Доступ к платным функциям (серверный источник истины, вне app_state)
  //
  // Источников два: подписка Stripe и промокод. Держим их порознь — вебхук
  // Stripe перезаписывает свою строку целиком и стёр бы выданный кодом
  // доступ, — а наружу отдаём лучший из двух (effectiveSubscription).
  // Оба источника держим в ref, а не в state: пересчёт нужен при изменении
  // любого из них, и промежуточный рендер с половиной данных тут не нужен.
  const stripeRowRef = useRef(null)
  const grantsRef = useRef([])

  const pushAccess = useCallback(() => {
    setState((s) => ({
      ...s,
      subscription: effectiveSubscription(subFromRow(stripeRowRef.current), grantsRef.current),
    }))
  }, [])

  useEffect(() => {
    if (!supabaseEnabled || !uid || recovering) return
    let alive = true

    ;(async () => {
      const [row, grants] = await Promise.all([pullSubscription(uid), pullPromoGrants(uid)])
      if (!alive) return
      stripeRowRef.current = row
      grantsRef.current = grants
      pushAccess()
    })()

    const unsub = subscribeToSubscription(uid, (row) => {
      if (!alive) return
      stripeRowRef.current = row
      pushAccess()
    })
    return () => { alive = false; unsub() }
  }, [uid, recovering, pushAccess])

  // Гашение промокода. Возвращает результат как есть — экран сам решает, что
  // показать: причина отказа («уже использован») это нормальный ответ, а не сбой.
  const applyPromo = useCallback(async (code) => {
    const res = await redeemPromo(code)
    if (res?.ok && uid) {
      const pulled = await pullPromoGrants(uid)
      // pullPromoGrants при сбое сети молча возвращает []. Гашение на сервере
      // уже прошло — если перечитать не удалось, доступ всё равно должен
      // появиться сразу, а не после перезагрузки. Подмешиваем то, что сервер
      // только что подтвердил, если его нет среди прочитанного.
      const key = String(code).trim().toUpperCase()
      const known = { code: key, tier: res.tier, granted_until: res.until }
      grantsRef.current = pulled.some((g) => g.code === key) ? pulled : [...pulled, known]
      pushAccess()
    }
    return res
  }, [uid, pushAccess])

  // Разлогин → возвращаем FREE (иначе UI останется с чужим тиром до перезагрузки).
  // Чистим и промокоды: они принадлежат вышедшему аккаунту.
  useEffect(() => {
    if (uid) return
    stripeRowRef.current = null
    grantsRef.current = []
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

  // theme === null означает «как в системе». Такой выбор обязан СТЕРЕТЬ
  // зеркало: оно хранит последний явный выбор ради первой отрисовки без
  // мигания, и эффект ниже читает его, когда state.theme пуст. Без очистки
  // человек выбирал «как в системе», а экран оставался в прежней теме.
  //
  // Чистим именно здесь, а не в эффекте: setTheme вызывает только человек, а
  // state.theme пуст ещё и при загрузке — очистка в эффекте убила бы зеркало
  // на каждом старте, то есть ровно тот белый кадр, ради которого оно есть.
  const setTheme = useCallback((theme) => {
    const ts = clock.tick()
    if (!theme) {
      try { localStorage.removeItem(THEME_MIRROR) } catch {}
      // Атрибут ставим здесь же, а не ждём эффект: он висит на [state.theme],
      // а при выборе «как в системе» повторно значение не меняется (null → null)
      // — эффект бы не сработал, и экран остался бы в прежней теме.
      document.documentElement.setAttribute('data-theme', effectiveTheme(null))
    }
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

  // Пакетное добавление продуктов. Одним setState и одной меткой времени:
  // «повторить вчерашний день» — это одно действие пользователя, а не двадцать
  // отдельных, и в облако оно должно уехать одной записью.
  const addFoods = useCallback((date, foods) => {
    const list = (foods || []).filter((f) => f && f.name)
    if (list.length === 0) return 0
    const ts = clock.tick()
    const createdAt = new Date().toISOString()
    const entries = list.map((food) => ({ id: newId(), createdAt, ...food, updatedAt: ts }))
    setState((s) => {
      const day = s.days[date] || blankDay()
      const days = { ...s.days, [date]: { ...day, meals: [...day.meals, ...entries] } }
      // Недавние обновляем теми же правилами, что и одиночное добавление.
      let recents = s.recents || []
      for (const food of list) {
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
        const prev = recents.find((r) => r.name === food.name)
        recents = [{ ...snap, count: (prev?.count || 0) + 1, ts: Date.now() }, ...recents.filter((r) => r.name !== food.name)]
      }
      return { ...s, days, recents: recents.slice(0, 40) }
    })
    return entries.length
  }, [])

  // ── Повторить прошлый день / приём пищи ─────────────────────────────────────
  // Копируем СНИМКИ продуктов, а не ссылки: новые записи получают свои id,
  // время и метку, поэтому правка копии не трогает оригинал в прошлом дне.
  // Поля синхронизации (id/updatedAt/createdAt) специально отбрасываем — иначе
  // копия унесла бы чужой id и слияние сочло бы её тем же самым продуктом.
  const repeatDay = useCallback((fromDate, toDate) => {
    const src = stateRef.current.days?.[fromDate]
    if (!src?.meals?.length) return 0
    const copies = src.meals.map(({ id, createdAt, updatedAt, ...rest }) => rest)
    return addFoods(toDate, copies)
  }, [addFoods])

  // targetMealId позволяет перенести «вчерашний обед» в сегодняшний ужин.
  const repeatMeal = useCallback((fromDate, toDate, mealId, targetMealId) => {
    const src = stateRef.current.days?.[fromDate]
    if (!src?.meals?.length) return 0
    const copies = src.meals
      .filter((m) => effectiveMealId(m) === mealId)
      .map(({ id, createdAt, updatedAt, ...rest }) => ({ ...rest, mealId: targetMealId || mealId }))
    return addFoods(toDate, copies)
  }, [addFoods])

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

  // Один общий помощник для всех скаляров дня: кладёт значение и метку времени
  // именно этого поля. Отдельная метка на поле — то, ради чего существует
  // dayFieldTs: взвешивание на телефоне не конфликтует с едой на компьютере.
  const setDayField = useCallback((date, field, value) => {
    const ts = clock.tick()
    setState((s) => {
      const day = s.days[date] || blankDay()
      if (day[field] === value) return s // ничего не изменилось — не жжём метку
      return {
        ...s,
        days: { ...s.days, [date]: { ...day, [field]: value } },
        meta: setDayFieldTs(s.meta, date, field, ts),
      }
    })
  }, [])

  // ── Тело и режим дня ──────────────────────────────────────────────────────
  // Вес и активность живут В ДНЕ, а не в профиле: человек один день лежит, а
  // другой много ходит, и вес меняется. Цель по калориям пересчитывается на
  // каждый день из веса, актуального на этот день, и активности этого дня
  // (см. lib/body.js). null стирает запись — «я передумал», а не «я вешу 0».
  const setDayWeight = useCallback((date, kg) => {
    const n = kg == null || kg === '' ? null : Number(kg)
    const valid = Number.isFinite(n) && n >= 20 && n <= 400 ? Math.round(n * 10) / 10 : null
    setDayField(date, 'weight', valid)
  }, [setDayField])

  const setDayActivity = useCallback((date, key) => {
    const valid = ['sedentary', 'light', 'moderate', 'high'].includes(key) ? key : null
    setDayField(date, 'activity', valid)
  }, [setDayField])

  // ── Учёт дня в статистике ─────────────────────────────────────────────────
  // «Пропустить день» — против самой частой причины вранья в статистике: было
  // лень записать всё съеденное, и средние поехали вниз. Продукты дня при этом
  // НЕ трогаем: они остаются видны на самом дне, просто не идут в аналитику.
  const setDayStatsExcluded = useCallback((date, excluded) => {
    setDayField(date, 'statsExcluded', excluded === true)
  }, [setDayField])

  // «Учитывать всё равно» для дня, который выглядит недозаполненным.
  const confirmDayStats = useCallback((date) => {
    const ts = clock.tick()
    setState((s) => {
      const day = s.days[date] || blankDay()
      let meta = setDayFieldTs(s.meta, date, 'statsConfirmed', ts)
      meta = setDayFieldTs(meta, date, 'statsExcluded', ts)
      return {
        ...s,
        days: { ...s.days, [date]: { ...day, statsConfirmed: true, statsExcluded: false } },
        meta,
      }
    })
  }, [])

  // Целевой вес — долгая цель, поэтому живёт в профиле, а не в дне.
  const setWeightGoal = useCallback((kg) => {
    const ts = clock.tick()
    setState((s) => {
      if (!s.profile) return s
      const profile = { ...s.profile }
      const n = kg == null || kg === '' ? null : Number(kg)
      if (n == null) delete profile.weightGoal
      else if (Number.isFinite(n) && n >= 20 && n <= 400) profile.weightGoal = Math.round(n * 10) / 10
      else return s
      return { ...s, profile, meta: { ...s.meta, profileTs: ts } }
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

    // Чей кэш чистить. Обычно это владелец движка, но перед удалением аккаунта
    // вызывается stopSync(), и он уже обнулил ссылку — тогда владельца берём из
    // сессии. Без этого запаса дневник, вес и возраст удалённого аккаунта
    // навсегда оставались в localStorage: ровно тот путь, где их обязано не
    // остаться в первую очередь.
    const owner = engineOwnerRef.current || authRef.current.userId
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
    addFoods,
    repeatDay,
    repeatMeal,
    removeFood,
    editFood,
    upsertMealSection,
    deleteMealSection,
    moveMealSection,
    setMood,
    toggleWellbeing,
    // тело и режим дня
    setDayWeight,
    setDayActivity,
    setWeightGoal,
    // учёт дня в статистике
    setDayStatsExcluded,
    confirmDayStats,
    addCustomFood,
    removeCustomFood,
    addCustomIngredient,
    setPref,
    purchaseSubscription,
    openSubscriptionPortal,
    refreshSubscription,
    applyPromo,
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
    setProfile, setTheme, addFood, addFoods, repeatDay, repeatMeal, removeFood, editFood, upsertMealSection, deleteMealSection,
    moveMealSection, setMood, toggleWellbeing, addCustomFood, removeCustomFood, addCustomIngredient,
    setDayWeight, setDayActivity, setWeightGoal, setDayStatsExcluded, confirmDayStats,
    setPref, purchaseSubscription, openSubscriptionPortal, refreshSubscription, applyPromo,
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
