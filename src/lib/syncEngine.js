// ─────────────────────────────────────────────────────────────────────────────
// Единственный конвейер сохранения состояния.
//
// Раньше запись в облако запускалась из useEffect по изменению state, а порядок
// операций держался на булевом флаге suppressPush, который «съедал» первое
// попавшееся изменение. Результат: сохранения уезжали параллельно, ответы
// приходили в произвольном порядке, а правки, сделанные во время начальной
// синхронизации, тихо терялись.
//
// Здесь всё наоборот — один объект владеет всем циклом:
//   • ровно один запрос записи в полёте, остальные ждут;
//   • каждая запись — compare-and-swap по revision, поэтому «слепо перезаписать»
//     чужие правки невозможно даже теоретически;
//   • конфликт разрешается слиянием и повторной попыткой, а не перезаписью;
//   • ответы прошлого пользователя отбрасываются по номеру поколения;
//   • локальный кэш пишется синхронно ДО сети, поэтому закрытие приложения
//     в момент сохранения ничего не теряет: изменения уедут при следующем старте.
//
// Ни DOM, ни supabase здесь не импортируются — транспорт и таймеры приходят
// снаружи. Поэтому весь конвейер целиком проверяется тестами без браузера.
// ─────────────────────────────────────────────────────────────────────────────
import { mergeState, normalizeState, pickSyncable, sameSyncable } from './syncModel.js'
import { observeAll } from './hlc.js'
import { ERR, normalizeError } from './authErrors.js'
import { log } from './log.js'

export const SYNC = Object.freeze({
  IDLE: 'idle',
  SYNCING: 'syncing',      // запрос в полёте
  SYNCED: 'synced',        // всё на сервере
  LOCAL: 'local',          // сохранено на устройстве, ждёт отправки
  OFFLINE: 'offline',      // нет сети — отправим, когда появится
  CONFLICT: 'conflict',    // не удалось свести правки за отведённые попытки
  ERROR: 'error',
})

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000]
const DEFAULT_DEBOUNCE = 800
const MAX_CONFLICT_RETRIES = 8

export function createSyncEngine({
  userId,
  transport,                 // { pull(userId), save(state, baseRevision), subscribe(userId, cb) }
  clock,                     // HLC-часы устройства
  cache,                     // { read(), write({state,revision,dirty}), clear() }
  onState = () => {},        // применить слитое состояние в UI
  onStatus = () => {},       // сменился статус синхронизации
  onFatal = () => {},        // сессия мертва — решение принимает store
  debounceMs = DEFAULT_DEBOUNCE,
  timers = { setTimeout, clearTimeout },
}) {
  let generation = 0
  let stopped = false
  let started = false

  let revision = 0            // версия, на которой основаны наши правки
  let latest = null           // последнее локальное синхронизируемое состояние
  let dirty = false           // есть неотправленные изменения
  let inFlight = false
  let timer = null
  let attempt = 0             // счётчик неудач для backoff
  let conflicts = 0
  let status = SYNC.IDLE
  let unsubscribeRealtime = null
  let currentRun = null       // промис записи, которая сейчас летит

  // ── Вспомогательное ────────────────────────────────────────────────────────

  function setStatus(next) {
    if (status === next) return
    status = next
    onStatus(next)
  }

  function persist() {
    if (!latest) return
    cache.write({ state: latest, revision, dirty })
  }

  function apply(next) {
    latest = next
    persist()
    onState(next)
  }

  function clearTimer() {
    if (timer != null) {
      timers.clearTimeout(timer)
      timer = null
    }
  }

  function schedule(delay) {
    if (stopped) return
    clearTimer()
    timer = timers.setTimeout(() => {
      timer = null
      run()
    }, delay)
  }

  function backoff() {
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
    attempt += 1
    schedule(delay)
    return delay
  }

  // ── Запись ─────────────────────────────────────────────────────────────────

  // run() всегда возвращает промис текущей записи (или уже завершённый), чтобы
  // flush() мог дождаться конкретного запроса, а не крутить опрос по таймеру.
  function run() {
    if (stopped || inFlight || !dirty || !latest) return currentRun || Promise.resolve()
    currentRun = doRun().finally(() => { currentRun = null })
    return currentRun
  }

  async function doRun() {
    inFlight = true
    const myGen = generation
    const snapshot = latest
    const base = revision
    setStatus(SYNC.SYNCING)

    try {
      const res = await transport.save(snapshot, base)
      // Ответ пришёл после смены пользователя или остановки — выбрасываем.
      // Именно эта проверка не даёт данным аккаунта A всплыть у аккаунта B.
      if (stopped || myGen !== generation) return

      if (res.conflict) {
        conflicts += 1
        revision = res.revision
        const serverState = normalizeState(res.state)
        observeAll(clock, serverState.meta)
        const merged = mergeState(serverState, latest)
        apply(merged)
        log.sync('конфликт версий — слили и повторяем', { revision, попытка: conflicts })

        if (conflicts <= MAX_CONFLICT_RETRIES) {
          dirty = true
          schedule(0)
        } else {
          // Кто-то пишет непрерывно (или мы зациклились) — не долбим сервер.
          setStatus(SYNC.CONFLICT)
          backoff()
        }
        return
      }

      revision = res.revision
      attempt = 0
      conflicts = 0
      // Пока запрос летел, пользователь мог что-то изменить: сравниваем то, что
      // отправляли, с текущим состоянием, а не считаем «сохранено» по факту 200.
      dirty = !sameSyncable(snapshot, latest)
      persist()
      if (dirty) {
        setStatus(SYNC.LOCAL)
        schedule(debounceMs)
      } else {
        setStatus(SYNC.SYNCED)
      }
      log.sync('сохранено', { revision, ещёИзменения: dirty })
    } catch (e) {
      if (stopped || myGen !== generation) return
      const err = normalizeError(e)

      if (err.category === ERR.SESSION) {
        // Единственный случай, когда сохранение прекращается совсем: токен
        // мёртв. Данные остаются в локальном кэше и уедут после повторного входа.
        setStatus(SYNC.ERROR)
        log.error('sync', 'сессия недействительна', e)
        onFatal(err)
        return
      }

      if (err.category === ERR.PERMISSION) {
        // Не сетевая проблема: политика доступа или не прогнана миграция.
        // Повторяем редко, чтобы не спамить, но не сдаёмся.
        setStatus(SYNC.ERROR)
        log.error('sync', 'доступ к записи отклонён', e)
        backoff()
        return
      }

      setStatus(err.category === ERR.NETWORK ? SYNC.OFFLINE : SYNC.LOCAL)
      const delay = backoff()
      log.sync('сохранение не удалось, повтор', { категория: err.category, через: delay })
    } finally {
      if (!stopped && myGen === generation) inFlight = false
    }
  }

  // ── Чтение и слияние с сервером ───────────────────────────────────────────

  async function hydrate() {
    const myGen = generation
    const remote = await transport.pull(userId)
    if (stopped || myGen !== generation) return { skipped: true }

    if (!remote) {
      // Строки нет — новый аккаунт. Локальное (или гостевое) состояние станет
      // первой версией. revision 0 = «строки не видел», RPC сделает insert.
      revision = 0
      dirty = true
      persist()
      log.sync('в облаке пусто — заливаем локальное состояние')
      return { created: true }
    }

    const serverState = normalizeState(remote.state)
    observeAll(clock, serverState.meta)
    revision = remote.revision
    const merged = mergeState(serverState, latest)
    apply(merged)

    // Пушим только если после слияния у нас реально есть что-то, чего нет на
    // сервере. Иначе каждый запуск приложения порождал бы лишнюю запись —
    // именно так «просто открыл на другом телефоне» затирало свежие правки.
    dirty = !sameSyncable(merged, serverState)
    persist()
    log.sync('состояние загружено', { revision, естьЛокальныеПравки: dirty })
    return { merged: true }
  }

  // ── Realtime ──────────────────────────────────────────────────────────────

  function handleRemote(evt) {
    if (stopped || !evt) return
    // Своё же эхо и устаревшие события отбрасываем по версии — без этого
    // получается цикл: событие сервера → локальная правка → запись → событие.
    if (!evt.revision || evt.revision <= revision) return

    if (!evt.state) {
      // Payload обрезан (большое состояние) — дочитываем строку сами.
      log.rt('событие без состояния — дочитываем', { revision: evt.revision })
      refresh()
      return
    }

    const incoming = normalizeState(evt.state)
    observeAll(clock, incoming.meta)
    revision = evt.revision
    const merged = mergeState(incoming, latest)
    apply(merged)

    if (!sameSyncable(merged, incoming)) {
      dirty = true
      setStatus(SYNC.LOCAL)
      schedule(debounceMs)
    } else if (!inFlight) {
      dirty = false
      persist()
      setStatus(SYNC.SYNCED)
    }
    log.rt('прилетело изменение с другого устройства', { revision, нужнаОтправка: dirty })
  }

  // ── Публичный интерфейс ───────────────────────────────────────────────────

  return {
    get status() { return status },
    get revision() { return revision },
    get hasPendingChanges() { return dirty },

    // Первичная синхронизация. seedState — то, что уже есть в UI (локальный
    // кэш или усыновлённые гостевые данные). Возвращает итоговое состояние и
    // признак «сервер недоступен».
    async start(seedState) {
      if (started) return { state: latest, offline: false }
      started = true
      latest = pickSyncable(seedState)
      observeAll(clock, latest.meta)

      let offline = false
      try {
        await hydrate()
      } catch (e) {
        if (stopped) return { state: latest, offline: true }
        const err = normalizeError(e)
        if (err.category === ERR.SESSION) {
          log.error('sync', 'сессия недействительна при загрузке', e)
          onFatal(err)
          return { state: latest, offline: false, fatal: true }
        }
        offline = true
        setStatus(err.category === ERR.NETWORK ? SYNC.OFFLINE : SYNC.ERROR)
        log.sync('не удалось загрузить состояние — работаем на кэше', { категория: err.category })
        backoff()
      }

      if (!stopped) {
        unsubscribeRealtime = transport.subscribe(userId, handleRemote)
        if (dirty) schedule(0)
        else if (!offline) setStatus(SYNC.SYNCED)
      }
      return { state: latest, offline }
    },

    // Локальное изменение. Кэш пишется синхронно — сеть уже не обязательна для
    // сохранности данных, она нужна только чтобы правка доехала до других
    // устройств.
    push(nextState) {
      if (stopped) return
      const next = pickSyncable(nextState)
      // Ключевая защита от «эха»: то, что уже известно движку, не отправляется
      // повторно. Благодаря этому применение серверного состояния в UI не
      // порождает обратную запись, и не нужен ни один флаг вида suppressPush —
      // именно такой флаг раньше «съедал» настоящие правки пользователя.
      if (latest && sameSyncable(latest, next)) return
      latest = next
      dirty = true
      persist()
      setStatus(status === SYNC.OFFLINE ? SYNC.OFFLINE : SYNC.LOCAL)
      schedule(debounceMs)
    },

    // Немедленно отправить накопленное (выход из аккаунта, уход со страницы).
    async flush() {
      if (stopped) return false
      clearTimer()
      if (currentRun) await currentRun          // дожидаемся запроса, что уже летит
      if (stopped || !dirty) return !dirty
      await run()
      return !dirty
    },

    // Контрольная сверка с сервером: после возврата сети, после долгого фона и
    // при переподключении Realtime. Realtime сам по себе не гарантия — событие
    // могло не дойти, пока вкладка спала.
    async refresh() {
      if (stopped || !started) return
      try {
        await hydrate()
        if (dirty) schedule(0)
        else setStatus(SYNC.SYNCED)
        attempt = 0
      } catch (e) {
        if (stopped) return
        const err = normalizeError(e)
        if (err.category === ERR.SESSION) { onFatal(err); return }
        setStatus(err.category === ERR.NETWORK ? SYNC.OFFLINE : SYNC.ERROR)
        backoff()
      }
    },

    // Сеть вернулась / пользователь нажал «повторить».
    retryNow() {
      if (stopped) return
      attempt = 0
      conflicts = 0
      clearTimer()
      if (dirty) schedule(0)
    },

    // Полная остановка: смена пользователя, выход, размонтирование. Все ответы,
    // которые прилетят после этого, будут отброшены по generation.
    stop() {
      if (stopped) return
      stopped = true
      generation += 1
      clearTimer()
      if (unsubscribeRealtime) {
        try { unsubscribeRealtime() } catch {}
        unsubscribeRealtime = null
      }
      setStatus(SYNC.IDLE)
      log.sync('движок остановлен', { revision, остались_изменения: dirty })
    },
  }
}
