// ─────────────────────────────────────────────────────────────────────────────
// Глоссарий терминов: как каждое ключевое понятие продукта называется на
// каждом языке. Переводчик сверяется с ним, тесты (src/lib/i18nQuality.test.js)
// — тоже:
//   • terms    — каноническое слово для понятия; оно обязано встречаться в
//                словарях языка (глоссарий не может разойтись с текстом);
//   • avoid    — написания, которые запрещены, потому что для понятия уже
//                выбрано другое слово (смесь «Präparat» и «Supplement» в одном
//                интерфейсе читается как два разных понятия);
//   • loanwords— слова, которые в этом языке законно совпадают с английскими
//                («Snack» по-немецки, «Popular» по-испански). Строка, дословно
//                равная английской, допустима, только если состоит из таких
//                слов, единиц, чисел и плейсхолдеров — так ловится забытый
//                перевод без списка исключений по ключам.
// ─────────────────────────────────────────────────────────────────────────────
export default {
  ru: {
    terms: { protein: 'Белки', carbs: 'Углеводы', fat: 'Жиры', supplements: 'Добавки', vitamins: 'витамин', meal: 'Приём пищи', recipe: 'Рецепт', serving: 'Порция', statistics: 'Статистика', goal: 'Цель', challenge: 'Челлендж', coach: 'Тренер', diary: 'Дневник' },
    avoid: [],
    loanwords: [],
  },
  en: {
    terms: { protein: 'Protein', carbs: 'Carbs', fat: 'Fat', supplements: 'Supplements', vitamins: 'vitamin', meal: 'meal', recipe: 'Recipe', serving: 'serving', statistics: 'Statistics', goal: 'goal', challenge: 'Challenge', coach: 'Coach', diary: 'diary' },
    avoid: [/\bcarbohydrates\b(?![^{]*\})/i],
    loanwords: [],
  },
  de: {
    terms: { protein: 'Eiweiß', carbs: 'Kohlenhydrate', fat: 'Fett', supplements: 'Supplements', vitamins: 'Vitamin', meal: 'Mahlzeit', recipe: 'Rezept', serving: 'Portion', statistics: 'Statistik', goal: 'Ziel', challenge: 'Challenge', coach: 'Coach', diary: 'Tagebuch' },
    // Nährstoff heißt Eiweiß; «Protein» — только как вид добавки (Whey-Protein)
    // и в составных словах (Proteinshake).
    avoid: [/Präparat/, /Nahrungsergänzungsmittel/],
    loanwords: ['Feed', 'Snack', 'Snacks', 'Desserts', 'Cocktails', 'Name', 'Maximum', 'Minimum', 'Support', 'Export', 'App', 'Barcode', 'Challenges', 'Supplement', 'Portion', 'online', 'optional', 'BMI', 'Stack', 'ok', 'McDonald’s', 'auto', 'Bio', 'Code', 'Motivator', 'Coach', 'Hunger', 'Stress'],
  },
  es: {
    terms: { protein: 'Proteínas', carbs: 'Carbohidratos', fat: 'Grasas', supplements: 'Suplementos', vitamins: 'vitamina', meal: 'comida', recipe: 'Receta', serving: 'ración', statistics: 'Estadísticas', goal: 'objetivo', challenge: 'Reto', coach: 'Entrenador', diary: 'diario' },
    avoid: [/hidratos de carbono/i, /\bcomplementos?\b/i, /\bporción\b/i],
    loanwords: ['No', 'Manual', 'Alcohol', 'Snacks', 'Pasta', 'base', 'Base', 'Bases', 'Error', 'Popular', 'Bio', 'App', 'ok', 'McDonald’s', 'auto'],
  },
  pt: {
    terms: { protein: 'Proteínas', carbs: 'Carboidratos', fat: 'Gorduras', supplements: 'Suplementos', vitamins: 'vitamina', meal: 'Refeição', recipe: 'Receita', serving: 'porção', statistics: 'Estatísticas', goal: 'meta', challenge: 'Desafio', coach: 'Treinador', diary: 'diário' },
    // Português do Brasil: «celular», «arquivo», não «telemóvel», «ficheiro».
    avoid: [/telemóvel/i, /ficheiro/i, /\becrã\b/i, /\butilizador/i],
    loanwords: ['Feed', 'Manual', 'Fast', 'food', 'Base', 'Bases', 'Volume', 'online', 'Bio', 'App', 'Popular', 'scoop', 'ok', 'McDonald’s', 'auto'],
  },
  tr: {
    terms: { protein: 'Protein', carbs: 'Karbonhidrat', fat: 'Yağ', supplements: 'Takviye', vitamins: 'vitamin', meal: 'Öğün', recipe: 'Tarif', serving: 'Porsiyon', statistics: 'İstatistik', goal: 'hedef', challenge: 'Meydan okuma', coach: 'Koç', diary: 'günlük' },
    avoid: [/\bsupplement/i],
    loanwords: ['Protein', 'protein', 'tablet', 'Fast', 'food', 'McDonald’s'],
  },
  ar: {
    terms: { protein: 'بروتين', carbs: 'كربوهيدرات', fat: 'دهون', supplements: 'المكمّلات', vitamins: 'فيتامين', meal: 'وجبة', recipe: 'وصفة', serving: 'حصة', statistics: 'الإحصاءات', goal: 'هدف', challenge: 'تحدي', coach: 'المدرب', diary: 'سجل' },
    avoid: [],
    loanwords: [],
  },
}
