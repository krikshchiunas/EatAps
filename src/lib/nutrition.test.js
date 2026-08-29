// Тесты ядра расчёта: цели по КБЖУ и качество белка. Раньше этот файл был
// единственным непокрытым куском арифметики в проекте — а именно он решает,
// сколько человеку есть.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeTargets, proteinReferenceWeight, proteinPerKgFor,
  sumDay, sumAdvanced, sumQuality, satFatLimit, sugarLimit, fiberGoal, carbGrade,
  ACTIVITY, GOALS,
} from './nutrition.js'
import { estimateProteinQuality, usableProteinShare } from './nutritionClassification.js'

const M = { sex: 'male', age: 30, height: 180, weight: 80, activity: 'light', goal: 'maintain' }
const F = { sex: 'female', age: 30, height: 165, weight: 60, activity: 'light', goal: 'maintain' }

// ── Базовый обмен и расход ────────────────────────────────────────────────────

test('BMR считается по Mifflin-St Jeor и различает пол', () => {
  // 10×80 + 6.25×180 − 5×30 + 5 = 1780
  assert.equal(computeTargets(M).bmr, 1780)
  // 10×60 + 6.25×165 − 5×30 − 161 = 1320.25 → 1320
  assert.equal(computeTargets(F).bmr, 1320)
})

test('TDEE = BMR × коэффициент активности', () => {
  for (const [key, { factor }] of Object.entries(ACTIVITY)) {
    const t = computeTargets({ ...M, activity: key })
    assert.equal(t.tdee, Math.round(1780 * factor), key)
    assert.equal(t.activityFactor, factor, key)
  }
})

test('activityFactor числом имеет приоритет над ключом активности', () => {
  const t = computeTargets({ ...M, activity: 'sedentary', activityFactor: 1.7 })
  assert.equal(t.activityFactor, 1.7)
  assert.equal(t.tdee, Math.round(1780 * 1.7))
})

// ── Калории: дефицит, профицит, нижние границы ────────────────────────────────

test('дефицит ограничен и абсолютом, и долей от расхода', () => {
  // Крупный мужчина: расход велик, срабатывает абсолютный лимит −500.
  const big = computeTargets({ ...M, weight: 100, activity: 'high', goal: 'lose' })
  assert.equal(big.calories, Math.round((big.tdee - 500) / 10) * 10)

  // Невысокая женщина: −500 было бы больше четверти расхода → режем по 25%.
  const small = computeTargets({ ...F, weight: 50, height: 155, goal: 'lose', activity: 'sedentary' })
  const deficit = small.tdee - small.calories
  assert.ok(deficit <= small.tdee * 0.25 + 5, `дефицит ${deficit} > 25% от ${small.tdee}`)
  assert.ok(deficit < 500, 'для маленького расхода дефицит должен быть меньше 500')
})

test('калории не опускаются ниже физиологического минимума', () => {
  // Если расход уже ниже минимального ориентира, цель прижимается к расходу:
  // резать ещё некуда, а поднимать выше поддержания на снижении нельзя.
  const man = computeTargets({ ...M, weight: 55, height: 160, age: 70, goal: 'lose', activity: 'sedentary' })
  assert.ok(man.calories >= 1500 || man.calories > man.tdee - 10,
    `мужчина: ${man.calories} при расходе ${man.tdee}`)

  const woman = computeTargets({ ...F, weight: 45, height: 150, age: 65, goal: 'lose', activity: 'sedentary' })
  assert.ok(woman.calories >= 1200 || woman.calories > woman.tdee - 10,
    `женщина: ${woman.calories} при расходе ${woman.tdee}`)

  // И ни при каких данных цель не падает в бессмыслицу.
  for (const w of [40, 45, 55, 70, 90, 120, 180]) {
    for (const sex of ['male', 'female']) {
      const t = computeTargets({ sex, age: 80, height: 148, weight: w, activity: 'sedentary', goal: 'lose' })
      assert.ok(t.calories >= 900, `${sex}/${w}кг: ${t.calories} ккал`)
    }
  }
})

test('на снижении цель никогда не выше поддержания', () => {
  // Крайний случай: расход ниже минимального ориентира. Заставлять есть больше,
  // чем тратишь, когда цель — похудеть, нельзя.
  const t = computeTargets({ sex: 'female', age: 75, height: 148, weight: 40, activity: 'sedentary', goal: 'lose' })
  assert.ok(t.calories <= t.tdee, `цель ${t.calories} > расхода ${t.tdee}`)
})

test('профицит на наборе ограничен долей от расхода', () => {
  const t = computeTargets({ ...M, goal: 'gain' })
  const surplus = t.calories - t.tdee
  assert.ok(surplus > 0 && surplus <= Math.min(350, t.tdee * 0.2) + 5, `профицит ${surplus}`)
})

// ── Белок ─────────────────────────────────────────────────────────────────────

test('расчётная масса для белка: при ИМТ ≤ 25 это реальный вес', () => {
  assert.equal(proteinReferenceWeight(70, 180), 70)
  assert.equal(proteinReferenceWeight(80, 180), 80) // ИМТ 24.7
})

test('при ожирении белок дозируется от скорректированной массы, а не от общей', () => {
  // 180 см → вес при ИМТ 25 = 81 кг. Для 130 кг: 81 + 0.4×49 = 100.6
  const ref = proteinReferenceWeight(130, 180)
  assert.ok(Math.abs(ref - 100.6) < 0.1, `ABW = ${ref}`)
  assert.ok(ref < 130 && ref > 81, 'ABW между «идеальным» и реальным весом')

  const t = computeTargets({ ...M, weight: 130, goal: 'lose' })
  // Старая формула дала бы 130 × 1.9 ≈ 247 г — столько не съесть.
  assert.ok(t.protein < 210, `белок ${t.protein} г — всё ещё нереалистично много`)
  assert.ok(t.protein > 130, `белок ${t.protein} г — слишком мало для снижения веса`)
})

test('белок растёт с активностью и не выходит за рамки', () => {
  const order = ['sedentary', 'light', 'moderate', 'high']
  let prev = 0
  for (const a of order) {
    const t = computeTargets({ ...M, activity: a })
    assert.ok(t.protein > prev, `${a}: ${t.protein} не больше предыдущего ${prev}`)
    prev = t.protein
  }
  // Даже на пределе ползунка норма остаётся в разумных границах.
  const extreme = computeTargets({ ...M, activityFactor: 2.2 })
  assert.ok(extreme.proteinPerKg <= 2.5, `${extreme.proteinPerKg} г/кг — выше потолка`)
  const bedrest = computeTargets({ ...M, activityFactor: 1.0 })
  assert.ok(bedrest.proteinPerKg >= 0.8, `${bedrest.proteinPerKg} г/кг — ниже RDA`)
})

test('после 60 норма белка поднимается (анаболическая резистентность)', () => {
  const young = computeTargets({ ...M, age: 30 })
  const old = computeTargets({ ...M, age: 75 })
  assert.ok(old.proteinPerKg > young.proteinPerKg, `${old.proteinPerKg} не больше ${young.proteinPerKg}`)
  // Прибавка плавная: 59 и 61 год не должны различаться скачком.
  const a59 = proteinPerKgFor('maintain', 1.375, 59)
  const a61 = proteinPerKgFor('maintain', 1.375, 61)
  assert.ok(Math.abs(a61 - a59) < 0.05, `ступенька ${a59} → ${a61}`)
})

test('на снижении белка больше, чем на поддержании и на наборе', () => {
  const lose = computeTargets({ ...M, goal: 'lose' })
  const keep = computeTargets({ ...M, goal: 'maintain' })
  const gain = computeTargets({ ...M, goal: 'gain' })
  assert.ok(lose.proteinPerKg > gain.proteinPerKg, 'дефицит требует больше белка, чем набор')
  assert.ok(gain.proteinPerKg > keep.proteinPerKg)
})

test('белок не съедает больше 40% калорий, но не падает ниже RDA', () => {
  const t = computeTargets({ ...F, weight: 55, height: 160, goal: 'lose', activity: 'high' })
  assert.ok(t.protein * 4 <= t.calories * 0.42, `${t.protein} г = ${Math.round(t.protein * 400 / t.calories)}% калорий`)
  for (const w of [45, 60, 80, 100, 130, 180]) {
    const x = computeTargets({ ...M, weight: w, goal: 'lose' })
    assert.ok(x.protein >= w * 0.8 - 1, `вес ${w}: белок ${x.protein} ниже RDA`)
  }
})

// ── Сходимость КБЖУ ───────────────────────────────────────────────────────────

test('Б×4 + Ж×9 + У×4 сходится с калориями во всех сочетаниях', () => {
  const sexes = ['male', 'female']
  const goals = ['lose', 'maintain', 'gain']
  const acts = ['sedentary', 'light', 'moderate', 'high']
  let checked = 0
  for (const sex of sexes) {
    for (const goal of goals) {
      for (const activity of acts) {
        for (const age of [18, 30, 45, 65, 80]) {
          for (const weight of [45, 60, 80, 100, 130, 180]) {
            for (const height of [150, 165, 180, 200]) {
              const t = computeTargets({ sex, age, height, weight, activity, goal })
              const kcal = t.protein * 4 + t.fat * 9 + t.carbs * 4
              // Расхождение только от округления граммов до целых.
              assert.ok(Math.abs(kcal - t.calories) <= 12,
                `${sex}/${goal}/${activity}/${age}/${weight}кг/${height}см: ${kcal} vs ${t.calories}`)
              assert.ok(t.carbs >= 0 && t.fat > 0 && t.protein > 0)
              assert.ok(Number.isInteger(t.protein) && Number.isInteger(t.fat) && Number.isInteger(t.carbs))
              checked++
            }
          }
        }
      }
    }
  }
  assert.ok(checked > 500, `проверено всего ${checked} сочетаний`)
})

test('жиры не опускаются ниже физиологического минимума', () => {
  for (const weight of [45, 60, 80, 100, 130]) {
    for (const goal of ['lose', 'maintain', 'gain']) {
      const t = computeTargets({ ...M, weight, goal })
      assert.ok(t.fat * 9 >= t.calories * 0.19, `${weight}кг/${goal}: жиры ${t.fat} г — меньше 20% калорий`)
    }
  }
})

// ── Качество белка (DIAAS) ────────────────────────────────────────────────────

test('DIAAS: животные источники выше растительных', () => {
  const q = (food) => estimateProteinQuality(food).diaas
  assert.ok(q({ name: 'Яйцо', cat: 'egg', protein: 6 }) > q({ name: 'Чечевица варёная', cat: 'legume', protein: 9 }))
  assert.ok(q({ name: 'Творог', cat: 'dairy', protein: 18 }) > q({ name: 'Хлеб', cat: 'bread', protein: 8 }))
  assert.ok(q({ name: 'Соя варёная', cat: 'legume', protein: 17 }) > q({ name: 'Чечевица варёная', cat: 'legume', protein: 9 }))
})

test('коллаген и желатин — ноль в зачёт: в них нет триптофана', () => {
  for (const name of ['Коллаген порошок', 'Желатин', 'Холодец']) {
    const { diaas } = estimateProteinQuality({ name, protein: 10 })
    assert.equal(diaas, 0, name)
  }
  const day = sumAdvanced([{ name: 'Коллаген порошок', protein: 20, fat: 0, carbs: 0 }])
  assert.equal(day.qualityProtein, 0)
  assert.equal(day.totalProtein, 20)
})

test('растительный протеин не путается с сывороточным', () => {
  assert.equal(estimateProteinQuality({ name: 'Соевый протеин', protein: 25 }).diaas, 0.90)
  assert.equal(estimateProteinQuality({ name: 'Гороховый изолят', protein: 25 }).diaas, 0.82)
  assert.equal(estimateProteinQuality({ name: 'Сывороточный протеин', protein: 25 }).diaas, 1.09)
})

test('зачёт качественного белка непрерывный, без обрыва на пороге', () => {
  // Раньше оценка 7 засчитывалась целиком, 6 — не засчитывалась вовсе.
  const lentils = sumAdvanced([{ name: 'Чечевица варёная', cat: 'legume', protein: 10, fat: 0, carbs: 20 }])
  assert.ok(lentils.qualityProtein > 0, 'чечевица должна давать хоть что-то')
  assert.ok(lentils.qualityProtein < 10, 'но не весь белок целиком')
  assert.ok(Math.abs(lentils.qualityProtein - 5.5) < 0.2, `получилось ${lentils.qualityProtein}`)
})

test('DIAAS выше единицы не даёт бонуса — усечение по рекомендации FAO', () => {
  assert.equal(usableProteinShare(1.13), 1)
  assert.equal(usableProteinShare(0.55), 0.55)
  assert.equal(usableProteinShare(null), null)
  const eggs = sumAdvanced([{ name: 'Яйцо', cat: 'egg', protein: 12, fat: 10, carbs: 0 }])
  assert.equal(eggs.qualityProtein, 12)
})

test('неопознанный продукт не занижает долю качественного белка', () => {
  const known = sumAdvanced([{ name: 'Куриная грудка', cat: 'poultry', protein: 30, fat: 3, carbs: 0 }])
  const withUnknown = sumAdvanced([
    { name: 'Куриная грудка', cat: 'poultry', protein: 30, fat: 3, carbs: 0 },
    { name: 'Штуковина неизвестная', protein: 20, fat: 5, carbs: 5 },
  ])
  assert.equal(known.qualityProteinShare, 1)
  assert.equal(withUnknown.qualityProteinShare, 1, 'доля считается от классифицированного белка')
  assert.equal(withUnknown.qualityProteinConfidence, 'partial', 'но честно помечена как неполная')
  assert.equal(withUnknown.totalProtein, 50)
})

test('день без белка не делит на ноль', () => {
  const a = sumAdvanced([{ name: 'Огурец', cat: 'veg', protein: 0, fat: 0, carbs: 3 }])
  assert.equal(a.qualityProtein, 0)
  assert.equal(a.qualityProteinShare, null)
  assert.equal(a.qualityProteinConfidence, 'none')
  assert.deepEqual(sumAdvanced([]).qualityProteinShare, null)
})

// ── Суммы и ориентиры ─────────────────────────────────────────────────────────

test('sumDay не копит мусор двоичной дроби', () => {
  const t = sumDay([
    { kcal: 27.4, protein: 27.4, carbs: 12.3, fat: 0.1 },
    { kcal: 12.3, protein: 12.3, carbs: 77, fat: 0.2 },
    { kcal: 77, protein: 77, carbs: 0.1, fat: 0.3 },
  ])
  assert.equal(t.protein, 116.7)
  assert.equal(t.fat, 0.6)
})

test('sumDay игнорирует мусор вместо NaN', () => {
  const t = sumDay([{ kcal: 'сто', protein: null, carbs: undefined, fat: {} }, { kcal: 10, protein: 2, carbs: 3, fat: 1 }])
  assert.deepEqual(t, { kcal: 10, protein: 2, carbs: 3, fat: 1 })
})

test('ориентиры ВОЗ считаются от целевых калорий', () => {
  assert.equal(sugarLimit(2000), 50)   // 10% калорий / 4
  assert.equal(satFatLimit(2000), 22)  // 10% калорий / 9
  assert.equal(fiberGoal(), 30)
})

test('свободные сахара: фрукт — не сахар, сок — сахар', () => {
  const q = sumQuality([
    { name: 'Яблоко', carbs: 20 },
    { name: 'Сок апельсиновый', carbs: 20 },
    { name: 'Молоко', carbs: 10 },
  ])
  assert.equal(q.freeSugar, 20, 'только сок')
})

test('оценка углеводов не срабатывает на пустом дне', () => {
  assert.equal(carbGrade({ freeSugar: 0, sugarLimit: 50, fiber: 0, fiberGoal: 30, carbs: 0 }).level, 'none')
  assert.equal(carbGrade({ freeSugar: 10, sugarLimit: 50, fiber: 30, fiberGoal: 30, carbs: 200 }).level, 'good')
  assert.equal(carbGrade({ freeSugar: 90, sugarLimit: 50, fiber: 30, fiberGoal: 30, carbs: 200 }).level, 'bad')
})

test('цели описаны для всех уровней активности и всех целей', () => {
  for (const k of ['sedentary', 'light', 'moderate', 'high']) assert.ok(ACTIVITY[k]?.label)
  for (const k of ['lose', 'maintain', 'gain']) assert.ok(GOALS[k]?.label)
})
