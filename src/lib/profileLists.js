// ─────────────────────────────────────────────────────────────────────────────
// Списки профиля «нет в еде» (noGos) и «да в еде» (toGos). Ключи в состоянии
// остались прежними — переименование коснулось только того, что видит человек.
//
// Живут в том же profile, что bio/favRestaurant/favDish — то есть внутри
// синхронизируемого блоба app_state.state и под той же меткой profileTs
// (см. syncModel.mergeProfile). Отдельного слоя хранения не заводим: профиль
// уже сливается целиком как скаляр, а два массива строк ничего в этой модели
// не ломают.
//
// Нормализация здесь одна на всех: её зовут и редактор (MyProfileSheet), и
// проекция для друга (friendView). Так в состояние не попадает мусор, а другу
// не уезжает то, что не переживёт отрисовку: числа вместо строк, пустые
// строки, дубликаты и список на тысячу позиций.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_ITEMS = 24 // больше в профиль просто не влезает по смыслу
export const MAX_LEN = 40   // «Молоко», «Грибы», а не абзац текста

// Массив строк → чистый массив строк. Никогда не бросает: любой мусор на входе
// (null, строка, объекты внутри) превращается в пустой список или отбрасывается
// поэлементно.
export function normalizeProfileList(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const s = v.replace(/\s+/g, ' ').trim().slice(0, MAX_LEN).trim()
    if (!s) continue
    // Дубликаты сравниваем без регистра: «Молоко» и «молоко» — одно и то же.
    const key = s.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

// Добавление одного пункта из поля ввода. Возвращает { list, error } — ошибку
// показываем в редакторе, а не молча проглатываем ввод.
export function addProfileListItem(list, value) {
  const cur = normalizeProfileList(list)
  const v = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!v) return { list: cur, error: null }
  if (cur.length >= MAX_ITEMS) return { list: cur, error: `Не больше ${MAX_ITEMS} пунктов` }
  if (cur.some((x) => x.toLowerCase() === v.slice(0, MAX_LEN).trim().toLowerCase())) {
    return { list: cur, error: 'Уже в списке' }
  }
  return { list: normalizeProfileList([...cur, v]), error: null }
}

export function removeProfileListItem(list, value) {
  return normalizeProfileList(list).filter((x) => x !== value)
}
