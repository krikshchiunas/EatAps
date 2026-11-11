// @i18n-data-file — иноязычные слова и бренды в названиях товаров.
// ─────────────────────────────────────────────────────────────────────────────
// Категория продукта, которого нет в нашем каталоге: товар со штрихкода, из
// поиска по Open Food Facts, своя запись с латинским названием.
//
// Вся классификация питательности (свободные сахара, клетчатка, насыщенные
// жиры, качество белка, витамины) держится на категории. Каталог её знает, а
// у товара с полки её не было вовсе: «Country · Kinder» и «Nut-Mix Natural ·
// Trader Joe's» не совпадали ни с одной русской основой и уходили в «прочее».
// Шоколад получал 5% свободных сахаров, орехи — «группа не определена».
//
// Источников два, от надёжного к грубому:
//   1. categories_tags из Open Food Facts — нормализованная английская
//      таксономия («en:chocolates», «en:mixed-nuts»). Это данные о товаре,
//      а не догадка, поэтому они сильнее разбора названия.
//   2. Иноязычные слова и бренды в названии — для записей, у которых тегов нет
//      (старые записи дневника, поиск, ручной ввод латиницей).
//
// Категория «блюдо» отсюда не выдаётся никогда: «блюдо» может быть чем угодно,
// и выдуманная категория перебила бы точный разбор по названию.
// ─────────────────────────────────────────────────────────────────────────────

// ── 1. Таксономия Open Food Facts ────────────────────────────────────────────
// Теги идут от общего к частному, и у одного товара их десяток: у Kinder
// Country это и «snacks», и «chocolates», у солёного арахиса — и
// «salty-snacks», и «nuts». Поэтому решает не порядок тегов, а порядок правил:
// первое правило, которому соответствует хоть один тег, и побеждает. Узкое
// стоит раньше широкого — шоколад с орехами это шоколад, солёный арахис — орех.
const OFF_RULES = [
  ['supp', ['dietary-supplements', 'protein-powders', 'bodybuilding-supplements', 'protein-bars', 'whey-proteins']],
  // Мороженое и пудинги — «сладкое», как и в нашем каталоге («мороженое» в
  // подсказках категорий). «Десерт» у нас — категория блюд, и порции у неё
  // тарелочные, а не «ложка / кусок».
  ['sweet', ['ice-creams', 'ice-creams-and-sorbets', 'frozen-desserts', 'dairy-desserts', 'puddings', 'desserts']],
  ['sweet', [
    'chocolates', 'chocolate-candies', 'chocolate-bars', 'filled-chocolate-bars', 'confectioneries', 'candies',
    'bonbons', 'sweet-spreads', 'cocoa-and-hazelnuts-spreads', 'hazelnut-spreads', 'honeys', 'jams', 'syrups',
    'sugars', 'marshmallows', 'chewing-gum', 'gummies', 'cereal-bars', 'sweeteners',
    // Печенье, вафли и торты в нашем каталоге — сладости, а не выпечка:
    // «выпечка» здесь — булочки и пирожки, в том числе несладкие.
    'biscuits', 'cookies', 'cakes', 'biscuits-and-cakes', 'waffles', 'muffins', 'donuts', 'brownies',
  ]],
  ['pastry', ['pastries', 'viennoiseries', 'croissants', 'brioches']],
  ['nut', [
    'nuts', 'mixed-nuts', 'nuts-and-their-products', 'nut-butters', 'peanut-butters', 'peanuts', 'almonds',
    'cashew-nuts', 'hazelnuts', 'walnuts', 'pistachios', 'seeds', 'sunflower-seeds', 'pumpkin-seeds',
    'chia-seeds', 'flax-seeds', 'sesame-seeds',
  ]],
  ['snack', ['salty-snacks', 'crisps', 'chips', 'potato-crisps', 'popcorn', 'crackers', 'pretzels', 'appetizers']],
  // Творог раньше сыров: у него свой тег, а по составу он молочный, не сыр.
  ['dairy', ['cottage-cheeses', 'quarks']],
  ['cheese', ['cheeses']],
  ['dairy', ['dairies', 'milks', 'yogurts', 'fermented-milk-products', 'creams', 'butters', 'kefirs']],
  ['legume', ['legumes', 'pulses', 'beans', 'lentils', 'chickpeas', 'legumes-and-their-products', 'tofu']],
  ['bread', ['breads', 'sliced-breads', 'flatbreads', 'crispbreads', 'rusks', 'toasts', 'wraps', 'tortillas', 'bagels']],
  ['pasta', ['pastas', 'dry-pastas', 'fresh-pastas', 'noodles']],
  ['pizza', ['pizzas']],
  ['soups', ['soups']],
  ['grain', ['breakfast-cereals', 'cereal-grains', 'rices', 'oat-flakes', 'rolled-oats', 'mueslis', 'granolas', 'flours', 'cereals-and-their-products']],
  ['poultry', ['poultries', 'chickens', 'chicken-breasts', 'turkeys']],
  ['meat', ['meats', 'prepared-meats', 'sausages', 'hams', 'bacons', 'salamis', 'beef', 'pork', 'meats-and-their-products']],
  ['fish', ['fishes', 'fatty-fishes', 'lean-fishes', 'salmons', 'tunas', 'canned-fishes', 'smoked-fishes', 'sardines', 'mackerels']],
  ['sea', ['seafood', 'crustaceans', 'shrimps', 'prawns', 'mussels', 'molluscs']],
  ['egg', ['eggs', 'chicken-eggs']],
  ['oil', ['vegetable-oils', 'oils', 'olive-oils', 'fats', 'vegetable-fats', 'margarines']],
  ['sauce', ['sauces', 'condiments', 'ketchup', 'mayonnaises', 'dressings', 'salad-dressings', 'mustards']],
  // Напитки — до фруктов и овощей: сок в базе лежит и под «fruit-based».
  ['drink', [
    'beverages', 'drinks', 'waters', 'sodas', 'juices-and-nectars', 'fruit-juices', 'nectars', 'plant-based-beverages',
    'plant-based-milk-alternatives', 'iced-teas', 'energy-drinks', 'carbonated-drinks', 'alcoholic-beverages',
    'beers', 'wines', 'smoothies',
  ]],
  ['berry', ['berries', 'strawberries', 'blueberries', 'raspberries']],
  ['fruit', ['fruits', 'dried-fruits', 'fruits-based-foods', 'fresh-fruits', 'compotes', 'canned-fruits']],
  ['veg', ['vegetables', 'vegetables-based-foods', 'fresh-vegetables', 'canned-vegetables', 'frozen-vegetables', 'potatoes', 'mushrooms', 'pickles']],
  // Самые общие — последними: только если ничего точнее не нашлось.
  ['sweet', ['sweet-snacks']],
  ['snack', ['snacks']],
].map(([cat, names]) => [cat, new Set(names)])

// «en:mixed-nuts» → «mixed-nuts». Префикс языка у тега бывает и двух-, и
// трёхбуквенный; неизвестные базе категории остаются на языке автора.
const tagName = (tag) => String(tag || '').toLowerCase().replace(/^[a-z]{2,3}:/, '')

export function categoryFromOff(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return null
  const names = new Set(tags.map(tagName))
  for (const [cat, set] of OFF_RULES) {
    for (const n of names) if (set.has(n)) return cat
  }
  return null
}

// Напиток ли это — по тегам. Отдельно от категории: молоко по категории
// молочное, а наливают его всё равно в миллилитрах.
//
// Главная ловушка — «en:plant-based-foods-and-beverages». Этот тег стоит у
// ВСЕХ растительных продуктов: у орехов, круп, хлеба, овощей. Прежняя проверка
// искала подстроку «beverages» и превращала пачку орехов в напиток: «40 мл»,
// стаканчик вместо иконки, порции «стакан / банка».
const DRINK_TAGS = new Set([
  'beverages', 'drinks', 'waters', 'sodas', 'juices-and-nectars', 'fruit-juices', 'nectars', 'milks',
  'plant-based-beverages', 'plant-based-milk-alternatives', 'iced-teas', 'energy-drinks', 'carbonated-drinks',
  'alcoholic-beverages', 'beers', 'wines', 'smoothies', 'dairy-drinks', 'drinkable-yogurts',
])

export function isDrinkTag(tag) {
  const n = tagName(tag)
  if (n.includes('foods-and-beverages')) return false
  if (DRINK_TAGS.has(n)) return true
  if (/-(beverages|drinks)$/.test(n)) return true
  // Категории, которых нет в таксономии, база хранит на языке автора.
  return /(^|-)(boissons|getranke|напитки)(-|$)/.test(n)
}

// ── 2. Иноязычные слова и бренды в названии ──────────────────────────────────
// Правила совпадения те же, что в foodMicros.js:
//   'choco'       — начало слова: chocolate, chocolat, chocos;
//   '=nut'        — слово целиком: иначе «nut» забрал бы «nutella» и «nutrition»;
//   'ice cream'   — фраза, ищется целиком.
// Порядок важен так же, как у тегов: «peanut butter» — орехи, а не масло,
// «ice cream» — сладкое, а не сливки, «almond milk» и «orange juice» — напитки,
// а не орехи и не фрукты, «tomato ketchup» — соус, а не овощ.
const NAME_RULES = [
  ['drink', [
    'almond milk', 'oat milk', 'soy milk', 'soya milk', 'rice milk', 'iced tea', 'ice tea',
    '=juice', '=juices', '=saft', '=nectar', 'smoothie', 'dr pepper',
    // es / pt / tr
    '=zumo', '=jugo', '=suco', 'meyve suyu', '=refresco', 'refrigerante', 'gazoz', '=cafe', 'leche de almendra', 'leite de amendoa',
  ]],
  ['sweet', ['ice cream', '=gelato', '=sorbet', 'frozen yogurt', '=pudding', 'tiramisu', 'cheesecake', 'eiscreme']],
  ['supp', ['=protein', '=whey', 'isolate', 'casein', 'gainer']],
  ['nut', ['peanut butter', 'almond butter', 'cashew butter', 'nut butter']],
  ['snack', ['=chips', '=crisps', 'popcorn', 'pretzel', 'cracker', 'nachos', 'pringles', '=lays', 'doritos', 'cheetos']],
  ['sweet', [
    'choco', 'schoko', '=candy', 'candies', 'bonbon', 'caramel', 'karamell', 'toffee', '=fudge', 'marshmallow',
    'gummy', 'gummies', 'gummi', 'lollipop', 'praline', 'nougat', 'marzipan', 'licorice', 'liquorice', '=jam',
    '=honey', 'syrup', '=sweets', 'nutella',
    'cikolata', 'caramelo', 'dulce', '=doce', '=doces', 'tatli', '=miel', '=mel', '=bal', 'helado', 'sorvete', 'dondurma',
    'azucar', 'acucar', '=seker', 'chuche', 'golosina', 'bombom', 'lokum',
    // Бренды, у которых в линейке только сладкое. Название товара со штрихкода
    // нередко вовсе не содержит слова «шоколад»: «Country · Kinder».
    '=kinder', '=milka', 'snickers', '=twix', '=mars', '=bounty', 'kitkat', 'kit kat', 'ferrero', 'raffaello',
    'toblerone', '=lindt', 'ritter sport', 'haribo', '=oreo', 'hershey', 'reese', 'cadbury', 'alpen gold',
    'milky way', 'skittles', 'm&m',
    'киндер', 'сникерс', '=твикс', 'баунти', '=милка', '=марс', 'нутелл', 'рафаэлло', 'ферреро', 'тоблерон',
    'альпен гольд', 'харибо', '=орео', 'милки вэй',
  ]],
  ['sweet', ['galleta', 'bolacha', 'biscoito', 'biskuvi', 'kurabiye', 'bizcocho', '=bolo', 'pastel', 'cookie', 'biscuit', '=wafer', '=wafers', 'waffle', 'waffel', 'brownie', 'donut', 'doughnut', 'muffin', 'cupcake', '=cake', '=cakes', '=keks', '=kekse', 'kuchen']],
  ['pastry', ['croissant', 'pastry', 'pastries', 'brioche']],
  ['cheese', ['cheese', '=kase', '=queso', '=queijo', 'peynir', 'cheddar', 'mozzarella', 'parmesan', 'parmigiano', '=gouda', '=feta', '=brie', 'camembert', 'emmental', 'halloumi']],
  ['dairy', ['=milk', '=milch', '=leche', '=leite', '=sut', 'yogur', 'iogurte', 'yogurt', 'yoghurt', 'joghurt', 'jogurt', 'kefir', '=skyr', '=quark', '=cream', '=butter', 'buttermilk']],
  ['nut', [
    '=nut', '=nuts', 'nutmix', 'almond', 'cashew', 'peanut', 'pistachio', 'hazelnut', 'walnut', '=pecan', 'pecans',
    'macadamia', 'trail mix', '=mandeln', 'nuss', 'nusse', 'erdnuss', '=seeds', '=chia', 'flaxseed', 'sunflower seed', 'pumpkin seed',
    'frutos secos', 'almendra', 'amendoa', 'cacahuete', '=mani', 'amendoim', '=nuez', 'nueces', '=nozes', 'castanha', 'avellana',
    'avela', 'findik', 'ceviz', 'badem', 'fistik', 'kuruyemis', 'pipas',
  ]],
  ['legume', ['=beans', '=bean', 'lentil', 'chickpea', 'hummus', '=tofu', 'edamame', 'lenteja', 'lentilha', 'mercimek', 'garbanzo', 'grao de bico', 'nohut', 'frijol', 'feijao', 'fasulye']],
  ['bread', ['bread', '=brot', '=pan', '=pao', 'ekmek', '=toast', 'bagel', 'tortilla', 'baguette', 'ciabatta']],
  ['pasta', ['pasta', 'makarna', 'spaghetti', 'noodle', '=penne', 'macaroni', 'fusilli', 'tagliatelle', 'nudeln']],
  ['grain', ['arroz', 'pirinc', 'avena', 'aveia', 'yulaf', '=oat', '=oats', 'oatmeal', 'porridge', 'granola', 'muesli', 'musli', 'cereal', '=rice', 'quinoa', 'buckwheat', 'couscous', 'bulgur']],
  ['poultry', ['chicken', 'turkey', '=hahnchen', '=pute', 'pollo', 'frango', 'tavuk', '=pavo', '=peru']],
  ['meat', ['carne', '=et', 'jamon', 'presunto', 'cerdo', 'ternera', 'sucuk', '=beef', '=pork', '=ham', 'bacon', 'salami', 'sausage', 'jerky', '=wurst', 'schinken', '=lamb', '=steak']],
  ['fish', ['pescado', 'peixe', 'balik', '=atun', '=atum', 'salmon', '=tuna', '=fish', 'sardine', 'mackerel', '=cod', 'herring', '=lachs', 'thunfisch']],
  ['sea', ['shrimp', 'prawn', 'mussel', 'squid', 'seafood']],
  ['egg', ['=egg', '=eggs', '=eier', '=huevo', '=huevos', '=ovo', '=ovos', '=yumurta']],
  ['sauce', ['sauce', 'ketchup', '=mayo', 'mayonnaise', 'mustard', 'dressing', 'pesto', 'salsa']],
  ['oil', ['=oil', 'olive oil', '=ol']],
  ['drink', [
    '=soda', '=cola', '=coca', 'lemonade', 'limonade', '=water', '=wasser', '=tea', 'coffee',
    'kaffee', '=beer', '=bier', '=wine', '=wein', '=drink', 'pepsi', 'fanta', 'sprite',
    '=agua', '=cerveza', '=cerveja', '=bira', '=vino', '=vinho', '=sarap', '=cay', '=te', '=cha', '=kahve',
  ]],
  ['berry', ['berry', 'berries', 'beeren', 'strawberr', 'blueberr', 'raspberr', 'cranberr']],
  ['fruit', ['manzana', '=maca', '=elma', 'platano', '=muz', 'naranja', 'laranja', 'portakal', '=fruta', '=frutas', 'meyve', 'uzum', '=uva', '=uvas', '=apple', '=apples', 'banana', '=orange', '=oranges', 'mango', 'pineapple', 'raisin', '=fruit', '=fruits', '=apfel', '=obst']],
  ['veg', ['verdura', 'sebze', 'patata', 'patates', 'tomate', 'domates', 'zanahoria', 'cenoura', 'havuc', 'brokkoli', 'vegetable', 'broccoli', 'spinach', 'carrot', 'tomato', 'potato', 'cucumber', 'bell pepper', 'mushroom', 'gemuse', 'kartoffel']],
]

// Нижний регистр, ё → е, без диакритики у латиницы: «Müsli» и «Musli», «Käse»
// и «Kase» должны совпасть с одной основой. Кириллицу не трогаем: разложение
// превратило бы «й» в «и», и «йогурт» перестал бы находиться.
export const foldName = (s) => String(s || '')
  .toLowerCase()
  .replace(/ё/g, 'е')
  // Турецкая «ı» не раскладывается на «i» с диакритикой — заменяем отдельно.
  .replace(/ı/g, 'i')
  .replace(/[\u00c0-\u024f]/g, (c) => c.normalize('NFD').replace(/\p{M}/gu, ''))

// Название → слова и фраза для сопоставления с основами. Фраза — слова через
// один пробел с пробелами по краям: «Kit-Kat» и «kit  kat» одинаковы.
export function nameTokens(name) {
  const words = foldName(name).split(/[^\p{L}\p{N}&%]+/u).filter(Boolean)
  return { words, phrase: ' ' + words.join(' ') + ' ' }
}

// Правила основы — общие для категорий (здесь) и справочника состава
// (carbRef.js):
//   'choco'       — начало слова;
//   '=nut'        — слово целиком;
//   'ice cream'   — фраза с начала слова («ice tea» не находится в «price tea»);
//   'йогурт+клубн' — все части есть в названии, в любом порядке.
// Основы-фразы неизменны — разбираем каждую один раз.
const PHRASES = new Map()
function phraseOf(stem) {
  let p = PHRASES.get(stem)
  if (p === undefined) { p = ' ' + nameTokens(stem).words.join(' '); PHRASES.set(stem, p) }
  return p
}

export function stemHit({ words, phrase }, stem) {
  if (stem.includes('+')) return stem.split('+').every((part) => stemHit({ words, phrase }, part))
  if (stem.startsWith('=')) return words.includes(stem.slice(1))
  // Фраза разбирается так же, как название: «по-деревенски» и «хот-дог»
  // ищутся как «по деревенски» и «хот дог».
  if (stem.includes(' ') || /[^\p{L}\p{N}&%]/u.test(stem)) return phrase.includes(phraseOf(stem))
  return words.some((w) => w.startsWith(stem))
}

const nameCache = new Map()
const NAME_CACHE_LIMIT = 4000

export function categoryFromName(name) {
  const key = String(name || '')
  if (nameCache.has(key)) return nameCache.get(key)
  const tokens = nameTokens(key)
  let found = null
  if (tokens.words.length) {
    outer: for (const [cat, stems] of NAME_RULES) {
      for (const s of stems) {
        if (stemHit(tokens, s)) { found = cat; break outer }
      }
    }
  }
  if (nameCache.size >= NAME_CACHE_LIMIT) nameCache.clear()
  nameCache.set(key, found)
  return found
}
