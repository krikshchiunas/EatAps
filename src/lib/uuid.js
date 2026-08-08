// Идентификатор новой записи — с честными запасными вариантами.
//
// crypto.randomUUID выглядит безобидно, но доступен не всегда: он появился в
// Safari только в 15.4 и работает лишь в защищённом контексте. Открыли
// приложение с телефона по локальному адресу http://192.168.x.x для проверки —
// и прямое обращение бросает исключение прямо в обработчике «добавить
// продукт». Это тот же класс ошибки, что и с Notification: код молча
// предполагает наличие API, которого в этом браузере нет.
export function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      const b = new Uint8Array(16)
      crypto.getRandomValues(b)
      b[6] = (b[6] & 0x0f) | 0x40 // версия 4
      b[8] = (b[8] & 0x3f) | 0x80 // вариант RFC 4122
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    }
  } catch {
    // криптографии нет или она запрещена политикой — уходим ниже
  }
  // Последний рубеж: время плюс случайность. Для ключа записи в личном дневнике
  // этого достаточно — записи не пересекаются между пользователями, а внутри
  // одного устройства совпадение времени и двух случайных хвостов исключено.
  const rnd = () => Math.random().toString(16).slice(2, 10).padEnd(8, '0')
  return `${Date.now().toString(16)}-${rnd()}-${rnd()}`
}
