// Общие realtime-каналы: один канал на тему, сколько угодно слушателей.
//
// ─────────────────────────────────────────────────────────────────────────────
// ПОЧЕМУ ЭТО НУЖНО, А НЕ «КАЖДЫЙ КОМПОНЕНТ СОЗДАЁТ СВОЙ КАНАЛ»
//
// supabase-js на одну и ту же тему отдаёт ОДИН И ТОТ ЖЕ объект канала:
// RealtimeClient.channel() ищет существующий по topic и возвращает его. А
// RealtimeChannel.on() для 'postgres_changes' и 'presence' БРОСАЕТ исключение,
// если канал уже присоединён или присоединяется:
//
//   cannot add `postgres_changes` callbacks for realtime:… after `subscribe()`
//
// Из этих двух фактов следует неприятное: два компонента, подписавшиеся на одну
// тему одновременно, роняют приложение. Не «получают дубли событий», а именно
// роняют — исключение вылетает из рендера в RootErrorBoundary.
//
// Ровно это уже случилось с уведомлениями: бейдж в навигации и хаб «Общение»
// подписывались на notifications:{id}, и второй ронял всё приложение. Тогда
// починили одно место — завели singleton прямо в social.js. Но та же ловушка
// стояла под присутствием (presence:user:{id}), чатом, входящими и состоянием
// приложения: там просто не совпало, что два компонента откроются разом.
//
// Здесь это решено один раз для всех.
//
// ─────────────────────────────────────────────────────────────────────────────
// КАК УСТРОЕНО
//
// Реестр «тема → запись». Запись держит один канал, множество слушателей и
// номер поколения. Привязки (.on) навешиваются РОВНО ОДИН РАЗ, при создании
// канала, и рассылают событие всем слушателям.
//
// Тема канала — не голое имя, а `имя#поколение`. Причина: removeChannel
// асинхронна (ждёт подтверждения ухода от сервера), и быстрое пере-открытие
// экрана попадает в промежуток, когда старый канал ещё числится у клиента.
// Уникальная тема убирает этот промежуток как класс: новый канал никогда не
// встретится со старым.
//
// Отпускание отложено. Уход последнего слушателя не закрывает канал сразу:
// StrictMode в разработке монтирует эффекты дважды, а человек переключается
// между чатами быстрее, чем идёт round-trip до сервера. Пауза превращает
// «размонтировали и тут же смонтировали» в отсутствие событий вместо пары
// leave/join.
// ─────────────────────────────────────────────────────────────────────────────

import { log } from './log.js'

// Сколько ждать перед закрытием канала без слушателей. Четверть секунды
// перекрывает и двойное монтирование StrictMode, и переход между экранами.
export const DISPOSE_DELAY = 250

const registry = new Map() // name -> { topic, channel, listeners, generation, timer }
let generation = 0

// Клиент передаётся снаружи, а не импортируется: supabase.js читает
// import.meta.env на импорте и не поднимается под голым `node --test`.
export function createRealtimeHub(client, { disposeDelay = DISPOSE_DELAY, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const entries = registry

  function dispose(entry) {
    if (entries.get(entry.name) !== entry) return
    entries.delete(entry.name)
    try { client.removeChannel(entry.channel) } catch (e) {
      log.error('realtime', 'не удалось снять канал ' + entry.topic, e)
    }
  }

  // bind(channel, emit) навешивает .on(...) и зовёт emit(...) на каждое
  // событие. Вызывается один раз на канал — в этом весь смысл.
  function subscribe(name, bind, listener) {
    if (!client || !name) return () => {}

    let entry = entries.get(name)
    if (!entry) {
      generation += 1
      const topic = `${name}#${generation}`
      const listeners = new Set()
      const emit = (...args) => {
        // Копия списка: слушатель имеет право отписаться прямо из обработчика.
        // Упавший слушатель не должен лишить события остальных.
        for (const fn of [...listeners]) {
          try { fn(...args) } catch (e) { log.error('realtime', 'слушатель ' + name + ' бросил', e) }
        }
      }
      let channel
      try {
        channel = client.channel(topic)
        // bind может вернуть обработчик статуса подписки — он нужен присутствию:
        // трекать себя и читать состояние канала можно только после SUBSCRIBED.
        // Сам subscribe() зовёт ХАБ и ровно один раз: повторный вызов на том же
        // канале — это «tried to subscribe multiple times».
        const onStatus = bind(channel, emit)
        channel.subscribe(typeof onStatus === 'function' ? onStatus : undefined)
      } catch (e) {
        // Заблокированный websocket, выключённый Realtime, экзотическая сеть —
        // это не повод ронять экран. Приложение работает и без живых событий:
        // данные приезжают при следующей загрузке.
        log.error('realtime', 'не удалось подписаться на ' + name, e)
        return () => {}
      }
      entry = { name, topic, channel, listeners, timer: null }
      entries.set(name, entry)
    }

    if (entry.timer) { clearTimer(entry.timer); entry.timer = null }
    entry.listeners.add(listener)

    let released = false
    return () => {
      if (released) return
      released = true
      entry.listeners.delete(listener)
      if (entry.listeners.size > 0) return
      entry.timer = setTimer(() => {
        entry.timer = null
        if (entry.listeners.size === 0) dispose(entry)
      }, disposeDelay)
    }
  }

  // Отправка в канал (broadcast). Тема должна быть уже открыта подпиской —
  // отправлять «в никуда» бессмысленно, и молчаливое создание канала ради
  // одной отправки оставило бы висеть подписку без слушателей.
  function send(name, payload) {
    const entry = entries.get(name)
    if (!entry) return false
    try { entry.channel.send(payload); return true } catch { return false }
  }

  // Выход из аккаунта и смена пользователя. Канал прошлого аккаунта доставлял
  // бы чужие события в новую сессию — и держал бы сокет открытым.
  function reset() {
    for (const entry of [...entries.values()]) {
      if (entry.timer) clearTimer(entry.timer)
      dispose(entry)
    }
    entries.clear()
  }

  // Для тестов и диагностики: сколько живых каналов сейчас держим.
  function stats() {
    return [...entries.values()].map((e) => ({
      name: e.name, topic: e.topic, listeners: e.listeners.size,
    }))
  }

  return { subscribe, send, reset, stats }
}
