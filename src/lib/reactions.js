// Реакции на мысль — ЧИСТАЯ часть: во что превращается пост от одного нажатия.
//
// Зачем отдельный модуль. Раньше PostCard ЖДАЛ ответа сервера, чтобы
// перекрасить кнопку: нажал 🥕 — и ничего не происходит, пока не вернётся
// toggle_post_reaction. На хорошей связи это сотня миллисекунд, на телефоне в
// метро — секунды, и человек нажимает второй раз, потому что решил, что
// промахнулся. Второе нажатие — это уже СНЯТИЕ реакции, и итог получается
// обратный задуманному.
//
// Считать «что будет после нажатия» умеет сервер (он и остаётся источником
// истины), но для мгновенной отрисовки то же самое нужно и клиенту. Правило
// здесь одно и записано один раз — иначе две реализации разойдутся в углах
// вроде «переключение с 🥕 на 🥦».
//
// Сервер остаётся главным: его ответ ПЕРЕЗАПИСЫВАЕТ предсказание целиком, а
// не складывается с ним. Ошибка — откат к состоянию до нажатия.

export const CARROT = '🥕'
export const BROCCOLI = '🥦'

const countKey = (emoji) => (emoji === CARROT ? 'carrots' : emoji === BROCCOLI ? 'broccoli' : null)
const clamp = (n) => Math.max(0, Number(n) || 0)

// Предсказание: пост после нажатия на emoji.
// Возвращает исходный пост без изменений, если реакция незнакомая — сервер
// такую всё равно отклонит, и рисовать несуществующее состояние незачем.
export function predictReaction(post, emoji) {
  const key = countKey(emoji)
  if (!post || !key) return post

  const mine = post.my_reaction || null
  const next = {
    ...post,
    carrots: clamp(post.carrots),
    broccoli: clamp(post.broccoli),
  }

  if (mine === emoji) {
    // Повторное нажатие по своей же реакции снимает её.
    next[key] = clamp(next[key] - 1)
    next.my_reaction = null
    return next
  }

  const prevKey = countKey(mine)
  if (prevKey) next[prevKey] = clamp(next[prevKey] - 1)
  next[key] = clamp(next[key] + 1)
  next.my_reaction = emoji
  return next
}

// Ответ toggle_post_reaction → пост. Сервер отдаёт { carrots, broccoli, mine };
// mine приходит именно так, а не как my_reaction, — переименование живёт
// здесь, а не в компоненте.
export function applyServerReaction(post, row) {
  if (!post || !row) return post
  return {
    ...post,
    carrots: clamp(row.carrots),
    broccoli: clamp(row.broccoli),
    my_reaction: row.mine || null,
  }
}
