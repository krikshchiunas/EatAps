// Что видно о друге. Тесты названы по тому, что они предотвращают: утечка
// телесных показателей и истории поиска — не «некрасивый ответ API», а
// приватные данные о здоровье, попавшие к другому человеку.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectFriendState, projectFriendProfile } from './friendView.js'

// Полное состояние пользователя, как оно лежит в app_state.state.
const FULL = {
  profile: {
    name: 'Аня',
    avatar: 'data:image/jpeg;base64,AAAA',
    bio: 'Люблю супы',
    favRestaurant: 'У Ашота',
    favDish: 'Харчо',
    noGos: ['Молоко', 'Свинина'],
    toGos: ['Суши', 'Авокадо'],
    sex: 'female',
    age: 30,
    height: 170,
    weight: 58,
    activity: 'moderate',
    goal: 'lose',
    targets: { calories: 1900, protein: 100, fat: 60, carbs: 220, bmr: 1400, tdee: 1900 },
    createdAt: 1754400000000,
  },
  theme: 'dark',
  days: { '2026-08-06': { meals: [{ id: 'm1', name: 'Овсянка', kcal: 300 }], mood: 'good', note: 'личная заметка' } },
  customFoods: [
    { id: 'cf1', name: 'Мой борщ', kind: 'composite', recipe: [{ name: 'Свёкла' }] },
    { id: 'cf2', name: 'Творог 5%', kcal: 121 },
  ],
  customIngredients: [{ id: 'ci1', name: 'Секретный соус' }],
  recents: [{ name: 'Пиво', ts: 1 }],
  prefs: { unit: 'г', lastMeal: 'std:dinner' },
  meta: { v: 2, tombstones: { 'd:2026-08-06:m:x': '000000000001000-00000-aaaaaaaa' } },
}

test('телесные показатели друг не получает', () => {
  const p = projectFriendState(FULL).profile
  for (const field of ['weight', 'height', 'age', 'sex', 'activity', 'goal']) {
    assert.equal(p[field], undefined, `${field} не должно уезжать другу`)
  }
})

test('видимая часть профиля сохраняется полностью', () => {
  const p = projectFriendState(FULL).profile
  assert.equal(p.name, 'Аня')
  assert.equal(p.avatar, 'data:image/jpeg;base64,AAAA')
  assert.equal(p.bio, 'Люблю супы')
  assert.equal(p.favRestaurant, 'У Ашота')
  assert.equal(p.favDish, 'Харчо')
  assert.deepEqual(p.noGos, ['Молоко', 'Свинина'])
  assert.deepEqual(p.toGos, ['Суши', 'Авокадо'])
})

test('битые списки «не ем»/«люблю» не уезжают другу и не роняют экран', () => {
  const p = projectFriendProfile({ noGos: 'молоко', toGos: [42, '', '  Суши  ', 'суши'] })
  assert.equal(p.noGos, undefined, 'строка вместо списка — не список')
  assert.deepEqual(p.toGos, ['Суши'], 'мусор отброшен, дубликат схлопнут')
})

test('из целей отдаётся только норма калорий', () => {
  const t = projectFriendState(FULL).profile.targets
  assert.deepEqual(t, { calories: 1900 })
  assert.equal(t.protein, undefined)
  assert.equal(t.bmr, undefined, 'базовый обмен считается по весу и росту — по нему их можно восстановить')
})

test('настройки, история поиска, ингредиенты и служебные метки не уезжают', () => {
  const v = projectFriendState(FULL)
  assert.equal(v.prefs, undefined)
  assert.equal(v.recents, undefined)
  assert.equal(v.customIngredients, undefined)
  assert.equal(v.meta, undefined)
  assert.equal(v.theme, undefined)
  assert.deepEqual(Object.keys(v).sort(), ['customFoods', 'days', 'profile'])
})

test('еда из дневника отдаётся — это и есть смысл экрана друга', () => {
  const days = projectFriendState(FULL).days
  assert.equal(days['2026-08-06'].meals[0].name, 'Овсянка')
})

test('настроение, самочувствие и заметка дня другу не уезжают', () => {
  const day = projectFriendState(FULL).days['2026-08-06']
  assert.equal(day.mood, undefined, 'настроение личнее списка продуктов')
  assert.equal(day.note, undefined, 'свободная заметка о самочувствии')
  assert.equal(day.wellbeing, undefined)
  assert.deepEqual(Object.keys(day), ['meals'], 'из дня видно ровно то, что на экране')
})

test('битый день не роняет экран друга', () => {
  const days = projectFriendState({ days: { '2026-08-06': null, '2026-08-07': { meals: 'нет' } } }).days
  assert.deepEqual(days['2026-08-06'], { meals: [] })
  assert.deepEqual(days['2026-08-07'], { meals: [] })
})

test('из своих продуктов видны только составные блюда', () => {
  const cf = projectFriendState(FULL).customFoods
  assert.equal(cf.length, 1)
  assert.equal(cf[0].name, 'Мой борщ', 'нужен, чтобы раскрыть состав записи в дневнике')
  assert.ok(!cf.some((f) => f.name === 'Творог 5%'), 'обычные свои продукты другу не нужны')
})

test('в результат не попадают неизвестные поля, даже если они появятся в состоянии', () => {
  const v = projectFriendState({ ...FULL, будущееПоле: 'секрет', profile: { ...FULL.profile, новое: 'секрет' } })
  assert.equal(v.будущееПоле, undefined)
  assert.equal(v.profile.новое, undefined, 'список полей белый, а не чёрный — новое поле не утечёт само собой')
})

test('пустой, битый и отсутствующий вход не роняют экран друга', () => {
  for (const junk of [null, undefined, 0, 'строка', [], { profile: 'нет' }, { days: 5 }]) {
    const v = projectFriendState(junk)
    assert.deepEqual(v.profile, {})
    assert.deepEqual(v.days, {})
    assert.deepEqual(v.customFoods, [])
  }
})

test('мусор в полях профиля отбрасывается, а не показывается', () => {
  const p = projectFriendProfile({ name: 42, avatar: null, bio: '', favDish: 'Плов', targets: { calories: 'много' } })
  assert.equal(p.name, undefined, 'число вместо имени не выводим')
  assert.equal(p.bio, undefined, 'пустая строка — не био')
  assert.equal(p.favDish, 'Плов')
  assert.equal(p.targets, undefined, 'нечисловая норма калорий отбрасывается')
})
