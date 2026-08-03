// Calories from pure alcohol: ml × (pct/100) × 0.789 g/ml × 7 kcal/g
export function alcKcal(ml, pct) {
  return Math.round(ml * (pct / 100) * 0.789 * 7)
}

export const BEER_BRANDS = [
  // Alcoholic
  { name: 'Heineken', alc: 5.0, kcal100: 43 },
  { name: 'Балтика 7', alc: 5.4, kcal100: 44 },
  { name: 'Балтика 3', alc: 4.8, kcal100: 42 },
  { name: 'Carlsberg', alc: 5.0, kcal100: 43 },
  { name: 'Corona Extra', alc: 4.6, kcal100: 42 },
  { name: 'Budweiser', alc: 5.0, kcal100: 43 },
  { name: 'Stella Artois', alc: 5.0, kcal100: 44 },
  { name: 'Guinness Draught', alc: 4.2, kcal100: 37 },
  { name: 'Hoegaarden', alc: 4.9, kcal100: 44 },
  { name: 'Жигулёвское', alc: 4.0, kcal100: 38 },
  { name: 'Золотая Бочка', alc: 5.0, kcal100: 43 },
  { name: 'Тинькофф', alc: 4.6, kcal100: 41 },
  { name: 'Арсенальное Крепкое', alc: 7.0, kcal100: 60 },
  { name: 'Охота Крепкое', alc: 8.0, kcal100: 67 },
  { name: 'Miller', alc: 4.7, kcal100: 42 },
  { name: 'Amstel', alc: 5.0, kcal100: 43 },
  { name: "Beck's", alc: 5.0, kcal100: 43 },
  { name: 'Pilsner Urquell', alc: 4.4, kcal100: 40 },
  { name: 'Franziskaner', alc: 5.0, kcal100: 50 },
  { name: 'Paulaner', alc: 4.9, kcal100: 47 },
  // Non-alcoholic
  { name: 'Heineken 0.0', alc: 0.0, kcal100: 21, na: true },
  { name: 'Балтика 0', alc: 0.0, kcal100: 25, na: true },
  { name: 'Carlsberg 0.0', alc: 0.0, kcal100: 22, na: true },
  { name: 'Clausthaler', alc: 0.4, kcal100: 22, na: true },
  { name: 'Erdinger Alkoholfrei', alc: 0.4, kcal100: 25, na: true },
]

export const SPIRIT_TYPES = [
  {
    key: 'vodka', label: 'Водка', emoji: '🥃', defaultAlc: 40,
    brands: ['Абсолют', 'Белуга', 'Финляндия', 'Столичная', 'Nemiroff', 'Хортиця', 'Grey Goose'],
  },
  {
    key: 'whisky', label: 'Виски', emoji: '🥃', defaultAlc: 40,
    brands: ["Jack Daniel's", 'Johnnie Walker', 'Jameson', 'Chivas Regal', "Ballantine's", 'Jim Beam', 'Glenfiddich'],
  },
  {
    key: 'rum', label: 'Ром', emoji: '🥃', defaultAlc: 40,
    brands: ['Bacardi', 'Captain Morgan', 'Havana Club', 'Diplomatico', 'Malibu'],
  },
  {
    key: 'gin', label: 'Джин', emoji: '🍸', defaultAlc: 40,
    brands: ['Bombay Sapphire', "Hendrick's", 'Tanqueray', 'Beefeater', 'Gordon\'s'],
  },
  {
    key: 'tequila', label: 'Текила', emoji: '🥃', defaultAlc: 38,
    brands: ['Jose Cuervo', 'Patron', 'Don Julio', 'Olmeca', '1800'],
  },
  {
    key: 'cognac', label: 'Коньяк', emoji: '🥃', defaultAlc: 40,
    brands: ['Hennessy', 'Rémy Martin', 'Martell', 'Camus', 'Арарат', 'КВ'],
  },
  {
    key: 'brandy', label: 'Бренди', emoji: '🥃', defaultAlc: 36,
    brands: ['Torres', 'Metaxa', 'Fundador'],
  },
  {
    key: 'liqueur', label: 'Ликёр', emoji: '🍶', defaultAlc: 20,
    brands: ['Baileys', 'Kahlúa', 'Cointreau', 'Amaretto', 'Sambuca', 'Jägermeister'],
  },
  {
    key: 'moonshine', label: 'Самогон / Другое', emoji: '🥃', defaultAlc: 45,
    brands: [],
  },
]

// name = Russian display name, nameEn = English aliases for search, alc = avg %, kcal100 = approx kcal/100ml
export const COCKTAILS = [
  { name: 'Мохито', nameEn: 'Mojito', alc: 8, kcal100: 72, emoji: '🍹' },
  { name: 'Пина Колада', nameEn: 'Pina Colada', alc: 8, kcal100: 180, emoji: '🍹' },
  { name: 'Маргарита', nameEn: 'Margarita', alc: 15, kcal100: 130, emoji: '🍸' },
  { name: 'Дайкири', nameEn: 'Daiquiri', alc: 14, kcal100: 120, emoji: '🍸' },
  { name: 'Космополитен', nameEn: 'Cosmopolitan', alc: 14, kcal100: 130, emoji: '🍸' },
  { name: 'Кровавая Мэри', nameEn: 'Bloody Mary', alc: 10, kcal100: 90, emoji: '🍹' },
  { name: 'Апероль Шприц', nameEn: 'Aperol Spritz', alc: 8, kcal100: 72, emoji: '🥂' },
  { name: 'Негрони', nameEn: 'Negroni', alc: 24, kcal100: 195, emoji: '🍸' },
  { name: 'Старомодный', nameEn: 'Old Fashioned', alc: 28, kcal100: 230, emoji: '🥃' },
  { name: 'Мартини', nameEn: 'Martini', alc: 28, kcal100: 220, emoji: '🍸' },
  { name: 'Белый Русский', nameEn: 'White Russian', alc: 18, kcal100: 210, emoji: '🥃' },
  { name: 'Чёрный Русский', nameEn: 'Black Russian', alc: 24, kcal100: 165, emoji: '🥃' },
  { name: 'Длинный Айленд', nameEn: 'Long Island Ice Tea', alc: 16, kcal100: 142, emoji: '🍹' },
  { name: 'Секс на пляже', nameEn: 'Sex on the Beach', alc: 8, kcal100: 90, emoji: '🍹' },
  { name: 'Отвёртка', nameEn: 'Screwdriver', alc: 12, kcal100: 110, emoji: '🍊' },
  { name: 'Ром с Колой', nameEn: 'Rum and Cola', alc: 8, kcal100: 80, emoji: '🥤' },
  { name: 'Джин-Тоник', nameEn: 'Gin and Tonic', alc: 7, kcal100: 68, emoji: '🍸' },
  { name: 'Виски с Колой', nameEn: 'Whisky and Cola', alc: 8, kcal100: 80, emoji: '🥤' },
  { name: 'Текила Санрайз', nameEn: 'Tequila Sunrise', alc: 10, kcal100: 95, emoji: '🍹' },
  { name: 'Мимоза', nameEn: 'Mimosa', alc: 6, kcal100: 60, emoji: '🥂' },
  { name: 'Кир Рояль', nameEn: 'Kir Royale', alc: 8, kcal100: 75, emoji: '🥂' },
  { name: 'Беллини', nameEn: 'Bellini', alc: 6, kcal100: 65, emoji: '🥂' },
  { name: 'Французский 75', nameEn: 'French 75', alc: 14, kcal100: 120, emoji: '🥂' },
  { name: 'Тёмный и Штормовой', nameEn: 'Dark and Stormy', alc: 8, kcal100: 78, emoji: '🍹' },
  { name: 'Сидкар', nameEn: 'Sidecar', alc: 20, kcal100: 175, emoji: '🍸' },
  { name: 'Авиация', nameEn: 'Aviation', alc: 18, kcal100: 155, emoji: '🍸' },
  { name: 'Лимонадный Коллинз', nameEn: 'Tom Collins', alc: 7, kcal100: 65, emoji: '🍹' },
  { name: 'Пчелиный Укус', nameEn: "Bee's Knees", alc: 18, kcal100: 155, emoji: '🍸' },
  { name: 'Ирландский Кофе', nameEn: 'Irish Coffee', alc: 10, kcal100: 140, emoji: '☕' },
  { name: 'Б-52', nameEn: 'B-52', alc: 22, kcal100: 215, emoji: '🔥' },
  { name: 'Малибу с Ананасом', nameEn: 'Malibu Pineapple', alc: 8, kcal100: 95, emoji: '🍹' },
  { name: 'Голубая Лагуна', nameEn: 'Blue Lagoon', alc: 8, kcal100: 88, emoji: '💙' },
  { name: 'Гарвей Уолбэнгер', nameEn: 'Harvey Wallbanger', alc: 9, kcal100: 90, emoji: '🍊' },
  { name: 'Сингапурский Слинг', nameEn: 'Singapore Sling', alc: 10, kcal100: 115, emoji: '🍹' },
  { name: 'Клубный Сауэр', nameEn: 'Whisky Sour', alc: 14, kcal100: 120, emoji: '🍋' },
  { name: 'Алебастровый Гонзо', nameEn: 'Alabama Slammer', alc: 12, kcal100: 115, emoji: '🍹' },
  { name: 'Кадиллак', nameEn: 'Cadillac Margarita', alc: 15, kcal100: 135, emoji: '🍸' },
  { name: 'Клевер Клуб', nameEn: 'Clover Club', alc: 15, kcal100: 130, emoji: '🍸' },
  { name: 'Лимончелло', nameEn: 'Limoncello Spritz', alc: 8, kcal100: 75, emoji: '🍋' },
  { name: 'Самбука', nameEn: 'Sambuca Shot', alc: 38, kcal100: 280, emoji: '🔥' },
  { name: 'Ягермейстер', nameEn: 'Jagermeister Shot', alc: 35, kcal100: 255, emoji: '🦌' },
  { name: 'Токийский Чай', nameEn: 'Tokyo Tea', alc: 16, kcal100: 145, emoji: '🍵' },
  { name: 'Бермудский Треугольник', nameEn: 'Bermuda Triangle', alc: 12, kcal100: 110, emoji: '🍹' },
  { name: 'Эльдорадо', nameEn: 'El Diablo', alc: 10, kcal100: 95, emoji: '🌶️' },
  { name: 'Апельсиновый Мечтатель', nameEn: 'Fuzzy Navel', alc: 8, kcal100: 85, emoji: '🍊' },
  { name: 'Медовый Укус', nameEn: 'Bee Sting', alc: 10, kcal100: 100, emoji: '🍯' },
  { name: 'Клубника с Шампанским', nameEn: 'Strawberry Champagne', alc: 7, kcal100: 70, emoji: '🍓' },
  { name: 'Ром-Пунш', nameEn: 'Rum Punch', alc: 9, kcal100: 90, emoji: '🥊' },
  { name: 'Гранатовый Шприц', nameEn: 'Pomegranate Spritz', alc: 7, kcal100: 72, emoji: '🍷' },
  { name: 'Арбузный Маргарита', nameEn: 'Watermelon Margarita', alc: 12, kcal100: 110, emoji: '🍉' },
]
