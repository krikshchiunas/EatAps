// ─────────────────────────────────────────────────────────────────────────────
// Состояние авторизации как явная машина состояний.
//
// Раньше состояние выводилось из одной переменной session, и «нет сессии» было
// неотличимо от «сессию ещё не проверили». Отсюда мигание экрана входа при
// каждом запуске, показ онбординга залогиненному человеку и попытки писать в
// облако до того, как выяснилось, чьи данные лежат локально.
//
// Редьюсер чистый и без побочных эффектов — его целиком покрывают тесты.
// Никакой async-логики здесь нет: сторона эффектов (store.jsx) только шлёт
// события и читает получившуюся фазу.
// ─────────────────────────────────────────────────────────────────────────────

export const PHASE = Object.freeze({
  INITIALIZING: 'initializing',                       // сессию ещё проверяем
  ANONYMOUS: 'anonymous',                             // гость, облака нет
  AUTHENTICATING: 'authenticating',                   // запрос входа в полёте
  LOADING_ACCOUNT_DATA: 'loading_account_data',       // сессия есть, тянем данные
  READY: 'ready',                                     // данные загружены
  OFFLINE_WITH_CACHED_SESSION: 'offline_with_cached_session', // сессия есть, сервер недоступен
  PASSWORD_RECOVERY: 'password_recovery',             // пришли по ссылке сброса
  SIGNING_OUT: 'signing_out',
  AUTH_ERROR: 'auth_error',
})

// Фазы, в которых интерфейс приложения показывать ещё нельзя: пока не ясно,
// авторизован человек или нет, любой экран будет мигать.
const BOOT_PHASES = new Set([PHASE.INITIALIZING, PHASE.LOADING_ACCOUNT_DATA, PHASE.SIGNING_OUT])

export function initialAuthState() {
  return {
    phase: PHASE.INITIALIZING,
    session: null,
    userId: null,
    error: null,     // { code, message } — уже нормализованная, не сырая
    // Пользователь пришёл по ссылке сброса пароля. Это НЕ обычный вход: пока
    // пароль не сменён, данные аккаунта не грузим и в облако не пишем.
    recovering: false,
  }
}

const sameUser = (state, session) => Boolean(session?.user?.id) && session.user.id === state.userId

function withSession(state, session, phase) {
  return { ...state, phase, session: session || null, userId: session?.user?.id || null }
}

export function authReducer(state, action) {
  switch (action.type) {
    // ── Загрузка ──────────────────────────────────────────────────────────
    // INITIAL_SESSION от supabase-js: единственная точка, где решается, был
    // ли вход. Отдельного getSession() нет намеренно — два независимых
    // источника гонялись друг с другом и могли выставить устаревшую сессию.
    case 'INITIAL_SESSION': {
      if (state.phase !== PHASE.INITIALIZING) return state
      if (!action.session) return { ...state, phase: PHASE.ANONYMOUS, session: null, userId: null }
      return withSession(state, action.session, PHASE.LOADING_ACCOUNT_DATA)
    }

    // Supabase не ответил вовремя (сеть, приватный режим). Сессия из локального
    // хранилища есть — работаем офлайн на кэше, а не выкидываем в гости.
    case 'INIT_TIMEOUT': {
      if (state.phase !== PHASE.INITIALIZING) return state
      if (!action.session) return { ...state, phase: PHASE.ANONYMOUS, session: null, userId: null }
      return withSession(state, action.session, PHASE.OFFLINE_WITH_CACHED_SESSION)
    }

    // ── События supabase-js ───────────────────────────────────────────────
    case 'SIGNED_IN': {
      if (!action.session) return state
      // supabase-js присылает SIGNED_IN не только при реальном входе, но и при
      // возврате на вкладку и после обновления токена. Для того же пользователя
      // это НЕ повод перезагружать данные и мигать экраном загрузки.
      if (sameUser(state, action.session)) {
        if (state.phase === PHASE.PASSWORD_RECOVERY) return { ...state, session: action.session }
        const phase = state.phase === PHASE.OFFLINE_WITH_CACHED_SESSION || state.phase === PHASE.READY
          ? state.phase
          : state.phase === PHASE.INITIALIZING ? PHASE.LOADING_ACCOUNT_DATA : state.phase
        return { ...state, phase, session: action.session, error: null }
      }
      return { ...withSession(state, action.session, PHASE.LOADING_ACCOUNT_DATA), error: null, recovering: false }
    }

    // Обновление токена НИКОГДА не меняет фазу: раньше любая пересборка сессии
    // выглядела как новый вход и перезапускала загрузку данных.
    case 'TOKEN_REFRESHED':
    case 'USER_UPDATED': {
      if (!action.session) return state
      if (state.userId && !sameUser(state, action.session)) return state
      return { ...state, session: action.session, userId: action.session.user?.id || state.userId }
    }

    case 'PASSWORD_RECOVERY': {
      return { ...withSession(state, action.session || state.session, PHASE.PASSWORD_RECOVERY), recovering: true, error: null }
    }

    case 'RECOVERY_COMPLETED': {
      if (!state.recovering) return state
      if (!state.session) return { ...state, recovering: false, phase: PHASE.ANONYMOUS }
      return { ...state, recovering: false, phase: PHASE.LOADING_ACCOUNT_DATA }
    }

    case 'SIGNED_OUT': {
      return { ...initialAuthState(), phase: PHASE.ANONYMOUS }
    }

    // ── Действия пользователя ─────────────────────────────────────────────
    case 'SIGN_IN_START': {
      return { ...state, phase: PHASE.AUTHENTICATING, error: null }
    }

    // Попытка входа завершилась — успехом или нет. Если сессия появилась,
    // SIGNED_IN уже увёл фазу дальше, и тогда мы только фиксируем ошибку (её
    // может не быть вовсе: магическая ссылка и письмо сброса пароля сессию не
    // создают). Иначе возвращаем гостя в гостевое состояние, а не оставляем
    // висеть в authenticating — иначе перестаёт сохраняться гостевой кэш.
    case 'SIGN_IN_SETTLED': {
      if (state.phase !== PHASE.AUTHENTICATING) {
        return action.error ? { ...state, error: action.error } : state
      }
      return { ...state, phase: PHASE.ANONYMOUS, error: action.error || null }
    }

    case 'SIGN_OUT_START': {
      return { ...state, phase: PHASE.SIGNING_OUT, error: null }
    }

    // ── Загрузка данных аккаунта ──────────────────────────────────────────
    case 'DATA_LOADED': {
      // Ответ от прошлого пользователя игнорируем — иначе данные A всплывают
      // у B при быстрой смене аккаунта.
      if (action.userId !== state.userId) return state
      if (state.phase !== PHASE.LOADING_ACCOUNT_DATA && state.phase !== PHASE.OFFLINE_WITH_CACHED_SESSION) return state
      return { ...state, phase: PHASE.READY, error: null }
    }

    case 'DATA_OFFLINE': {
      if (action.userId !== state.userId) return state
      if (state.phase === PHASE.READY) return state // уже работаем, просто сеть моргнула
      if (state.phase !== PHASE.LOADING_ACCOUNT_DATA) return state
      return { ...state, phase: PHASE.OFFLINE_WITH_CACHED_SESSION }
    }

    // Сессия оказалась мёртвой (refresh token отозван/протух) — только это
    // основание считать пользователя разлогиненным.
    case 'SESSION_INVALID': {
      return { ...initialAuthState(), phase: PHASE.AUTH_ERROR, error: action.error || null }
    }

    case 'DISMISS_ERROR': {
      if (state.phase === PHASE.AUTH_ERROR) return { ...state, phase: PHASE.ANONYMOUS, error: null }
      return { ...state, error: null }
    }

    // Повторная попытка загрузки данных после сбоя.
    case 'RETRY_DATA': {
      if (!state.userId) return state
      if (state.phase !== PHASE.OFFLINE_WITH_CACHED_SESSION && state.phase !== PHASE.READY) return state
      return { ...state, phase: PHASE.LOADING_ACCOUNT_DATA }
    }

    default:
      return state
  }
}

// ── Производные признаки для интерфейса ──────────────────────────────────────

// Показывать общий экран загрузки. Онбординг, экран входа и главный экран не
// рендерятся, пока это true — отсюда отсутствие мигания.
export function isBooting(state) {
  return BOOT_PHASES.has(state.phase)
}

// Пользователь считается вошедшим и в офлайне: сессия лежит локально, данные —
// в кэше. Разлогинивает только явный выход или мёртвый refresh token.
export function isSignedIn(state) {
  return Boolean(state.userId) && state.phase !== PHASE.SIGNING_OUT && state.phase !== PHASE.AUTH_ERROR
}

// Можно ли писать в облако. Во время bootstrap, recovery и выхода — нельзя:
// именно оттуда раньше прилетали записи дефолтов поверх серверных данных.
export function canSync(state) {
  return state.phase === PHASE.READY && Boolean(state.userId) && !state.recovering
}
