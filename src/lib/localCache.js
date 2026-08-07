// ─────────────────────────────────────────────────────────────────────────────
// Локальный кэш состояния, разделённый по пользователю.
//
// Раньше всё лежало в одном ключе eataps:v1 вместе с меткой eataps:lastUid
// «чьи это данные». Из-за этого при смене аккаунта на устройстве данные
// приходилось «разруливать» на лету, а любая ошибка в этой логике показывала
// человеку чужой дневник. Теперь ключ содержит user id: перепутать физически
// нечего, а гостевые данные живут отдельно и однократно «усыновляются» при
// первом входе.
// ─────────────────────────────────────────────────────────────────────────────
import { log } from './log.js'

const PREFIX = 'eataps:state:'
export const GUEST = 'guest'

// Ключи прежней схемы — читаем один раз при миграции и убираем.
const LEGACY_STATE = 'eataps:v1'
const LEGACY_META = 'eataps:sync'
const LEGACY_UID = 'eataps:lastUid'

const keyFor = (owner) => `${PREFIX}${owner || GUEST}`

function readJSON(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null // повреждённый JSON — считаем, что кэша нет
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    log.error('cache', 'не удалось записать локальный кэш', e)
    return false
  }
}

// Перенос из старой схемы. Вызывается один раз при старте приложения, до
// любого чтения. Идемпотентен: после успешного переноса старые ключи удалены,
// повторный вызов ничего не делает.
export function migrateLegacyCache() {
  let legacy
  try {
    legacy = localStorage.getItem(LEGACY_STATE)
  } catch {
    return
  }
  if (!legacy) return

  let parsed = null
  try { parsed = JSON.parse(legacy) } catch { parsed = null }

  const lastUid = (() => { try { return localStorage.getItem(LEGACY_UID) } catch { return null } })()
  const owner = lastUid || GUEST

  // Не затираем уже существующий новый кэш — он свежее по определению.
  if (parsed && !readJSON(keyFor(owner))) {
    const ok = writeJSON(keyFor(owner), { state: parsed, revision: 0, dirty: true, migrated: true })
    if (!ok) return // места нет — старые ключи не трогаем, данные целы
  }

  try {
    localStorage.removeItem(LEGACY_STATE)
    localStorage.removeItem(LEGACY_META)
    localStorage.removeItem(LEGACY_UID)
  } catch {}
  log.sync('перенесён легаси-кэш', { owner: owner === GUEST ? 'guest' : 'user' })
}

// Читаем запись кэша: { state, revision, dirty } либо null.
export function readCache(owner) {
  const rec = readJSON(keyFor(owner))
  if (!rec || typeof rec !== 'object' || !rec.state) return null
  return {
    state: rec.state,
    revision: Number(rec.revision) || 0,
    dirty: Boolean(rec.dirty),
  }
}

export function writeCache(owner, { state, revision, dirty }) {
  return writeJSON(keyFor(owner), { state, revision: Number(revision) || 0, dirty: Boolean(dirty) })
}

export function clearCache(owner) {
  try { localStorage.removeItem(keyFor(owner)) } catch {}
}

export function hasCache(owner) {
  return readCache(owner) !== null
}

// Есть ли на устройстве кэш какого-нибудь аккаунта. Нужен ровно для одной
// подсказки: человек с истёкшей сессией видит приветственный экран, и без
// объяснения это выглядит как «данные пропали». Сами данные при этом не
// показываются — только факт, что они появятся после входа.
export function hasAnyAccountCache() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(PREFIX) && key !== `${PREFIX}${GUEST}`) return true
    }
  } catch {}
  return false
}

// Ключ HLC-часов устройства — общий, не привязан к аккаунту: часы принадлежат
// устройству, и после смены пользователя они не должны уезжать назад.
const CLOCK_KEY = 'eataps:hlc'
export const clockStorage = {
  load() { try { return localStorage.getItem(CLOCK_KEY) } catch { return null } },
  save(v) { try { localStorage.setItem(CLOCK_KEY, v) } catch {} },
}
