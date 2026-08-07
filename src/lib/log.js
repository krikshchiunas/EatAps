// Диагностика жизненного цикла аккаунта. Помогает понять «что произошло между
// входом и пустым экраном», не превращая консоль продакшена в помойку.
//
// Включается сама в dev-сборке; в проде — только вручную и осознанно:
//   localStorage.setItem('eataps:debug', '1')   → перезагрузить страницу
//
// Секреты сюда не попадают по построению: логгер печатает только категорию,
// короткое событие и «безопасные» поля. Токены, пароли и полный payload
// состояния не логируются никогда — при отладке чужого устройства скриншот
// консоли не должен давать доступ к аккаунту.

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}

function debugEnabled() {
  if (env.DEV) return true
  try { return localStorage.getItem('eataps:debug') === '1' } catch { return false }
}

const enabled = debugEnabled()

// uuid → «a1b2c3d4…»: достаточно, чтобы различить двух пользователей в логе,
// недостаточно, чтобы кого-то опознать.
export function shortId(id) {
  const s = String(id || '')
  return s ? `${s.slice(0, 8)}…` : '—'
}

const SECRET_KEY = /token|password|secret|key|jwt|authorization|refresh/i

// Оставляем только скалярные, заведомо безопасные поля.
function safe(data) {
  if (data == null || typeof data !== 'object') return data
  const out = {}
  for (const k of Object.keys(data)) {
    if (SECRET_KEY.test(k)) { out[k] = '[скрыто]'; continue }
    const v = data[k]
    if (v == null || typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') out[k] = v.length > 80 ? `${v.slice(0, 80)}…` : v
    else if (Array.isArray(v)) out[k] = `[${v.length}]`
    else out[k] = '{…}'
  }
  return out
}

function emit(scope, event, data) {
  if (!enabled) return
  const payload = data === undefined ? '' : safe(data)
  // eslint-disable-next-line no-console
  console.debug(`[eataps:${scope}] ${event}`, payload)
}

export const log = {
  auth: (event, data) => emit('auth', event, data),
  sync: (event, data) => emit('sync', event, data),
  rt: (event, data) => emit('realtime', event, data),
  // Настоящие ошибки видно всегда — но тоже без секретов и без сырых объектов.
  error: (scope, event, err) => {
    // eslint-disable-next-line no-console
    console.warn(`[eataps:${scope}] ${event}`, err?.code || err?.message || 'ошибка')
  },
  enabled,
}
