// @i18n-data-file — база продуктов: русские названия — канонические данные (переводы по id в src/locales/*/data).
import { searchModule } from './search/lazy.js'
import { fold } from './search/normalize.js'
import { t, fmtNum, getLang, SOURCE_LANG } from './i18n.js'
import { foodName } from './foodNames.js'
import { catalogId } from './catalog.js'
// Русские названия продуктов — в словаре по id (src/locales/ru/data/foods.js),
// здесь только id и цифры: название хранится один раз, а не дважды.
import ruFoods from '../locales/ru/data/foods.js'

const N = ruFoods.foods

// Подписи — геттерами: справочник живёт весь сеанс, а язык может смениться.
export const MEAL_TYPES = [
  { key: 'breakfast', get label() { return t('meal.breakfast') }, emoji: '🌅' },
  { key: 'lunch', get label() { return t('meal.lunch') }, emoji: '🥗' },
  { key: 'dinner', get label() { return t('meal.dinner') }, emoji: '🌙' },
  { key: 'snack', get label() { return t('meal.snack') }, emoji: '🍎' },
]

export function mealMeta(type) {
  return MEAL_TYPES.find((m) => m.key === type) || MEAL_TYPES[3]
}

const CAT_EMOJI = {
  grain: '🌾', legume: '🫘', meat: '🥩', poultry: '🍗', fish: '🐟', sea: '🦐',
  egg: '🥚', dairy: '🥛', cheese: '🧀', veg: '🥦', fruit: '🍎', berry: '🫐',
  nut: '🌰', bread: '🍞', pastry: '🥐', oil: '🫒', sweet: '🍫', drink: '🥤', dish: '🍽️', sauce: '🥫', supp: '💪',
  pasta: '🍝', pizza: '🍕', asian: '🍜', mexican: '🌮', fastfood: '🍔', salad: '🥗', snack: '🍿',
  soups: '🍲', hot: '🍖', seafood2: '🦐', caucasus: '🥘', breakfast: '🍳', dessert: '🍰',
  topping: '🥣', dressing: '🥗', extra: '🥗', psauce: '🍝', gravy: '🍲',
  mcdonalds: '🍟',
}

const DATA = {
  grain: [
    [N.food_buckwheat_dry, 343, 13, 62, 3.4],
    [N.food_rolled_oats_dry, 366, 12, 62, 7],
    [N.food_pearl_barley_cooked, 121, 2.3, 28, 0.4], [N.food_millet_cooked, 90, 3, 17, 0.6],
    [N.food_bulgur_cooked, 83, 3, 19, 0.2], [N.food_quinoa_cooked, 120, 4.4, 21, 1.9],
    [N.food_couscous_cooked, 112, 3.8, 23, 0.2], [N.food_semolina_porridge, 98, 3, 17, 3.2],
    [N.food_pasta_cooked, 158, 6, 31, 0.9, '🍝'], [N.food_wholegrain_spaghetti, 124, 5, 27, 0.5, '🍝'],
    // Виды риса различаются мало по калориям, но заметно по тому, что человек
    // ищет: «басмати» не находится под словом «рис отварной».
    [N.food_basmati_rice_cooked, 130, 2.7, 28, 0.3, '🍚'], [N.food_jasmine_rice_cooked, 130, 2.7, 28, 0.3, '🍚'],
    [N.food_brown_rice_cooked, 112, 2.6, 23, 0.9, '🍚'], [N.food_wild_rice_cooked, 101, 4, 21, 0.3, '🍚'],
    [N.food_spelt_cooked, 127, 5.5, 26, 0.8], [N.food_barley_porridge, 96, 2.3, 20, 0.4],
    [N.food_amaranth_cooked, 102, 3.8, 19, 1.6],
    // Завтраки из коробки
    [N.food_muesli, 375, 9, 66, 8, '🥣'], [N.food_granola, 450, 10, 60, 15, '🥣'],
    [N.food_corn_flakes, 357, 7, 84, 0.4, '🥣'],
    // Формы пасты: варёная паста считается по весу, а не по блюду.
    [N.food_penne_cooked, 157, 6, 30, 0.9, '🍝'], [N.food_fusilli_cooked, 158, 6, 31, 0.9, '🍝'],
    [N.food_tagliatelle_cooked, 160, 6, 31, 1, '🍝'], [N.food_lasagne_sheets_dry, 352, 12, 71, 1.5, '🍝'],
    [N.food_rice_noodles_cooked, 109, 0.9, 25, 0.2, '🍜'], [N.food_soba_noodles, 99, 5, 21, 0.1, '🍜'],
  ],
  legume: [
    [N.food_lentils_cooked, 116, 9, 20, 0.4], [N.food_lentils_dry, 353, 25, 60, 1.1],
    [N.food_chickpeas_cooked, 164, 8.9, 27, 2.6], [N.food_chickpeas_dry, 364, 19, 61, 6],
    [N.food_red_kidney_beans_cooked, 127, 8.7, 23, 0.5], [N.food_white_beans_cooked, 139, 9.7, 25, 0.5],
    [N.food_split_peas_cooked, 118, 8, 21, 0.4], [N.food_mung_beans_cooked, 105, 7, 19, 0.4],
    [N.food_soybeans_cooked, 173, 17, 10, 9], [N.food_tofu, 76, 8, 1.9, 4.8], [N.food_edamame, 121, 12, 9, 5],
    [N.food_red_lentils_dry, 358, 24, 63, 1], [N.food_green_lentils_dry, 353, 25, 60, 1.1],
    [N.food_black_beans_cooked, 132, 8.9, 24, 0.5], [N.food_split_peas_dry, 348, 23, 60, 1.2],
    // Консервы — отдельно: заливка и соль делают их другим продуктом.
    [N.food_canned_beans, 127, 8.7, 23, 0.5], [N.food_canned_chickpeas, 139, 7, 22, 2.5],
    [N.food_tempeh, 193, 19, 9, 11], [N.food_textured_soy_protein, 336, 52, 17, 1],
  ],
  poultry: [
    [N.food_chicken_thigh, 209, 26, 0, 11], [N.food_chicken_wings, 222, 27, 0, 12],
    [N.food_turkey_breast, 135, 29, 0, 1], [N.food_turkey_thigh, 160, 23, 0, 7], [N.food_duck, 337, 19, 0, 28],
    [N.food_chicken_liver, 137, 17, 0.7, 6],
    [N.food_chicken_drumstick, 185, 23, 0, 10], [N.food_boneless_chicken_thigh, 175, 24, 0, 9],
    [N.food_goose, 305, 22, 0, 24],
    [N.food_chicken_nuggets, 296, 15, 18, 18], [N.food_chicken_schnitzel, 270, 19, 14, 15],
  ],
  meat: [
    [N.food_lamb, 294, 25, 0, 21], [N.food_veal, 172, 23, 0, 8], [N.food_rabbit, 173, 21, 0, 9],
    [N.food_ground_beef, 254, 26, 0, 17], [N.food_beef_liver, 135, 20, 4, 3.6], [N.food_bacon, 541, 37, 1.4, 42],
    [N.food_ham, 145, 17, 1.5, 8], [N.food_bologna_sausage, 257, 13, 2, 22], [N.food_frankfurters, 266, 11, 2, 24],
    [N.food_salami, 336, 22, 1, 27],
    // Отрубы. Грудинка и корейка различаются втрое по жиру — считать их одним
    // «свиным мясом» значит ошибаться на 300 ккал в порции.
    [N.food_pork_loin, 242, 27, 0, 14],
    [N.food_pork_belly, 518, 9, 0, 53],
    [N.food_ground_pork, 263, 17, 0, 21], [N.food_mixed_ground_meat, 260, 18, 0, 21],
    [N.food_ground_chicken, 143, 20, 0, 7], [N.food_ground_turkey, 148, 21, 0, 7],
    [N.food_roast_beef, 190, 22, 0, 11], [N.food_roast_pork, 230, 15, 0, 19],
    // Сыровяленое и копчёное
    [N.food_smoked_ham, 240, 18, 0.5, 18], [N.food_cured_smoked_ham, 230, 25, 0.5, 14],
    [N.food_serrano_ham, 241, 31, 0.3, 13], [N.food_prosciutto, 250, 26, 0.5, 16],
    [N.food_parma_ham, 268, 27, 0.4, 18], [N.food_pancetta, 458, 14, 0.5, 45],
    // Колбасы: немецкий и восточноевропейский ассортимент — то, что человек
    // реально берёт с прилавка и не находит под словом «колбаса».
    [N.food_milano_salami, 407, 23, 1, 35], [N.food_pepper_salami, 380, 22, 1.5, 32],
    [N.food_chorizo, 455, 24, 2, 38], [N.food_sucuk, 463, 23, 2, 41], [N.food_pepperoni, 494, 20, 2, 44],
    [N.food_mortadella, 311, 16, 1, 27], [N.food_lyoner_sausage, 290, 12, 1, 26], [N.food_fleischwurst, 300, 12, 1, 27],
    [N.food_bockwurst, 270, 12, 1, 24], [N.food_bratwurst, 297, 13, 1, 26], [N.food_currywurst, 310, 12, 6, 26],
    [N.food_vienna_sausages, 280, 12, 1, 25], [N.food_frankfurter_sausages, 289, 12.5, 1.5, 25],
    [N.food_thuringian_sausage, 300, 14, 0.5, 27], [N.food_krakowska_sausage, 330, 16, 0.5, 30],
    [N.food_mettwurst, 400, 15, 1, 38], [N.food_teewurst, 400, 13, 1, 39], [N.food_jagdwurst, 270, 14, 1, 23],
    [N.food_cervelat, 360, 24, 0, 29], [N.food_doktorskaya_sausage, 257, 13, 2, 22],
    [N.food_liver_sausage, 326, 14, 2, 29], [N.food_pate, 300, 12, 3, 27],
    // Нежирные нарезки — их ищут как «мясо», а не как «птицу».
    [N.food_sliced_turkey, 100, 22, 0, 1.5, '🍗'], [N.food_sliced_chicken, 110, 23, 0, 2, '🍗'],
    [N.food_smoked_turkey, 125, 23, 0.5, 3.5, '🍗'],
  ],
  fish: [
    [N.food_salmon, 208, 20, 0, 13], [N.food_trout, 141, 20, 0, 6], [N.food_tuna_fresh, 144, 23, 0, 5],
    [N.food_canned_tuna_in_water, 116, 26, 0, 1], [N.food_alaska_pollock, 72, 16, 0, 0.9],
    [N.food_herring, 158, 18, 0, 9], [N.food_mackerel, 205, 19, 0, 14], [N.food_pike_perch, 84, 19, 0, 1.1], [N.food_hake, 86, 17, 0, 2],
    [N.food_cod, 82, 18, 0, 0.7], [N.food_haddock, 90, 20, 0, 0.7], [N.food_sea_bass, 97, 18, 0, 2.5],
    [N.food_sea_bream, 96, 19, 0, 2], [N.food_halibut, 111, 21, 0, 2.3], [N.food_flounder, 90, 17, 0, 2.2],
    [N.food_tilapia, 96, 20, 0, 1.7], [N.food_carp, 127, 18, 0, 5.6], [N.food_pink_salmon, 142, 21, 0, 6],
    // Консервы и копчёности считают как отдельный продукт: масло в банке и соль
    // при копчении меняют и калорийность, и жир вдвое против свежей рыбы.
    [N.food_sardines, 208, 25, 0, 11], [N.food_sardines_in_oil, 217, 24, 0, 13], [N.food_anchovies, 131, 20, 0, 5],
    [N.food_canned_tuna_in_oil, 198, 24, 0, 11], [N.food_sprats, 137, 17, 0, 7], [N.food_smoked_sprats_in_oil, 363, 17, 0, 32],
    [N.food_smoked_salmon, 170, 22, 0, 9], [N.food_smoked_mackerel, 317, 21, 0, 26], [N.food_salted_herring, 217, 17, 0, 16],
  ],
  sea: [
    [N.food_shrimp, 99, 24, 0.2, 0.3], [N.food_squid, 92, 18, 3, 1.4], [N.food_mussels, 86, 12, 4, 2],
    [N.food_salmon_roe, 250, 24, 4, 17], [N.food_crab_sticks, 88, 6, 12, 1],
    [N.food_octopus, 82, 15, 2.2, 1], [N.food_crab, 87, 18, 0, 1], [N.food_scallops, 88, 17, 2.4, 0.8],
    [N.food_langoustines, 90, 19, 0, 1.5], [N.food_crayfish, 97, 19, 0, 1.9], [N.food_seafood_mix, 85, 15, 2, 1.5],
  ],
  egg: [
    [N.food_egg_white, 52, 11, 0.7, 0.2], [N.food_quail_egg, 168, 12, 0.6, 13],
    [N.food_boiled_egg, 155, 13, 1.1, 11], [N.food_fried_egg, 196, 14, 0.8, 15],
    [N.food_scrambled_eggs, 148, 10, 1.6, 11], [N.food_omelette, 154, 11, 1.6, 12], [N.food_poached_egg, 143, 12.5, 0.7, 9.5],
  ],
  dairy: [
    [N.food_butter, 717, 0.9, 0.1, 81, '🧈'], [N.food_condensed_milk, 320, 7, 55, 8],
    [N.food_skyr, 63, 11, 4, 0.2], [N.food_creme_fraiche, 292, 2.4, 3, 30], [N.food_whipped_cream, 257, 2.1, 12, 22],
    [N.food_buttermilk, 40, 3.3, 4.8, 0.9], [N.food_ayran, 24, 1.7, 2.5, 0.9], [N.food_whey, 27, 0.8, 5.1, 0.2],
    [N.food_fruit_yogurt, 95, 3.5, 14, 2.5], [N.food_drinking_yogurt, 70, 2.8, 12, 1.5],
    [N.food_sweet_quark_spread, 160, 12, 15, 5], [N.food_evaporated_milk, 135, 7, 10, 7.5],
    [N.food_lactose_free_milk, 47, 3.4, 4.8, 1.5],
    // Растительные «молоки» — разные продукты, а не оттенки одного: кокосовое
    // жирнее миндального в двадцать раз.
    [N.food_oat_milk, 45, 0.3, 6.6, 1.5], [N.food_soy_milk, 33, 3.3, 0.6, 1.8],
    [N.food_almond_milk, 24, 0.5, 3, 1.1], [N.food_coconut_milk, 197, 2, 3, 20],
    [N.food_rice_milk, 47, 0.3, 9.5, 1],
  ],
  cheese: [
    [N.food_rossiyskiy_cheese_semi_hard, 363, 23, 0, 29], [N.food_mozzarella, 280, 22, 2, 17], [N.food_parmesan, 392, 36, 3, 29],
    [N.food_feta, 264, 14, 4, 21], [N.food_ricotta, 174, 11, 3, 13], [N.food_processed_cheese, 226, 12, 4, 18],
    // Полутвёрдые: то, что в Европе лежит в каждом холодильнике. Гауда молодая
    // и выдержанная различаются на 40 ккал — это не дубль, а разный продукт.
    [N.food_gouda, 356, 25, 2, 27], [N.food_young_gouda, 345, 24, 2.2, 26], [N.food_aged_gouda, 398, 28, 2, 31],
    [N.food_edam, 357, 25, 1.4, 28], [N.food_maasdam, 350, 24, 0, 28], [N.food_tilsiter, 340, 24, 1, 26],
    [N.food_emmental, 380, 28, 1.4, 30], [N.food_gruyere, 413, 30, 0.4, 32], [N.food_appenzeller, 403, 25, 0, 33],
    [N.food_alpine_cheese, 400, 27, 0, 32], [N.food_raclette_cheese, 357, 23, 1, 29], [N.food_cheddar, 402, 25, 1.3, 33],
    // Твёрдые тёртые
    [N.food_grana_padano, 384, 33, 0, 28], [N.food_pecorino, 387, 26, 0, 32], [N.food_grated_cheese, 380, 26, 2, 30],
    // Мягкие и свежие
    [N.food_brie, 334, 21, 0.5, 28], [N.food_camembert, 300, 20, 0.5, 24], [N.food_burrata, 330, 17, 2, 28],
    [N.food_cream_cheese, 250, 6, 4, 24], [N.food_mascarpone, 429, 4.6, 4.8, 44],
    // С плесенью
    [N.food_gorgonzola, 350, 19, 0, 31], [N.food_roquefort, 369, 22, 2, 31], [N.food_blue_cheese, 353, 21, 2.3, 29],
    // Рассольные и козьи/овечьи
    [N.food_brynza_brined_cheese, 260, 17, 0, 21], [N.food_suluguni, 290, 20, 0, 24], [N.food_adyghe_cheese, 240, 19, 1.5, 18],
    [N.food_braided_string_cheese, 313, 20, 2, 26], [N.food_goat_cheese, 364, 22, 2.5, 30], [N.food_sheep_cheese, 290, 18, 1, 24],
    [N.food_halloumi, 321, 22, 2.2, 25],
    // Лёгкие версии — реальная разница в жире, а не маркетинг.
    [N.food_light_cheese_30, 280, 30, 1, 17], [N.food_light_cream_cheese, 150, 10, 5, 10],
  ],
  veg: [
    [N.food_sweet_potato, 86, 1.6, 20, 0.1, '🍠'], [N.food_carrot, 41, 0.9, 10, 0.2, '🥕'], [N.food_beetroot, 43, 1.6, 10, 0.2],
    [N.food_white_cabbage, 25, 1.3, 6, 0.1, '🥬'], [N.food_cauliflower, 25, 1.9, 5, 0.3],
    [N.food_brussels_sprouts, 43, 3.4, 9, 0.3],
    [N.food_tomato, 18, 0.9, 3.9, 0.2, '🍅'], [N.food_cucumber, 15, 0.7, 3.6, 0.1, '🥒'],
    [N.food_bell_pepper, 27, 1, 6, 0.3, '🫑'], [N.food_aubergine, 25, 1, 6, 0.2, '🍆'],
    [N.food_onion, 40, 1.1, 9, 0.1, '🧅'], [N.food_garlic, 149, 6, 33, 0.5, '🧄'],
    [N.food_spinach, 23, 2.9, 3.6, 0.4], [N.food_lettuce, 15, 1.4, 2.9, 0.2, '🥬'], [N.food_rocket, 25, 2.6, 3.7, 0.7],
    [N.food_pumpkin, 26, 1, 6.5, 0.1, '🎃'], [N.food_sweetcorn, 86, 3.2, 19, 1.2, '🌽'], [N.food_green_peas, 81, 5, 14, 0.4],
    [N.food_green_beans, 31, 1.8, 7, 0.2], [N.food_avocado, 160, 2, 9, 15, '🥑'],
    [N.food_radish, 16, 0.7, 3.4, 0.1], [N.food_celery, 16, 0.7, 3, 0.2],
    // Капустные
    [N.food_chinese_cabbage, 16, 1.2, 3.2, 0.2, '🥬'], [N.food_red_cabbage, 31, 1.4, 7, 0.2, '🥬'],
    [N.food_savoy_cabbage, 27, 2, 6, 0.1, '🥬'], [N.food_sauerkraut, 19, 1.3, 4, 0.1, '🥬'],
    [N.food_kale, 49, 4.3, 9, 0.9, '🥬'],
    // Луковые и стеблевые
    [N.food_leek, 61, 1.5, 14, 0.3, '🧅'], [N.food_spring_onion, 32, 1.8, 7, 0.5, '🧅'],
    [N.food_red_onion, 40, 1.1, 9, 0.1, '🧅'], [N.food_asparagus, 20, 2.2, 3.9, 0.1],
    [N.food_artichoke, 47, 3.3, 11, 0.2], [N.food_fennel, 31, 1.2, 7, 0.2],
    // Корнеплоды
    [N.food_turnip, 28, 0.9, 6, 0.1], [N.food_parsnip, 75, 1.2, 18, 0.3], [N.food_celeriac, 42, 1.5, 9, 0.3],
    [N.food_beetroot_cooked, 43, 1.6, 10, 0.2], [N.food_sweet_potato_baked, 90, 2, 21, 0.2, '🍠'],
    [N.food_horseradish, 48, 1.2, 11, 0.7], [N.food_ginger, 80, 1.8, 18, 0.8],
    // Салатные листья — разные продукты: айсберг втрое «легче» кейла.
    [N.food_iceberg_lettuce, 14, 0.9, 3, 0.1, '🥬'], [N.food_lamb_s_lettuce, 21, 2, 3.6, 0.4, '🥬'],
    [N.food_romaine_lettuce, 17, 1.2, 3.3, 0.3, '🥬'], [N.food_chard, 19, 1.8, 3.7, 0.2, '🥬'],
    // Плодовые
    [N.food_cherry_tomatoes, 18, 0.9, 3.9, 0.2, '🍅'], [N.food_zucchini, 17, 1.2, 3.1, 0.3, '🥒'],
    [N.food_butternut_squash, 45, 1, 12, 0.1, '🎃'],
    // Грибы
    [N.food_oyster_mushrooms, 33, 3.3, 6, 0.4, '🍄'], [N.food_chanterelles, 32, 1.5, 7, 0.5, '🍄'],
    [N.food_porcini, 34, 3.7, 3.3, 1.7, '🍄'], [N.food_shiitake, 34, 2.2, 7, 0.5, '🍄'],
    // Консервы и заморозка — то, что реально лежит в шкафу и морозилке.
    [N.food_canned_sweetcorn, 81, 2.7, 17, 0.8, '🌽'], [N.food_canned_tomatoes, 22, 1, 4.2, 0.2, '🍅'],
    [N.food_frozen_peas, 72, 5, 13, 0.4], [N.food_frozen_mixed_vegetables, 60, 2.6, 11, 0.5],
    [N.food_runner_beans, 31, 1.8, 7, 0.2], [N.food_green_olives, 115, 0.8, 6, 11, '🫒'],
    [N.food_black_olives, 115, 0.8, 6, 11, '🫒'], [N.food_capers, 23, 2.4, 5, 0.9],
  ],
  fruit: [
    [N.food_banana, 89, 1.1, 23, 0.3, '🍌'], [N.food_apple, 52, 0.3, 14, 0.2, '🍏'], [N.food_pear, 57, 0.4, 15, 0.1, '🍐'],
    [N.food_orange, 47, 0.9, 12, 0.1, '🍊'], [N.food_tangerine, 53, 0.8, 13, 0.3, '🍊'], [N.food_grapefruit, 42, 0.8, 11, 0.1],
    [N.food_grapes, 69, 0.7, 18, 0.2, '🍇'], [N.food_kiwi, 61, 1.1, 15, 0.5, '🥝'], [N.food_pineapple, 50, 0.5, 13, 0.1, '🍍'],
    [N.food_mango, 60, 0.8, 15, 0.4, '🥭'], [N.food_peach, 39, 0.9, 10, 0.3, '🍑'], [N.food_plum, 46, 0.7, 11, 0.3],
    [N.food_apricot, 48, 1.4, 11, 0.4], [N.food_watermelon, 30, 0.6, 8, 0.2, '🍉'], [N.food_melon, 34, 0.8, 8, 0.2, '🍈'],
    [N.food_pomegranate, 83, 1.7, 19, 1.2], [N.food_persimmon, 70, 0.6, 18, 0.4], [N.food_lemon, 29, 1.1, 9, 0.3, '🍋'],
    [N.food_dates, 277, 1.8, 75, 0.2], [N.food_raisins, 299, 3.1, 79, 0.5], [N.food_prunes, 240, 2.2, 64, 0.4], [N.food_dried_apricots, 241, 3.4, 63, 0.5],
    [N.food_nectarine, 44, 1.1, 11, 0.3, '🍑'], [N.food_clementine, 47, 0.9, 12, 0.2, '🍊'], [N.food_lime, 30, 0.7, 11, 0.2, '🍋'],
    [N.food_pomelo, 38, 0.8, 10, 0.04], [N.food_fig, 74, 0.8, 19, 0.3], [N.food_papaya, 43, 0.5, 11, 0.3],
    [N.food_passion_fruit, 97, 2.2, 23, 0.7], [N.food_lychee, 66, 0.8, 17, 0.4], [N.food_coconut, 354, 3.3, 15, 33, '🥥'],
    // Сушёные — отдельные продукты: воды нет, сахар и калории вчетверо выше.
    [N.food_dried_figs, 249, 3.3, 64, 0.9], [N.food_dried_apple, 243, 1, 59, 0.3],
    [N.food_dried_banana, 346, 3.9, 88, 1.8], [N.food_dried_pineapple, 347, 1.5, 86, 0.4],
    [N.food_dried_mango, 319, 2.5, 78, 1.2],
  ],
  berry: [
    [N.food_strawberries, 33, 0.7, 8, 0.3, '🍓'], [N.food_bilberries, 57, 0.7, 14, 0.3], [N.food_raspberries, 52, 1.2, 12, 0.7],
    [N.food_blackberries, 43, 1.4, 10, 0.5], [N.food_sour_cherries, 50, 1, 12, 0.3, '🍒'], [N.food_currants, 44, 1.4, 10, 0.4],
    [N.food_sweet_cherries, 63, 1.1, 16, 0.2, '🍒'], [N.food_blueberries, 57, 0.7, 14, 0.3], [N.food_lingonberries, 46, 0.7, 12, 0.5],
    [N.food_cranberries, 46, 0.4, 12, 0.1], [N.food_gooseberries, 44, 0.9, 10, 0.6], [N.food_sea_buckthorn, 82, 1.2, 5.7, 5.4],
    [N.food_dried_cranberries, 308, 0.1, 82, 1.4], [N.food_dried_goji_berries, 349, 14, 77, 0.4],
    [N.food_frozen_mixed_berries, 50, 1, 11, 0.4],
  ],
  nut: [
    [N.food_almonds, 579, 21, 22, 50], [N.food_walnuts, 654, 15, 14, 65], [N.food_hazelnuts, 628, 15, 17, 61],
    [N.food_cashews, 553, 18, 30, 44], [N.food_peanuts, 567, 26, 16, 49, '🥜'], [N.food_pistachios, 560, 20, 28, 45],
    [N.food_pine_nuts, 673, 14, 13, 68], [N.food_sunflower_seeds, 584, 21, 20, 51], [N.food_pumpkin_seeds, 559, 30, 11, 49],
    [N.food_chia_seeds, 486, 17, 42, 31], [N.food_flaxseeds, 534, 18, 29, 42], [N.food_sesame_seeds, 573, 18, 23, 50],
    [N.food_peanut_butter, 588, 25, 20, 50, '🥜'],
    [N.food_pecans, 691, 9, 14, 72], [N.food_macadamia_nuts, 718, 8, 14, 76], [N.food_brazil_nuts, 659, 14, 12, 67],
    [N.food_desiccated_coconut, 660, 7, 23, 65, '🥥'], [N.food_mixed_nuts, 607, 20, 20, 54],
    [N.food_salted_peanuts, 585, 24, 21, 49, '🥜'],
    // Пасты — не «орехи в другой форме»: сахар и масло в составе меняют профиль.
    [N.food_almond_butter, 614, 21, 19, 56], [N.food_tahini, 595, 17, 21, 54],
    [N.food_chocolate_hazelnut_spread, 539, 6, 58, 31, '🍫'],
  ],
  bread: [
    [N.food_white_bread, 265, 9, 49, 3.2], [N.food_rye_bread, 259, 8.5, 48, 3.3], [N.food_wholegrain_bread, 247, 13, 41, 4],
    [N.food_white_loaf, 264, 7.5, 51, 2.9], [N.food_thin_lavash, 275, 9, 56, 1], [N.food_crispbread, 310, 11, 57, 3],
    [N.food_rusks, 331, 11, 72, 1.4], [N.food_croissant, 406, 8, 45, 21, '🥐'],
    [N.food_toast_bread, 270, 8, 50, 3.5], [N.food_sourdough_bread, 250, 8.5, 49, 1.8],
    [N.food_multigrain_bread, 265, 10, 43, 5], [N.food_borodinsky_rye_bread, 208, 6.8, 40, 1.3],
    [N.food_gluten_free_bread, 250, 4, 47, 5], [N.food_bread_roll, 280, 9, 52, 4],
    [N.food_wheat_tortilla, 310, 8, 51, 8, '🫓'], [N.food_corn_tortilla, 218, 5.7, 45, 2.9, '🫓'],
    [N.food_naan, 310, 9, 50, 8, '🫓'], [N.food_pretzel, 338, 10, 70, 3, '🥨'],
    [N.food_brioche, 390, 9, 48, 18, '🥐'], [N.food_croutons, 400, 10, 60, 14],
  ],
  pastry: [
    [N.food_vanilla_bun, 290, 7, 52, 6, '🥐'],
    [N.food_poppy_seed_bun, 320, 7.5, 55, 8, '🥐'],
    [N.food_sugar_bun, 305, 7, 53, 7, '🥐'],
    [N.food_braided_bun, 290, 7, 52, 6, '🥐'],
    [N.food_quark_tart_vatrushka, 270, 8, 42, 8, '🥐'],
    [N.food_cinnamon_roll, 385, 6, 56, 15, '🥐'],
    [N.food_sugar_doughnut, 370, 6, 53, 14, '🍩'],
    [N.food_glazed_doughnut, 400, 5, 52, 19, '🍩'],
    [N.food_jam_doughnut, 350, 5, 52, 13, '🍩'],
    [N.food_eclair, 330, 7, 48, 12, '🥐'],
    [N.food_profiterole, 326, 7, 45, 13, '🥐'],
    [N.food_apple_hand_pie, 230, 5, 39, 7, '🥟'],
    [N.food_cabbage_hand_pie, 220, 5, 36, 6, '🥟'],
    [N.food_baked_meat_hand_pie, 260, 9, 36, 8, '🥟'],
    [N.food_fried_meat_hand_pie, 310, 9, 35, 14, '🥟'],
    [N.food_jam_hand_pie, 235, 5, 42, 6, '🥟'],
    [N.food_samsa, 285, 10, 35, 10, '🥟'],
    [N.food_belyash_fried_meat_bun, 290, 10, 30, 14, '🥟'],
    [N.food_chebureki_fried_meat_pastry, 255, 7, 27, 13, '🥟'],
    [N.food_bagel, 285, 9, 56, 2, '🥐'],
    [N.food_pita, 275, 9, 55, 1, '🫓'],
    [N.food_baguette, 262, 9, 52, 1.4, '🥖'],
    [N.food_ciabatta, 262, 8, 51, 2, '🍞'],
    [N.food_focaccia, 265, 8, 44, 7, '🍞'],
    [N.food_apple_strudel, 185, 3, 29, 6, '🥐'],
  ],
  oil: [
    [N.food_olive_oil, 884, 0, 0, 100], [N.food_sunflower_oil, 899, 0, 0, 100],
    [N.food_coconut_oil, 892, 0, 0, 99], [N.food_mayonnaise, 680, 1, 2.6, 72],
    [N.food_rapeseed_oil, 884, 0, 0, 100], [N.food_avocado_oil, 884, 0, 0, 100],
    [N.food_sesame_oil, 884, 0, 0, 100], [N.food_flaxseed_oil, 884, 0, 0, 100],
    [N.food_ghee, 900, 0, 0, 100, '🧈'], [N.food_margarine, 717, 0.2, 0.7, 80, '🧈'],
  ],
  snack: [
    [N.food_crisps, 536, 6.6, 53, 34], [N.food_paprika_crisps, 530, 6, 52, 33],
    [N.food_sour_cream_and_onion_crisps, 525, 6.5, 53, 32], [N.food_cheese_crisps, 535, 7, 52, 33],
    [N.food_barbecue_crisps, 530, 6.5, 53, 32], [N.food_chilli_crisps, 528, 6.4, 53, 32],
    [N.food_stackable_crisps_tube, 540, 4, 52, 35], [N.food_vegetable_crisps, 480, 5, 55, 27],
    [N.food_tortilla_chips, 497, 7, 62, 25], [N.food_corn_puffs, 518, 5, 62, 27],
    [N.food_cheese_balls, 540, 8, 50, 34],
    [N.food_salted_popcorn, 500, 8, 57, 28], [N.food_caramel_popcorn, 430, 3, 78, 13],
    [N.food_air_popped_popcorn, 387, 13, 78, 4],
    [N.food_salted_pretzel_sticks, 350, 10, 70, 3], [N.food_salted_crackers, 430, 9, 68, 14],
    [N.food_cheese_crackers, 480, 7, 62, 22], [N.food_rice_cakes, 387, 8, 81, 3],
    [N.food_rye_croutons_snack, 400, 11, 65, 11], [N.food_meat_snacks_jerky, 410, 33, 11, 26],
  ],
  sweet: [
    [N.food_white_chocolate, 539, 6, 59, 31], [N.food_dark_chocolate_85, 592, 10, 22, 52],
    [N.food_chocolate_with_nuts, 560, 8, 52, 35], [N.food_chocolate_bar, 480, 5, 62, 23],
    [N.food_shortbread, 470, 6, 63, 22, '🍪'], [N.food_chocolate_cookies, 490, 6, 62, 24, '🍪'],
    [N.food_sandwich_cookies, 480, 5, 70, 20, '🍪'],
    [N.food_fruit_jelly_sweets, 321, 0.4, 79, 0.1, '🍬'], [N.food_gummy_sweets, 340, 6.9, 77, 0.2, '🍬'],
    [N.food_marshmallows, 318, 1.8, 78, 0.2, '🍬'], [N.food_caramel_sweets, 385, 0, 97, 0.1, '🍬'],
    [N.food_toffee, 400, 3, 75, 10, '🍬'], [N.food_nougat, 420, 4, 65, 16, '🍬'],
    // Мороженое: сорта различаются вдвое по калориям — лёд и пломбир не одно.
    [N.food_vanilla_ice_cream, 207, 3.5, 24, 11, '🍨'], [N.food_chocolate_ice_cream, 216, 3.8, 28, 11, '🍨'],
    [N.food_ice_lolly, 110, 0, 27, 0, '🍨'], [N.food_gelato, 160, 4, 26, 4.5, '🍨'],
    [N.food_frozen_yogurt, 130, 4, 22, 3, '🍨'],
    [N.food_chocolate_pudding, 130, 3, 20, 4], [N.food_rice_pudding, 130, 3.5, 20, 4],
    [N.food_protein_pudding, 75, 10, 4, 2, '💪'],
    [N.food_sugar, 387, 0, 100, 0, '🍬'], [N.food_honey, 304, 0.3, 82, 0, '🍯'], [N.food_milk_chocolate, 535, 7.6, 59, 30],
    [N.food_plain_chocolate, 546, 7.9, 46, 31], [N.food_plombir_ice_cream, 227, 3.7, 21, 15, '🍨'],
    [N.food_oat_cookies, 437, 6, 71, 15, '🍪'], [N.food_zefir_fruit_marshmallow, 326, 0.8, 80, 0], [N.food_halva, 523, 12, 54, 29],
    [N.food_jam, 265, 0.3, 65, 0], [N.food_gingerbread, 350, 5, 75, 7],
  ],
  drink: [
    [N.food_black_coffee, 2, 0.1, 0, 0, '☕'], [N.food_coffee_with_milk, 30, 1.5, 3, 1.2, '☕'], [N.food_cappuccino, 40, 2, 4, 1.8, '☕'],
    [N.food_latte, 44, 2.4, 4.4, 1.8, '☕'], [N.food_raf_coffee, 90, 2, 8, 5.5, '☕'], [N.food_cocoa, 60, 2, 9, 1.8, '☕'],
    [N.food_espresso, 2, 0.1, 0, 0, '☕'], [N.food_americano, 2, 0.1, 0, 0, '☕'], [N.food_flat_white, 60, 3.3, 5, 2.8, '☕'],
    [N.food_matcha_latte, 70, 2.5, 9, 2.5, '🍵'],
    [N.food_hot_chocolate, 90, 2.5, 14, 3, '☕'], [N.food_tea_unsweetened, 1, 0, 0.3, 0, '🍵'], [N.food_tea_with_sugar, 28, 0, 7, 0, '🍵'],
    [N.food_tea_with_milk, 25, 1, 3, 1, '🍵'],
    [N.food_coca_cola, 42, 0, 10.6, 0, '🥤'], [N.food_coca_cola_zero, 0.3, 0, 0, 0, '🥤'], [N.food_coca_cola_light, 0.2, 0, 0, 0, '🥤'],
    [N.food_pepsi, 43, 0, 11, 0, '🥤'], [N.food_pepsi_max, 0.3, 0, 0, 0, '🥤'], [N.food_pepsi_light, 2, 0, 0.4, 0, '🥤'],
    [N.food_fanta, 48, 0, 12, 0, '🥤'], [N.food_fanta_zero, 3, 0, 0.5, 0, '🥤'],
    [N.food_sprite, 39, 0, 9.6, 0, '🥤'], [N.food_sprite_zero, 1, 0, 0, 0, '🥤'],
    [N.food_7up, 44, 0, 11, 0, '🥤'], [N.food_mirinda, 47, 0, 12, 0, '🥤'], [N.food_mountain_dew, 47, 0, 12, 0, '🥤'],
    [N.food_dr_pepper, 40, 0, 10, 0, '🥤'], [N.food_schweppes, 38, 0, 9, 0, '🥤'], [N.food_tonic_water, 34, 0, 8.5, 0, '🥤'],
    [N.food_red_bull, 45, 0, 11, 0, '⚡'], [N.food_red_bull_sugarfree, 3, 0, 0.2, 0, '⚡'], [N.food_monster_energy, 47, 0, 12, 0, '⚡'],
    [N.food_monster_zero, 1, 0, 0, 0, '⚡'], [N.food_burn, 49, 0, 12, 0, '⚡'], [N.food_adrenaline_rush, 52, 0, 13, 0, '⚡'], [N.food_gorilla, 48, 0, 12, 0, '⚡'],
    [N.food_lipton_ice_tea, 30, 0, 7.4, 0, '🧋'], [N.food_fuze_tea, 28, 0, 7, 0, '🧋'], [N.food_nestea, 29, 0, 7, 0, '🧋'],
    [N.food_kvass, 27, 0.2, 5, 0, '🍺'], [N.food_tarkhun_tarragon_soda, 38, 0, 9.5, 0, '🥤'], [N.food_baikal_herbal_cola, 35, 0, 8.7, 0, '🥤'], [N.food_duchess_pear_soda, 40, 0, 10, 0, '🥤'],
    [N.food_lemonade, 40, 0, 10, 0, '🥤'],
    [N.food_orange_juice, 45, 0.7, 10, 0.2, '🧃'], [N.food_apple_juice, 46, 0.1, 11, 0.1, '🧃'], [N.food_multifruit_juice, 47, 0.3, 11, 0.1, '🧃'],
    [N.food_tomato_juice, 21, 1, 3.5, 0.1, '🧃'], [N.food_grape_juice, 54, 0.3, 14, 0.1, '🧃'], [N.food_mors_berry_drink, 41, 0.1, 10, 0, '🧃'],
    [N.food_kompot_fruit_drink, 60, 0.1, 15, 0, '🧃'], [N.food_water, 0, 0, 0, 0, '💧'], [N.food_sparkling_water, 0, 0, 0, 0, '💧'], [N.food_mineral_water, 0, 0, 0, 0, '💧'],
    [N.food_grapefruit_juice, 39, 0.5, 9, 0.1, '🧃'], [N.food_cherry_juice, 48, 0.4, 11, 0.1, '🧃'],
    // Родовые записи рядом с брендовыми: человек ищет и «энергетик», и Monster.
    [N.food_iced_tea, 28, 0, 7, 0, '🧋'], [N.food_energy_drink, 45, 0, 11, 0, '⚡'], [N.food_sugar_free_energy_drink, 3, 0, 0.5, 0, '⚡'],
    [N.food_milkshake, 112, 3.4, 18, 3, '🥤'], [N.food_fruit_smoothie, 60, 1, 13, 0.5, '🥤'], [N.food_berry_smoothie, 55, 1, 12, 0.4, '🥤'],
    // «Ряженка» живёт в молочном разделе, где у неё есть выбор жирности
    // (2.5 / 4 / 6 %). Дубль здесь давал в поиске две одинаковые строки с
    // разной калорийностью — 54 и 64 ккал, — и выбрать было не из чего.
    [N.food_drinkable_yogurt, 70, 2.8, 12, 1.5, '🥤'], [N.food_drinking_kefir, 40, 3, 4, 1, '🥛'],
    [N.food_beer, 43, 0.5, 3.6, 0, '🍺'], [N.food_dark_beer, 50, 0.6, 5, 0, '🍺'], [N.food_alcohol_free_beer, 33, 0.4, 6, 0, '🍺'],
    [N.food_dry_red_wine, 68, 0.1, 2.6, 0, '🍷'], [N.food_dry_white_wine, 66, 0.1, 2.6, 0, '🍷'], [N.food_semi_sweet_wine, 88, 0.2, 5, 0, '🍷'],
    [N.food_sparkling_wine, 76, 0.2, 1.4, 0, '🥂'], [N.food_vodka, 231, 0, 0.1, 0, '🥃'], [N.food_whisky, 250, 0, 0.1, 0, '🥃'], [N.food_brandy, 240, 0, 1.5, 0, '🥃'],
    [N.food_gin_and_tonic, 78, 0, 7, 0, '🥃'], [N.food_mojito, 120, 0, 12, 0, '🍸'], [N.food_pina_colada, 175, 0.5, 22, 3, '🍹'], [N.food_aperol_spritz, 110, 0, 12, 0, '🍹'],
  ],
  dish: [
    // Полуфабрикаты из морозилки: их считают целой пачкой, и в базе они
    // отсутствовали — человек искал «замороженная пицца» и не находил ничего.
    [N.food_frozen_pizza, 250, 10, 30, 10, '🍕'], [N.food_fish_fingers, 230, 13, 20, 11, '🐟'],
    [N.food_frozen_chips, 170, 2.6, 25, 6.5, '🍟'], [N.food_potato_croquettes, 240, 3.5, 30, 12, '🥔'],
    [N.food_rosti, 180, 2.5, 22, 9, '🥔'], [N.food_frozen_ready_meal, 130, 7, 14, 5],
    [N.food_instant_soup, 35, 1.2, 5, 1.2, '🍲'],
    [N.food_pelmeni_boiled, 275, 11, 29, 12, '🥟'], [N.food_vareniki_with_potato, 180, 4.5, 32, 4, '🥟'],
    [N.food_vareniki_with_quark, 200, 8, 30, 5, '🥟'], [N.food_vareniki_with_cherries, 165, 4, 33, 2, '🥟'],
    [N.food_manti_steamed_dumplings, 200, 9, 20, 9, '🥟'], [N.food_khinkali, 235, 10, 24, 11, '🥟'],
    [N.food_borscht, 49, 1.5, 4, 2.7, '🍲'], [N.food_chicken_noodle_soup, 48, 3.5, 5, 1.5, '🍲'], [N.food_ukha_fish_soup, 46, 4, 2, 2.5, '🍲'],
    [N.food_shchi_cabbage_soup, 35, 1.5, 3, 2, '🍲'], [N.food_solyanka, 95, 6, 4, 6, '🍲'], [N.food_rassolnik_pickle_soup, 55, 2, 6, 2.5, '🍲'],
    [N.food_pea_soup, 66, 3.5, 9, 1.5, '🍲'], [N.food_mushroom_soup, 40, 1.5, 4, 2, '🍲'], [N.food_okroshka_cold_soup, 60, 2.5, 6, 3, '🍲'],
    [N.food_kharcho_beef_rice_soup, 88, 4, 6, 5, '🍲'], [N.food_potato_pancakes, 180, 3.5, 22, 9, '🥔'], [N.food_syrniki_quark_pancakes, 220, 17, 18, 9, '🥞'],
    [N.food_quark_bake, 168, 17, 18, 4.5], [N.food_crepes_bliny, 186, 6, 26, 6.5, '🥞'], [N.food_crepes_with_meat, 230, 9, 22, 12, '🥞'],
    [N.food_crepes_with_quark, 215, 9, 25, 9, '🥞'], [N.food_pancakes, 227, 6, 28, 9, '🥞'], [N.food_oladyi_small_pancakes, 210, 6, 33, 6.5, '🥞'],
    [N.food_cabbage_rolls, 120, 6, 9, 7], [N.food_plov_pilaf, 190, 5, 25, 8], [N.food_chicken_patty, 220, 16, 8, 14],
    [N.food_meatballs, 170, 10, 9, 10], [N.food_chicken_kiev, 330, 16, 12, 25], [N.food_meatballs_with_rice, 155, 9, 12, 8],
    [N.food_khachapuri, 280, 12, 28, 13],
    [N.food_potato_hand_pie, 258, 5, 40, 9], [N.food_vinegret_beetroot_salad, 130, 1.5, 9, 9, '🥗'], [N.food_buckwheat_with_chicken, 145, 11, 15, 4],
    [N.food_chicken_plov, 170, 8, 24, 6], [N.food_pork_plov, 210, 7, 24, 10], [N.food_lamb_plov, 220, 8, 24, 11],
    [N.food_pork_patty, 260, 14, 9, 19], [N.food_beef_patty, 240, 15, 9, 16], [N.food_turkey_patty, 180, 16, 8, 9, '🍗'],
    [N.food_fish_cake, 170, 13, 8, 10, '🐟'], [N.food_chicken_meatballs, 150, 12, 8, 8, '🍗'], [N.food_beef_meatballs, 180, 11, 9, 11],
    [N.food_chicken_pelmeni, 240, 12, 28, 9, '🥟'], [N.food_chicken_manti, 180, 10, 20, 7, '🥟'], [N.food_lamb_manti, 220, 9, 20, 11, '🥟'],
    [N.food_chicken_cabbage_rolls, 100, 7, 9, 4], [N.food_meat_hand_pie, 280, 10, 32, 13],
    [N.food_crepes_with_chicken, 200, 11, 22, 8, '🥞'],
    [N.food_pepperoni_pizza, 266, 11, 33, 10, '🍕'], [N.food_burger, 295, 17, 24, 14, '🍔'], [N.food_chips_fries, 312, 3.4, 41, 15, '🍟'],
    [N.food_nuggets, 296, 15, 16, 19], [N.food_sushi_roll, 150, 5, 28, 2, '🍣'], [N.food_caesar_salad, 190, 9, 6, 14, '🥗'],
    [N.food_olivier_salad, 198, 5, 8, 16, '🥗'],
  ],
  pasta: [
    [N.food_pasta_carbonara, 190, 8, 20, 9], [N.food_pasta_bolognese, 150, 7, 18, 5], [N.food_pasta_alfredo, 200, 6, 19, 11],
    [N.food_pasta_with_pesto, 210, 6, 22, 11], [N.food_pasta_with_tomato_sauce, 130, 4, 22, 3], [N.food_seafood_pasta, 145, 7, 19, 4],
    [N.food_pasta_arrabbiata, 140, 4, 23, 4], [N.food_lasagne, 135, 8, 12, 6], [N.food_risotto, 160, 4, 24, 5],
    [N.food_macaroni_cheese, 190, 8, 20, 9], [N.food_gnocchi, 180, 4, 30, 4], [N.food_spaghetti_and_meatballs, 165, 8, 18, 6],
    [N.food_chicken_bolognese_pasta, 140, 8, 18, 4], [N.food_chicken_pasta, 170, 10, 19, 6], [N.food_chicken_lasagne, 130, 9, 12, 5],
  ],
  pizza: [
    [N.food_margherita_pizza, 240, 10, 30, 9], [N.food_four_cheese_pizza, 280, 13, 28, 13], [N.food_hawaiian_pizza, 230, 10, 29, 8],
    [N.food_meat_feast_pizza, 265, 13, 28, 11], [N.food_vegetarian_pizza, 200, 8, 29, 6], [N.food_barbecue_pizza, 250, 12, 30, 9],
    [N.food_mushroom_pizza, 215, 9, 29, 7], [N.food_diavola_pizza, 255, 12, 29, 10], [N.food_chicken_pizza, 245, 13, 29, 9],
    [N.food_calzone, 270, 12, 30, 11],
  ],
  asian: [
    [N.food_philadelphia_roll, 180, 6, 22, 7, '🍣'], [N.food_california_roll, 170, 5, 25, 5, '🍣'], [N.food_baked_sushi_rolls, 200, 7, 20, 10, '🍣'],
    [N.food_ramen, 90, 5, 11, 3], [N.food_tom_yum, 55, 4, 4, 3], [N.food_tom_kha, 90, 4, 6, 6], [N.food_pad_thai, 150, 6, 20, 5],
    [N.food_chicken_stir_fry, 130, 8, 14, 5], [N.food_udon, 130, 5, 23, 2], [N.food_wok_noodles, 140, 5, 22, 4], [N.food_teriyaki_chicken, 165, 12, 18, 4],
    [N.food_chicken_curry, 130, 8, 9, 7], [N.food_kung_pao_chicken, 160, 10, 12, 8], [N.food_gyoza, 180, 7, 20, 8, '🥟'],
    [N.food_spring_rolls, 150, 4, 20, 6], [N.food_pho_bo, 65, 5, 8, 1.5], [N.food_vegetable_fried_rice, 150, 4, 25, 4, '🍚'],
    [N.food_bao_bun, 180, 6, 26, 5],
  ],
  mexican: [
    [N.food_taco, 210, 9, 20, 10], [N.food_burrito, 210, 9, 25, 8, '🌯'], [N.food_quesadilla, 260, 11, 24, 13],
    [N.food_nachos_with_cheese, 320, 8, 33, 17], [N.food_fajitas, 180, 11, 15, 8], [N.food_guacamole, 160, 2, 9, 15, '🥑'],
    [N.food_chilli_con_carne, 130, 9, 10, 6], [N.food_enchilada, 180, 9, 18, 8],
  ],
  fastfood: [
    [N.food_cheeseburger, 300, 15, 25, 16, '🍔'], [N.food_double_cheeseburger, 330, 18, 24, 19, '🍔'], [N.food_hot_dog, 250, 10, 20, 15, '🌭'],
    [N.food_shawarma, 215, 12, 18, 11, '🌯'], [N.food_doner_kebab, 215, 12, 18, 11, '🌯'], [N.food_chicken_wrap_twister, 250, 12, 24, 12, '🌯'],
    [N.food_club_sandwich, 230, 12, 20, 11, '🥪'], [N.food_chicken_sandwich, 200, 12, 22, 7, '🥪'], [N.food_panini, 250, 12, 26, 11, '🥪'],
    [N.food_buffalo_wings, 290, 24, 6, 19], [N.food_onion_rings, 410, 5, 38, 26], [N.food_fish_burger, 255, 12, 26, 12, '🍔'],
    [N.food_falafel, 330, 13, 32, 18], [N.food_hummus, 170, 8, 14, 10],
  ],
  // ── McDonald's ────────────────────────────────────────────────────────────────
  // Все значения на 100 г. Точные порции (гр) — в PORTIONS_BY_NAME ниже.
  // Данные из официального ресурса McDonald's (усреднённые по рецептуре СНГ).
  mcdonalds: [
    // Бургеры
    [N.food_big_mac, 252, 13, 22, 12.5, '🍔'],
    [N.food_hamburger, 228, 10.9, 28.2, 8.2, '🍔'],
    [N.food_mcdonald_s_cheeseburger, 232, 11.5, 24.6, 10, '🍔'],
    [N.food_mcdonald_s_double_cheeseburger, 228, 13.3, 15.9, 12.3, '🍔'],
    [N.food_mcchicken, 210, 9.2, 20, 9.7, '🍔'],
    [N.food_big_tasty, 253, 12.5, 20, 13.3, '🍔'],
    [N.food_big_tasty_with_bacon, 267, 12.7, 18.8, 15, '🍔'],
    [N.food_mcdonald_s_chicken_wrap, 220, 9.3, 23.6, 8.9, '🌯'],
    [N.food_filet_o_fish, 224, 9.7, 25.5, 9, '🍔'],
    // Картофель и гарниры
    [N.food_fries_s, 229, 3, 29, 11, '🍟'],
    [N.food_fries_m, 225, 2.7, 28.7, 10.7, '🍟'],
    [N.food_fries_l, 226, 3, 28.9, 10.7, '🍟'],
    [N.food_potato_wedges_m, 240, 3.2, 31.2, 11, '🍟'],
    // Наггетсы
    [N.food_nuggets_4_pcs, 270, 13.4, 14.9, 16.4, '🍗'],
    [N.food_nuggets_6_pcs, 270, 14, 16, 16, '🍗'],
    [N.food_nuggets_9_pcs, 270, 14, 16, 16, '🍗'],
    // Десерты и выпечка
    [N.food_mcflurry_oreo, 150, 3.1, 23.1, 5, '🍦'],
    [N.food_mcdonald_s_ice_cream_cone, 194, 4, 29.6, 6.4, '🍦'],
    [N.food_mcdonald_s_apple_pie, 355, 3.9, 44.2, 18.2, '🥐'],
    [N.food_egg_mcmuffin, 226, 12.4, 22.6, 9.5, '🍳'],
    [N.food_big_breakfast, 211, 9.1, 16.2, 11.7, '🍳'],
    // Напитки (ккал/100 мл ≈ ккал/100 г)
    [N.food_mcdonald_s_cola_s, 42, 0, 11, 0, '🥤'],
    [N.food_mcdonald_s_cola_m, 39, 0, 10, 0, '🥤'],
    [N.food_mcdonald_s_milkshake, 105, 2.4, 17.6, 2.9, '🥤'],
    [N.food_mccafe_latte, 58, 2.7, 5, 3, '☕'],
  ],
  salad: [
    [N.food_greek_salad, 110, 3, 6, 8], [N.food_caprese_salad, 190, 9, 4, 15], [N.food_tuna_salad, 130, 10, 6, 7],
    [N.food_tabbouleh, 130, 3, 18, 5], [N.food_crab_stick_salad, 190, 6, 10, 14], [N.food_mimosa_salad, 250, 8, 6, 22],
    [N.food_caesar_salad_with_prawns, 160, 10, 6, 10], [N.food_shopska_salad, 90, 3, 6, 6], [N.food_chicken_salad, 140, 11, 5, 8],
    [N.food_warm_beef_salad, 160, 12, 7, 9],
  ],
  soups: [
    [N.food_cream_of_mushroom_soup, 90, 2, 8, 6], [N.food_pumpkin_soup, 60, 1.5, 9, 2], [N.food_gazpacho, 40, 1.5, 6, 1.5],
    [N.food_minestrone, 50, 2, 8, 1.5], [N.food_french_onion_soup, 50, 2, 6, 2], [N.food_cheese_soup, 85, 3, 6, 5], [N.food_chicken_broth, 15, 2, 0.5, 0.5],
  ],
  hot: [
    [N.food_beef_steak, 270, 25, 0, 19, '🥩'], [N.food_ribeye_steak, 291, 24, 0, 22, '🥩'], [N.food_pork_skewers, 250, 18, 1, 20],
    [N.food_chicken_skewers, 170, 20, 1, 9], [N.food_lula_kebab, 240, 16, 3, 18], [N.food_goulash, 150, 12, 6, 8],
    [N.food_beef_stroganoff, 190, 16, 5, 12], [N.food_pork_chop, 280, 20, 8, 19], [N.food_rotisserie_chicken, 190, 25, 0, 10, '🍗'],
    [N.food_bbq_ribs, 290, 20, 8, 20], [N.food_peking_duck, 240, 19, 5, 16], [N.food_schnitzel, 280, 17, 15, 17],
    [N.food_meat_baked_with_cheese, 230, 15, 6, 16], [N.food_salmon_steak, 210, 22, 0, 13, '🐟'], [N.food_pork_ribs, 280, 18, 5, 20],
    [N.food_chicken_escalope, 180, 22, 8, 8, '🍗'], [N.food_turkey_escalope, 170, 23, 7, 6, '🍗'], [N.food_beef_escalope, 230, 24, 6, 13],
    [N.food_breaded_chicken_schnitzel, 240, 18, 14, 12, '🍗'], [N.food_beef_skewers, 210, 19, 1, 14], [N.food_turkey_skewers, 150, 21, 1, 6, '🍗'],
    [N.food_lamb_skewers, 280, 17, 1, 23], [N.food_chicken_steak, 165, 31, 0, 4, '🍗'], [N.food_turkey_steak, 135, 29, 0, 1, '🍗'],
    [N.food_pork_steak, 260, 26, 0, 17], [N.food_chicken_lula_kebab, 180, 16, 3, 11, '🍗'], [N.food_pork_goulash, 180, 12, 6, 11],
    [N.food_turkey_goulash, 120, 14, 4, 5, '🍗'], [N.food_chicken_stroganoff, 150, 16, 5, 7, '🍗'], [N.food_chicken_baked_with_cheese, 200, 17, 5, 12, '🍗'],
  ],
  seafood2: [
    [N.food_grilled_prawns, 100, 24, 1, 1], [N.food_fried_squid, 175, 16, 8, 9], [N.food_fish_cakes, 170, 13, 8, 10, '🐟'],
    [N.food_fish_and_chips, 230, 12, 22, 11], [N.food_mussels_in_cream_sauce, 110, 10, 5, 6], [N.food_paella, 160, 9, 22, 4],
    [N.food_ceviche, 95, 15, 4, 2], [N.food_oysters, 68, 7, 4, 2, '🦪'],
  ],
  caucasus: [
    [N.food_lobio_bean_stew, 120, 6, 16, 3], [N.food_satsivi_walnut_sauce_chicken, 220, 14, 6, 16], [N.food_chakhokhbili_chicken_stew, 120, 10, 5, 7], [N.food_dolma, 180, 6, 12, 12],
    [N.food_ajapsandali_vegetable_stew, 90, 2, 8, 6], [N.food_qutab_stuffed_flatbread, 210, 7, 28, 8],
  ],
  breakfast: [
    [N.food_eggs_and_bacon, 220, 13, 1, 18, '🍳'], [N.food_eggs_benedict, 230, 12, 12, 15, '🍳'], [N.food_granola_with_yogurt, 180, 6, 25, 6],
    [N.food_smoothie_bowl, 120, 3, 22, 2, '🥣'], [N.food_avocado_toast, 190, 5, 18, 11, '🥑'], [N.food_oat_pancake_ovsyanoblin, 180, 13, 14, 8],
    [N.food_muesli_with_milk, 140, 4, 24, 3, '🥣'], [N.food_shakshuka, 110, 7, 6, 7], [N.food_french_toast, 230, 8, 28, 9],
    [N.food_scrambled_eggs_with_vegetables, 130, 9, 4, 9, '🍳'],
  ],
  dessert: [
    [N.food_cheesecake, 320, 6, 26, 22, '🍰'], [N.food_tiramisu, 280, 5, 28, 16], [N.food_waffles, 290, 7, 40, 12, '🧇'],
    [N.food_doughnut, 350, 5, 45, 17, '🍩'], [N.food_muffin, 380, 6, 50, 17, '🧁'], [N.food_cupcake, 370, 4, 52, 17, '🧁'],
    [N.food_napoleon_cake, 340, 5, 40, 18], [N.food_honey_cake_medovik, 380, 5, 45, 20], [N.food_brownie, 460, 6, 50, 26],
    [N.food_panna_cotta, 210, 4, 20, 13], [N.food_creme_brulee, 250, 4, 22, 16], [N.food_strudel, 280, 4, 40, 12], [N.food_pound_cake, 360, 6, 52, 14],
    [N.food_macaron, 380, 7, 55, 15],
  ],
  sauce: [
    [N.food_ketchup, 112, 1.3, 26, 0.3], [N.food_soy_sauce, 53, 8, 4.9, 0.6], [N.food_mustard, 143, 9, 9, 9],
    [N.food_tomato_paste, 82, 4.3, 19, 0.5],
    [N.food_dijon_mustard, 143, 8, 6, 10], [N.food_barbecue_sauce, 172, 0.8, 41, 0.6],
    [N.food_teriyaki_sauce, 89, 5, 15, 0], [N.food_hot_sauce, 29, 1, 6, 0.4, '🌶️'],
    [N.food_sriracha, 93, 1.9, 19, 0.9, '🌶️'], [N.food_salsa, 36, 1.5, 7, 0.2],
    [N.food_adjika_spicy_paste, 59, 1, 11, 1], [N.food_tkemali_plum_sauce, 90, 1, 21, 0.2],
    [N.food_tomato_sauce, 60, 2, 9, 2], [N.food_balsamic_vinegar, 88, 0.5, 17, 0],
    // Жирные заправки: ложка «ранча» — это 65 ккал, и это надо видеть отдельно.
    [N.food_pesto, 450, 5, 6, 45], [N.food_garlic_sauce, 380, 2, 8, 38], [N.food_ranch_dressing, 430, 1, 6, 45],
    [N.food_caesar_dressing, 480, 2, 4, 50], [N.food_tartare_sauce, 400, 1.5, 5, 42], [N.food_cheese_sauce, 180, 7, 6, 14],
    [N.food_yogurt_dressing, 90, 3, 6, 5],
  ],
  supp: [
    [N.food_protein_bar, 350, 30, 35, 9], [N.food_whey_protein_powder, 400, 80, 8, 6], [N.food_mass_gainer_powder, 380, 20, 60, 6],
  ],
}

const VARIANTS = [
  {
    name: N.food_potato, cat: 'veg', emoji: '🥔', alias: 'картошка',
    methods: [
      ['Варёный', 82, 2, 17, 0.1], ['В мундире', 87, 1.9, 20, 0.1], ['Тушёный', 90, 2, 15, 3],
      ['Запечённый', 93, 2.5, 21, 0.3], ['Пюре', 113, 2.1, 16, 4.2], ['В аэрогриле', 150, 3, 24, 4.5],
      ['Жареный', 192, 2.8, 23, 9.5], ['На сливочном масле', 215, 2.9, 23, 12], ['Фри', 312, 3.4, 41, 15], ['Драники', 180, 3.5, 22, 9],
    ],
  },
  {
    name: N.food_chicken_breast, cat: 'poultry', emoji: '🍗', alias: 'курица куриное филе грудка',
    methods: [
      ['На пару', 116, 24, 0, 2], ['Варёная', 137, 29, 0, 1.8], ['Гриль', 165, 31, 0, 3.6],
      ['Запечённая', 165, 31, 0, 3.6], ['В аэрогриле', 150, 30, 0, 3], ['Тушёная', 150, 27, 2, 4],
      ['Жареная', 197, 30, 1, 8], ['На сливочном масле', 220, 30, 1, 11], ['Копчёная', 117, 18, 0, 5],
    ],
  },
  {
    name: N.food_egg, cat: 'egg', emoji: '🥚', alias: 'яйца яичница глазунья',
    methods: [
      ['Варёное всмятку', 155, 13, 1.1, 11], ['Варёное вкрутую', 155, 13, 1.1, 11], ['Пашот', 143, 12.5, 0.7, 9.5],
      [N.food_scrambled_eggs, 148, 10, 1.6, 11], [N.food_omelette, 154, 11, 1.6, 12], ['Глазунья (жареное)', 196, 14, 0.8, 15], ['Глазунья на сл. масле', 155, 13, 1.1, 11],
    ],
  },
  {
    name: N.food_button_mushrooms, cat: 'veg', emoji: '🍄', alias: 'грибы',
    methods: [
      ['Сырые', 22, 3.1, 3.3, 0.3], ['Варёные', 25, 3.5, 3, 0.4], ['На гриле', 30, 3.8, 3.5, 0.6],
      ['Тушёные', 45, 3, 4, 2.5], ['Маринованные', 24, 2.5, 2, 0.5], ['Жареные', 80, 4, 4, 5.5], ['На сливочном масле', 100, 4, 4, 8],
    ],
  },
  {
    name: N.food_beef, cat: 'meat', emoji: '🥩', alias: 'мясо говяжье',
    methods: [
      ['Варёная', 187, 26, 0, 9], ['Запечённая', 210, 28, 0, 11], ['Тушёная', 232, 16, 4, 16],
      ['На гриле', 250, 27, 0, 15], ['Жареная', 260, 26, 1, 17], ['На сливочном масле', 285, 26, 1, 20],
    ],
  },
  {
    name: N.food_pork, cat: 'meat', emoji: '🥩', alias: 'мясо свиное',
    methods: [
      ['Варёная', 242, 27, 0, 14], ['Запечённая', 270, 25, 0, 19], ['Тушёная', 235, 15, 3, 18],
      ['На гриле', 260, 26, 0, 17], ['Жареная', 290, 20, 0, 23], ['На сливочном масле', 312, 20, 0, 25],
    ],
  },
  {
    name: N.food_white_fish_fillet, cat: 'fish', emoji: '🐟', alias: 'рыба филе треска',
    methods: [
      ['Сырая', 82, 18, 0, 0.7], ['На пару', 90, 19, 0, 1], ['Запечённая', 110, 20, 1, 3],
      ['На гриле', 120, 21, 0, 3.5], ['Копчёная', 130, 22, 0, 4], ['Жареная', 165, 18, 4, 8], ['На сливочном масле', 190, 18, 4, 11],
    ],
  },
  {
    name: N.food_oatmeal, cat: 'grain', emoji: '🥣', alias: 'овсяная каша геркулес',
    methods: [
      ['На воде', 88, 3, 15, 1.7], ['На молоке', 120, 4.5, 16, 4],
    ],
  },
  {
    name: N.food_rice, cat: 'grain', emoji: '🍚', alias: 'рис отварной',
    methods: [
      ['Белый варёный', 130, 2.7, 28, 0.3], ['Бурый варёный', 112, 2.6, 23, 0.9], ['Жареный', 168, 3, 25, 6], ['На сливочном масле', 195, 3, 25, 9],
      [N.food_plov_pilaf, 190, 5, 25, 8],
    ],
  },
  {
    name: N.food_buckwheat, cat: 'grain', emoji: '🌾', alias: 'гречневая каша',
    methods: [
      ['На воде', 110, 4, 21, 1.1], ['С молоком', 135, 5, 24, 3], ['С маслом', 145, 4, 21, 5.5],
    ],
  },
  {
    name: N.food_broccoli, cat: 'veg', emoji: '🥦', alias: 'капуста',
    methods: [
      ['Сырая', 34, 2.8, 7, 0.4], ['На пару', 35, 2.8, 7, 0.4], ['Варёная', 35, 2.4, 7, 0.4],
      ['Тушёная', 55, 2.5, 7, 2.5], ['Жареная', 90, 3, 8, 5.5], ['На сливочном масле', 115, 3, 8, 8],
    ],
  },
  {
    name: N.food_courgette, cat: 'veg', emoji: '🥒', alias: 'цукини',
    methods: [
      ['Сырой', 17, 1.2, 3.1, 0.3], ['На гриле', 30, 1.3, 4, 1], ['Тушёный', 40, 1.2, 4, 2.5],
      ['Запечённый', 45, 1.4, 5, 2], ['Жареный', 90, 1.3, 6, 7], ['На сливочном масле', 115, 1.3, 6, 9.5],
    ],
  },
]

export const MILKS = [
  { key: '3.2', get label() { return t('add.milk32') }, kcal: 60, protein: 3, carbs: 4.7, fat: 3.2 },
  { key: '2.5', label: '2.5%', kcal: 52, protein: 2.9, carbs: 4.8, fat: 2.5 },
  { key: '1.5', label: '1.5%', kcal: 44, protein: 3, carbs: 4.7, fat: 1.5 },
  { key: '0', get label() { return t('add.milkSkim') }, kcal: 34, protein: 3.3, carbs: 5, fat: 0.1 },
]

export const BUILDERS = [
  { name: N.food_open_sandwich, emoji: '🥪', cat: 'dish', unit: 'шт', builder: 'constructor', baseGroup: 'bread', preset: { base: 'Тостерный хлеб', slices: 1 }, alias: 'бутерброд собрать конструктор своё', source: 'local' },
  { name: N.food_sandwich, emoji: '🥪', cat: 'dish', unit: 'шт', builder: 'constructor', baseGroup: 'bread', preset: { base: 'Тостерный хлеб', slices: 2 }, alias: 'сэндвич сендвич собрать', source: 'local' },
  { name: N.food_toast, emoji: '🍞', cat: 'dish', unit: 'шт', builder: 'constructor', baseGroup: 'bread', preset: { base: 'Тостерный хлеб', slices: 1 }, alias: 'тост горячий бутерброд', source: 'local' },
  { name: N.food_burger_homemade, emoji: '🍔', cat: 'dish', unit: 'шт', builder: 'constructor', baseGroup: 'bread', preset: { base: 'Булочка для бургера', slices: 1 }, alias: 'бургер гамбургер чизбургер свой', source: 'local' },
  { name: N.food_hot_dog_homemade, emoji: '🌭', cat: 'dish', unit: 'шт', builder: 'constructor', baseGroup: 'bread', preset: { base: 'Булочка для хот-дога', slices: 1 }, alias: 'хот дог хотдог свой', source: 'local' },
  { name: N.food_salad, emoji: '🥗', cat: 'dish', unit: 'порция', builder: 'constructor', baseGroup: 'salad', preset: { base: 'Микс салатов', slices: 1 }, alias: 'салат собрать свой', source: 'local' },
  { name: N.food_bowl, emoji: '🥣', cat: 'dish', unit: 'порция', builder: 'constructor', baseGroup: 'bowl', preset: { base: 'Рис белый', slices: 1 }, alias: 'боул тарелка bowl миска будда', source: 'local' },
  { name: N.food_porridge, emoji: '🥣', cat: 'dish', unit: 'порция', builder: 'constructor', baseGroup: 'porridge', preset: { base: 'Овсянка на молоке', slices: 1 }, alias: 'каша овсянка порридж завтрак', source: 'local' },
  { name: N.food_pasta_homemade, emoji: '🍝', cat: 'dish', unit: 'порция', builder: 'constructor', baseGroup: 'pasta', preset: { base: 'Спагетти', slices: 1 }, alias: 'паста макароны спагетти своя топпинг', source: 'local' },
  { name: N.food_side_dish, emoji: '🍚', cat: 'dish', unit: 'порция', builder: 'constructor', baseGroup: 'garnish', preset: { base: 'Гречка', slices: 1 }, alias: 'гарнир гречка макароны картошка рис пюре с чем', source: 'local' },
  { name: N.food_pizza_homemade, emoji: '🍕', cat: 'dish', unit: 'порция', builder: 'constructor', baseGroup: 'pizza2', preset: { base: 'Тонкое тесто', slices: 1 }, alias: 'пицца своя топпинг с чем', source: 'local' },
  { name: N.food_smoothie_homemade, emoji: '🥤', cat: 'drink', unit: 'порция', builder: 'constructor', baseGroup: 'smoothie', preset: { base: 'Молоко', slices: 1 }, alias: 'смузи shake коктейль по ингредиентам фреш', source: 'local' },
  { name: N.food_omelette_homemade, emoji: '🍳', cat: 'dish', unit: 'порция', builder: 'constructor', baseGroup: 'omelet', preset: { base: 'Омлет (яйца)', slices: 2 }, alias: 'омлет яичница скрэмбл яйца с добавками завтрак', source: 'local' },
  { name: N.food_protein_shake, emoji: '🥤', cat: 'drink', unit: 'мл', builder: 'protein', alias: 'протеин шейк белковый коктейль гейнер', source: 'local' },
  { name: N.food_custom_drink, emoji: '🥤', cat: 'drink', unit: 'мл', builder: 'custom', alias: 'свой напиток добавить газировка лимонад energy', source: 'local' },
]

const plainFoods = Object.entries(DATA).flatMap(([cat, items]) =>
  items.map(([name, kcal, protein, carbs, fat, emoji]) => ({
    name,
    kcal,
    protein,
    carbs,
    fat,
    cat,
    unit: cat === 'drink' ? 'мл' : 'г',
    emoji: emoji || CAT_EMOJI[cat] || '🍽️',
    source: 'local',
  }))
)

const variantFoods = VARIANTS.map((v) => {
  const methods = v.methods.map(([label, kcal, protein, carbs, fat, emoji]) => ({
    label,
    kcal,
    protein,
    carbs,
    fat,
    emoji,
  }))
  const first = methods[0]
  return {
    name: v.name,
    cat: v.cat,
    emoji: v.emoji || CAT_EMOJI[v.cat] || '🍽️',
    alias: v.alias || '',
    source: 'local',
    hasVariants: true,
    methods,
    kcal: first.kcal,
    protein: first.protein,
    carbs: first.carbs,
    fat: first.fat,
  }
})

const DAIRY = [
  { name: N.food_milk, emoji: '🥛', protein: 3, carbs: 4.7, fats: [0.5, 1.5, 2.5, 3.2, 6], def: 2.5 },
  { name: N.food_kefir, emoji: '🥛', protein: 3, carbs: 4, fats: [0, 1, 2.5, 3.2], def: 2.5 },
  { name: N.food_cottage_cheese, emoji: '🧀', protein: 17, carbs: 3, fats: [0, 2, 5, 9, 18], def: 5 },
  { name: N.food_sour_cream, emoji: '🥛', protein: 2.8, carbs: 3.4, fats: [10, 15, 20, 25, 30], def: 20 },
  { name: N.food_cream, emoji: '🥛', protein: 2.8, carbs: 4, fats: [10, 20, 33], def: 20 },
  { name: N.food_yogurt, emoji: '🥛', protein: 5, carbs: 6, fats: [0, 2, 3.2], def: 2 },
  { name: N.food_greek_yogurt, emoji: '🥛', protein: 9, carbs: 3.8, fats: [0, 2, 5, 10], def: 2 },
  { name: N.food_ryazhenka_baked_milk, emoji: '🥛', protein: 2.9, carbs: 4.2, fats: [2.5, 4, 6], def: 4 },
  { name: N.food_soured_milk, emoji: '🥛', protein: 2.9, carbs: 4.1, fats: [1, 2.5, 3.2], def: 2.5 },
  { name: N.food_plant_based_milk, emoji: '🥛', protein: 1, carbs: 3, fats: [1, 1.5, 3], def: 1.5 },
]

const dairyFat = (protein, carbs, fat) => Math.round(4 * protein + 4 * carbs + 9 * fat)

const dairyFoods = DAIRY.map((d) => ({
  name: d.name,
  emoji: d.emoji || '🥛',
  cat: 'dairy',
  unit: 'г',
  source: 'local',
  dairy: true,
  protein: d.protein,
  carbs: d.carbs,
  fats: d.fats,
  defFat: d.def,
  fat: d.def,
  kcal: dairyFat(d.protein, d.carbs, d.def),
}))

// Иноязычные названия и синонимы живут не здесь, а в поиске по id
// (src/lib/search/aliases.js, keywords.js) и в словарях языков.
// foodId — стабильный id каталога (src/lib/catalog.js), то же поле, что у
// записи дневника. Не «id»: продукт базы разворачивают в запись
// ({ id, ...food }), и его id перезаписал бы уникальный id записи.
export const FOODS = [...BUILDERS, ...variantFoods, ...dairyFoods, ...plainFoods]
  .map((f) => ({ ...f, foodId: catalogId('foods', f.name) }))

// Масштабирует БЖУ на порцию. Неизвестное остаётся неизвестным: если база не
// знает белок, порция от этого его не приобретает. Раньше null молча
// превращался в NaN, а до того — в честный на вид ноль.
const scaleMacro = (v, k) => (v == null || !Number.isFinite(+v) ? null : +(+v * k).toFixed(1))

export function scale(food, grams) {
  const k = grams / 100
  const out = {
    kcal: Math.round(food.kcal * k),
    protein: scaleMacro(food.protein, k),
    carbs: scaleMacro(food.carbs, k),
    fat: scaleMacro(food.fat, k),
  }
  // Реальные сахар/насыщенные жиры (если известны на 100 г/мл источника) — донести
  // до записи в приёме пищи, а не терять при масштабировании порции.
  if (food.sugar != null) {
    out.sugar = +(food.sugar * k).toFixed(1)
    // Пометка «это измеренное значение» едет вместе с числом: иначе честный
    // ноль у масла на другом конце опять примут за незаполненное поле и
    // заменят оценкой из углеводов.
    out.sugarSrc = food.sugarSrc || 'measured'
  }
  if (food.satFat != null) out.satFat = +(food.satFat * k).toFixed(1)
  return out
}

// ── Нормализация запроса ─────────────────────────────────────────────────────
// Конвейер нормализации — общий для всего поиска: src/lib/search/normalize.js.
export const normalizeQuery = fold

// Поле количества принимает только то, что действительно является числом.
// Раньше «-50» оставалось в поле, а записывалось 50: минус молча выбрасывался
// при разборе, и увиденное расходилось с сохранённым. Незаконченный ввод
// («12.») пропускаем — иначе нельзя набрать дробное число.
export function sanitizeAmount(raw) {
  const s = String(raw ?? '').replace(/[^\d.,]/g, '').replace(/,/g, '.')
  const dot = s.indexOf('.')
  if (dot === -1) return s
  // Вторая и последующие точки — уже не число: «1.2.3» превращается в «1.23».
  return s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '')
}


// ── Поиск ────────────────────────────────────────────────────────────────────
// Поиск по локальной базе — на всех языках, с синонимами, опечатками,
// транслитерацией и ранжированием (src/lib/search). Пустой запрос — весь
// список, как и раньше. boost(food) → 0..1 — личная надбавка: она поднимает
// продукт внутри тира релевантности и не может перевести его через границу
// тира (MEMORY_BOOST_MAX в search/engine.js).
export function searchLocal(query, { boost, items = FOODS } = {}) {
  return searchLocalDetailed(query, { boost, items }).results
}

// Построить индекс поиска заранее (в простое после старта).
export function warmSearch() {
  searchModule()?.indexFor(FOODS)
}

// То же с подсказкой: { results, suggestion } — suggestion есть, когда выдача
// держится на исправлении опечатки («haferfloken» → Haferflocken).
export function searchLocalDetailed(query, { boost, items = FOODS } = {}) {
  const m = searchModule()
  return m ? m.searchItems(items, query, { boost }) : basicSearch(items, query)
}

// Пока движок поиска не загрузился (первые мгновения после запуска или нет
// сети и кэша): подстрока в русском названии или в названии на языке
// интерфейса. Грубо, но без пустого экрана.
export function basicSearch(items, query) {
  const list = Array.isArray(items) ? items : []
  const q = fold(query)
  if (!q) return { results: list, suggestion: null }
  const results = list.filter((i) => {
    if (!i || typeof i.name !== 'string') return false
    const own = fold(i.name)
    if (own.includes(q)) return true
    return i.source !== 'custom' && fold(foodName(i.name)).includes(q)
  })
  return { results, suggestion: null }
}

export const BREADS = [
  [N.food_toast_bread_2, 28, 'ломтик', 270, 8, 50, 3.5],
  [N.food_white_bread_2, 30, 'ломтик', 265, 9, 49, 3.2],
  [N.food_wholegrain_bread_2, 32, 'ломтик', 247, 13, 41, 4],
  [N.food_rye_bread_2, 30, 'ломтик', 259, 8.5, 48, 3.3],
  [N.food_borodinsky_bread, 30, 'ломтик', 208, 6.8, 40, 1.3],
  [N.food_baguette, 40, 'кусок', 270, 9, 52, 3],
  [N.food_ciabatta, 45, 'кусок', 271, 9, 52, 3.5],
  [N.food_burger_bun, 55, 'булочка', 280, 9, 48, 6],
  [N.food_hot_dog_bun, 45, 'булочка', 270, 8, 47, 5],
  [N.food_lavash, 35, 'лист', 275, 9, 56, 1],
  [N.food_crispbread, 10, 'штука', 310, 11, 57, 3],
  [N.food_croissant, 55, 'штука', 406, 8, 45, 21],
].map(([name, each, unitName, kcal, protein, carbs, fat]) => ({ name, each, unitName, kcal, protein, carbs, fat, emoji: '🍞' }))

const mkBases = (arr, defEmoji) =>
  arr.map(([name, each, unitName, kcal, protein, carbs, fat, emoji]) => ({ name, each, unitName, kcal, protein, carbs, fat, emoji: emoji || defEmoji }))

const SALAD_BASES = mkBases([
  [N.food_mixed_salad_leaves, 40, 'горсть', 17, 1.5, 2.9, 0.3], [N.food_lettuce_leaves, 40, 'горсть', 15, 1.4, 2.9, 0.2],
  [N.food_rocket, 30, 'горсть', 25, 2.6, 3.7, 0.7], [N.food_spinach, 40, 'горсть', 23, 2.9, 3.6, 0.4],
  [N.food_chinese_cabbage, 50, 'горсть', 16, 1.2, 3.2, 0.2],
], '🥬')

const BOWL_BASES = mkBases([
  [N.food_white_rice, 150, 'порция', 130, 2.7, 28, 0.3, '🍚'], [N.food_brown_rice, 150, 'порция', 112, 2.6, 23, 0.9, '🍚'],
  [N.food_quinoa, 150, 'порция', 120, 4.4, 21, 1.9], [N.food_bulgur, 150, 'порция', 83, 3, 19, 0.2],
  [N.food_couscous, 150, 'порция', 112, 3.8, 23, 0.2], [N.food_buckwheat, 150, 'порция', 110, 4, 21, 1.1, '🌾'],
  [N.food_noodles, 150, 'порция', 140, 5, 22, 4, '🍜'],
], '🍚')

const PORRIDGE_BASES = mkBases([
  [N.food_porridge_with_water, 200, 'порция', 88, 3, 15, 1.7], [N.food_porridge_with_milk, 200, 'порция', 120, 4.5, 16, 4],
  [N.food_buckwheat_porridge, 200, 'порция', 110, 4, 21, 1.1, '🌾'], [N.food_rice_porridge, 200, 'порция', 97, 2.5, 17, 2, '🍚'],
  [N.food_semolina_porridge, 200, 'порция', 98, 3, 17, 3.2], [N.food_millet_porridge, 200, 'порция', 90, 3, 17, 0.6],
], '🥣')

const PASTA_BASES = mkBases([
  [N.food_spaghetti, 180, 'порция', 158, 6, 31, 0.9], [N.food_penne, 180, 'порция', 157, 6, 30, 0.9],
  [N.food_fusilli, 180, 'порция', 158, 6, 31, 0.9], [N.food_tagliatelle, 180, 'порция', 160, 6, 31, 1],
  [N.food_wholegrain_pasta, 180, 'порция', 124, 5, 27, 0.5],
], '🍝')

const GARNISH_BASES = mkBases([
  [N.food_buckwheat, 150, 'порция', 110, 4, 21, 1.1, '🌾'], [N.food_pasta, 180, 'порция', 158, 6, 31, 0.9, '🍝'],
  [N.food_mashed_potatoes, 150, 'порция', 113, 2.1, 16, 4.2, '🥔'], [N.food_boiled_potatoes, 150, 'порция', 82, 2, 17, 0.1, '🥔'],
  [N.food_fried_potatoes, 150, 'порция', 192, 2.8, 23, 9.5, '🥔'], [N.food_chips_fries, 150, 'порция', 312, 3.4, 41, 15, '🍟'],
  [N.food_boiled_rice, 150, 'порция', 130, 2.7, 28, 0.3, '🍚'], [N.food_brown_rice, 150, 'порция', 112, 2.6, 23, 0.9, '🍚'],
  [N.food_bulgur, 150, 'порция', 83, 3, 19, 0.2], [N.food_quinoa, 150, 'порция', 120, 4.4, 21, 1.9],
  [N.food_pearl_barley, 150, 'порция', 121, 2.3, 28, 0.4], [N.food_millet_porridge, 150, 'порция', 90, 3, 17, 0.6],
  [N.food_couscous, 150, 'порция', 112, 3.8, 23, 0.2], [N.food_lentils, 150, 'порция', 116, 9, 20, 0.4, '🫘'],
  [N.food_grilled_vegetables, 150, 'порция', 80, 2, 9, 4, '🥦'], [N.food_pea_puree, 150, 'порция', 118, 8, 21, 0.4],
], '🍚')

const PIZZA_BASES = mkBases([
  [N.food_thin_crust, 150, 'основа', 270, 9, 52, 3], [N.food_thick_crust, 180, 'основа', 280, 8, 50, 6],
  [N.food_fluffy_crust, 200, 'основа', 285, 8, 49, 7], [N.food_ready_made_base, 150, 'основа', 270, 9, 50, 4],
  [N.food_kefir_dough, 170, 'основа', 250, 8, 46, 4],
], '🍕')

const SMOOTHIE_BASES = mkBases([
  [N.food_milk, 250, 'стакан', 60, 2.9, 4.7, 3.2, '🥛'], [N.food_water, 250, 'стакан', 0, 0, 0, 0, '💧'],
  [N.food_orange_juice_2, 250, 'стакан', 45, 0.7, 10, 0.2, '🧃'], [N.food_drinkable_yogurt, 250, 'стакан', 70, 2.8, 12, 1.5],
  [N.food_kefir, 250, 'стакан', 40, 3, 4, 1], [N.food_plant_based_milk, 250, 'стакан', 35, 1, 3, 1.5, '🥛'],
], '🥤')

const OMELET_BASES = mkBases([
  [N.food_omelette_eggs, 55, 'яйцо', 154, 11, 1.6, 12], [N.food_fried_egg, 55, 'яйцо', 196, 14, 0.8, 15],
  [N.food_scrambled_eggs, 55, 'яйцо', 148, 10, 1.6, 11], [N.food_egg_white_omelette, 55, 'яйцо', 52, 11, 0.7, 0.2],
], '🍳')

// Подписи групп — из словаря (add.group.<ключ>): это интерфейс, а не данные.
const baseGroup = (key, items) => ({
  get label() { return t(`add.group.${key}.label`) },
  get countLabel() { return t(`add.group.${key}.count`) },
  items,
})

export const BASE_GROUPS = {
  bread: baseGroup('bread', BREADS),
  salad: baseGroup('salad', SALAD_BASES),
  bowl: baseGroup('bowl', BOWL_BASES),
  porridge: baseGroup('porridge', PORRIDGE_BASES),
  pasta: baseGroup('pasta', PASTA_BASES),
  garnish: baseGroup('garnish', GARNISH_BASES),
  pizza2: baseGroup('pizza2', PIZZA_BASES),
  smoothie: baseGroup('smoothie', SMOOTHIE_BASES),
  omelet: baseGroup('omelet', OMELET_BASES),
}

const ING = {
  sauce: [
    [N.food_mayonnaise, 680, 1, 2.6, 72, 12, 'слой', 1], [N.food_ketchup, 112, 1.3, 26, 0.3, 12, 'слой', 1],
    [N.food_mustard, 143, 9, 9, 9, 8, 'слой', 1], [N.food_butter, 717, 0.9, 0.1, 81, 7, 'слой', 1, '🧈'],
    [N.food_sour_cream, 206, 2.8, 3.2, 20, 15, 'ложка', 1], [N.food_cream_cheese, 250, 6, 4, 24, 20, 'слой', 1, '🧀'],
    [N.food_cheese_spread, 226, 12, 4, 18, 20, 'слой', 1, '🧀'], [N.food_peanut_butter, 588, 25, 20, 50, 15, 'слой', 1, '🥜'],
    [N.food_jam_2, 265, 0.3, 65, 0, 15, 'слой', 1], [N.food_honey, 304, 0.3, 82, 0, 12, 'слой', 1, '🍯'],
    [N.food_hummus, 170, 8, 14, 10, 20, 'слой', 1], [N.food_avocado_spread, 160, 2, 9, 15, 25, 'слой', 1, '🥑'],
    [N.food_pesto, 450, 5, 6, 45, 10, 'ложка', 1], [N.food_condensed_milk, 320, 7, 55, 8, 15, 'слой', 1],
  ],
  meat: [
    [N.food_salami, 336, 22, 1, 27, 6, 'ломтик', 4], [N.food_pepperoni, 494, 20, 2, 44, 4, 'ломтик', 5], [N.food_cervelat, 360, 24, 0, 29, 6, 'ломтик', 4],
    [N.food_doktorskaya_sausage, 257, 13, 2, 22, 15, 'кружок', 2], [N.food_bologna_sausage, 257, 13, 2, 22, 15, 'кружок', 2],
    [N.food_ham, 145, 17, 1.5, 8, 15, 'ломтик', 2], [N.food_bacon, 541, 37, 1.4, 42, 8, 'полоска', 2], [N.food_roast_pork, 230, 15, 0, 19, 15, 'ломтик', 2],
    [N.food_pork_loin_sliced, 200, 16, 0, 15, 15, 'ломтик', 2], [N.food_roast_beef, 190, 22, 0, 11, 20, 'ломтик', 1], [N.food_sliced_chicken, 110, 23, 0, 2, 20, 'ломтик', 1, '🍗'],
    [N.food_sliced_turkey, 100, 22, 0, 1.5, 20, 'ломтик', 1, '🍗'], [N.food_pate, 300, 12, 3, 27, 20, 'слой', 1], [N.food_frankfurter, 266, 11, 2, 24, 40, 'штука', 1],
    [N.food_patty, 220, 16, 8, 14, 60, 'штука', 1], [N.food_rotisserie_chicken, 190, 25, 0, 10, 30, 'ломтик', 1, '🍗'],
  ],
  fish: [
    [N.food_lightly_salted_salmon, 200, 22, 0, 12, 15, 'ломтик', 2], [N.food_lightly_salted_trout, 190, 21, 0, 11, 15, 'ломтик', 2], [N.food_canned_tuna, 116, 26, 0, 1, 30, 'ложка', 1],
    [N.food_smoked_sprats_in_oil, 363, 17, 0, 32, 8, 'штука', 3], [N.food_salmon_roe, 250, 24, 4, 17, 15, 'ложка', 1, '🥚'], [N.food_crab_sticks, 88, 6, 12, 1, 15, 'штука', 2],
    [N.food_herring_2, 158, 18, 0, 9, 15, 'ломтик', 2],
  ],
  cheese: [
    [N.food_cheddar, 402, 25, 1, 33, 20, 'ломтик', 1], [N.food_mozzarella, 280, 22, 2, 17, 20, 'ломтик', 1], [N.food_gouda, 356, 25, 2, 27, 20, 'ломтик', 1],
    [N.food_rossiyskiy_cheese, 363, 23, 0, 29, 20, 'ломтик', 1], [N.food_suluguni, 290, 20, 0, 24, 20, 'ломтик', 1], [N.food_maasdam, 350, 24, 0, 28, 20, 'ломтик', 1],
    [N.food_parmesan, 392, 36, 3, 29, 10, 'стружка', 1], [N.food_feta, 264, 14, 4, 21, 20, 'кусочек', 1], [N.food_brie, 334, 21, 0.5, 28, 20, 'ломтик', 1],
    [N.food_cheese_slice, 226, 12, 4, 18, 20, 'ломтик', 1], [N.food_cottage_cheese, 121, 17, 3, 5, 30, 'ложка', 1],
  ],
  veg: [
    [N.food_tomato, 18, 0.9, 3.9, 0.2, 15, 'кружок', 2, '🍅'], [N.food_cucumber, 15, 0.7, 3.6, 0.1, 10, 'кружок', 3, '🥒'], [N.food_lettuce_leaf, 15, 1.4, 2.9, 0.2, 8, 'лист', 1, '🥬'],
    [N.food_onion, 40, 1.1, 9, 0.1, 8, 'кольца', 1, '🧅'], [N.food_red_onion, 40, 1.1, 9, 0.1, 8, 'кольца', 1, '🧅'], [N.food_bell_pepper_2, 27, 1, 6, 0.3, 12, 'ломтики', 1, '🫑'],
    [N.food_pickled_cucumber, 16, 0.7, 3, 0.1, 8, 'кружок', 2, '🥒'], [N.food_avocado, 160, 2, 9, 15, 20, 'ломтики', 2, '🥑'], [N.food_rocket, 25, 2.6, 3.7, 0.7, 5, 'горсть', 1],
    [N.food_green_olives, 115, 0.8, 6, 11, 5, 'штука', 3], [N.food_jalapeno, 27, 1.3, 6, 0.5, 3, 'колечко', 3, '🌶️'], [N.food_fried_mushrooms, 80, 4, 4, 5.5, 15, 'ложка', 1, '🍄'],
    [N.food_sauerkraut, 19, 1.3, 4, 0.1, 20, 'горсть', 1, '🥬'], [N.food_fresh_spinach, 23, 2.9, 3.6, 0.4, 10, 'горсть', 1],
  ],
  egg: [
    [N.food_boiled_egg, 155, 13, 1.1, 11, 50, 'штука', 1], [N.food_fried_egg_2, 196, 14, 0.8, 15, 60, 'порция', 1, '🍳'],
  ],
  topping: [
    [N.food_banana, 89, 1.1, 23, 0.3, 60, 'половинка', 1, '🍌'], [N.food_strawberries, 33, 0.7, 8, 0.3, 50, 'горсть', 1, '🍓'],
    [N.food_bilberries, 57, 0.7, 14, 0.3, 40, 'горсть', 1, '🫐'], [N.food_raspberries, 52, 1.2, 12, 0.7, 40, 'горсть', 1],
    [N.food_walnuts, 654, 15, 14, 65, 10, 'горсть', 1, '🌰'], [N.food_almonds, 579, 21, 22, 50, 12, 'горсть', 1, '🌰'],
    [N.food_chia_seeds, 486, 17, 42, 31, 10, 'ложка', 1], [N.food_flaxseeds, 534, 18, 29, 42, 10, 'ложка', 1],
    [N.food_raisins, 299, 3.1, 79, 0.5, 15, 'горсть', 1], [N.food_dried_apricots, 241, 3.4, 63, 0.5, 20, 'штука', 2],
    [N.food_desiccated_coconut, 660, 7, 23, 65, 8, 'ложка', 1], [N.food_granola, 450, 10, 60, 15, 25, 'горсть', 1],
    [N.food_chocolate_chips, 535, 7.6, 59, 30, 10, 'щепотка', 1, '🍫'], [N.food_protein_scoop, 400, 80, 8, 6, 30, 'скуп', 1, '💪'],
    [N.food_maple_syrup, 260, 0, 67, 0, 15, 'ложка', 1], [N.food_pumpkin_seeds_2, 559, 30, 11, 49, 10, 'горсть', 1],
    [N.food_mango, 60, 0.8, 15, 0.4, 80, 'половинка', 1, '🥭'], [N.food_rolled_oats, 366, 12, 62, 7, 30, 'ложка', 1],
    [N.food_dates, 277, 1.8, 75, 0.2, 20, 'штука', 2], [N.food_honey, 304, 0.3, 82, 0, 12, 'ложка', 1, '🍯'],
  ],
  dressing: [
    [N.food_olive_oil, 884, 0, 0, 100, 7, 'ложка', 1, '🫒'], [N.food_balsamic_vinegar, 88, 0.5, 17, 0, 8, 'ложка', 1],
    [N.food_caesar_dressing, 480, 2, 4, 50, 15, 'ложка', 1], [N.food_ranch_dressing, 430, 1, 6, 45, 15, 'ложка', 1],
    [N.food_yogurt_dressing, 90, 3, 6, 5, 15, 'ложка', 1], [N.food_soy_sauce, 53, 8, 4.9, 0.6, 8, 'ложка', 1],
    [N.food_teriyaki, 89, 5, 15, 0, 12, 'ложка', 1], [N.food_tahini, 595, 17, 21, 54, 12, 'ложка', 1],
  ],
  extra: [
    [N.food_cherry_tomatoes, 18, 0.9, 3.9, 0.2, 10, 'штука', 4, '🍅'], [N.food_sweetcorn, 86, 3.2, 19, 1.2, 20, 'ложка', 1, '🌽'],
    [N.food_canned_beans_2, 127, 8.7, 23, 0.5, 30, 'ложка', 1, '🫘'], [N.food_canned_chickpeas_2, 164, 8.9, 27, 2.6, 30, 'ложка', 1, '🫘'],
    [N.food_edamame, 121, 12, 9, 5, 30, 'горсть', 1], [N.food_korean_style_carrot_salad, 134, 1.2, 9, 10, 20, 'горсть', 1, '🥕'],
    [N.food_beetroot_cooked, 43, 1.6, 10, 0.2, 25, 'горсть', 1], [N.food_croutons, 400, 10, 60, 14, 10, 'горсть', 1, '🍞'],
    [N.food_nori, 35, 6, 5, 0.4, 3, 'лист', 1], [N.food_sesame_seeds, 573, 18, 23, 50, 5, 'щепотка', 1],
    [N.food_shrimp, 99, 24, 0.2, 0.3, 15, 'штука', 4, '🦐'], [N.food_small_meatballs, 250, 14, 8, 18, 20, 'штука', 3],
    [N.food_tofu, 76, 8, 1.9, 4.8, 30, 'кубик', 3], [N.food_pineapple, 50, 0.5, 13, 0.1, 20, 'ломтик', 2, '🍍'],
    [N.food_black_olives, 115, 0.8, 6, 11, 5, 'штука', 4], [N.food_capers, 23, 2.4, 5, 0.9, 5, 'щепотка', 1],
  ],
  psauce: [
    [N.food_bolognese_sauce, 150, 7, 6, 10, 50, 'половник', 1], [N.food_cream_sauce, 200, 3, 5, 18, 40, 'половник', 1],
    [N.food_tomato_sauce, 60, 2, 9, 2, 40, 'половник', 1], [N.food_cheese_sauce, 180, 7, 6, 14, 30, 'половник', 1],
  ],
  gravy: [
    [N.food_canned_stewed_meat, 220, 15, 0, 18, 40, 'ложка', 1], [N.food_meat_gravy, 90, 6, 5, 5, 50, 'половник', 1],
    [N.food_goulash, 150, 12, 6, 8, 60, 'порция', 1], [N.food_chicken_goulash, 130, 14, 4, 6, 60, 'порция', 1],
    [N.food_pan_fried_meat, 200, 14, 3, 14, 50, 'порция', 1], [N.food_braised_liver, 150, 17, 4, 7, 50, 'порция', 1],
    [N.food_lecso_pepper_stew, 40, 1.3, 6, 1.3, 40, 'ложка', 1], [N.food_mushroom_sauce, 80, 2, 6, 5, 40, 'половник', 1],
    [N.food_tomato_gravy, 60, 2, 8, 2, 40, 'половник', 1], [N.food_fried_onions, 120, 1.5, 9, 9, 20, 'ложка', 1],
    [N.food_sauteed_vegetables, 90, 1.5, 8, 6, 40, 'ложка', 1], [N.food_thick_sausage, 270, 10, 2, 24, 80, 'штука', 1],
    [N.food_meatball, 170, 10, 9, 10, 40, 'штука', 2], [N.food_small_patty, 180, 12, 9, 11, 70, 'штука', 1],
    [N.food_fresh_herbs, 30, 3, 5, 0.4, 5, 'щепотка', 1], [N.food_grated_cheese_2, 360, 25, 0, 29, 15, 'горсть', 1, '🧀'],
    [N.food_fried_egg_3, 196, 14, 0.8, 15, 50, 'штука', 1, '🍳'], [N.food_adjika_spicy_paste, 59, 1, 6, 3, 10, 'ложка', 1],
  ],
}

export const CONSTRUCTOR_ING = Object.entries(ING).flatMap(([cat, items]) =>
  items.map(([name, kcal, protein, carbs, fat, each, unitName, def, emoji]) => ({
    name,
    cat,
    kcal,
    protein,
    carbs,
    fat,
    each,
    unitName,
    def: def || 1,
    emoji: emoji || CAT_EMOJI[cat] || '🍽️',
    foodId: catalogId('foods', name),
  }))
)

const PORTIONS_BY_NAME = {
  'Банан': [['1 шт без кожуры', 120], ['маленький', 90], ['большой', 150]],
  'Яблоко': [['1 шт', 150], ['маленькое', 110], ['большое', 200]],
  'Груша': [['1 шт', 170]],
  'Апельсин': [['1 шт без кожуры', 130]],
  'Мандарин': [['1 шт без кожуры', 60]],
  'Киви': [['1 шт', 75]],
  'Персик': [['1 шт', 120]],
  'Слива': [['1 шт', 40]],
  'Абрикос': [['1 шт', 35]],
  'Хурма': [['1 шт', 150]],
  'Гранат': [['1 шт, зёрна', 150]],
  'Манго': [['1 шт без кожуры', 200]],
  'Виноград': [['горсть', 100], ['гроздь', 200]],
  'Клубника': [['1 шт', 15], ['горсть', 100]],
  'Лимон': [['1 шт', 60], ['долька', 10]],
  'Финики': [['1 шт', 8], ['горсть', 40]],
  'Помидор': [['1 шт', 120], ['черри 1 шт', 15]],
  'Огурец': [['1 шт', 100]],
  'Морковь': [['1 шт', 80]],
  'Перец болгарский': [['1 шт', 150]],
  'Лук репчатый': [['1 шт', 90]],
  'Авокадо': [['половина', 70], ['1 шт без косточки', 140]],
  'Свёкла': [['1 шт', 150]],
  'Кабачок': [['1 шт', 250]],
  'Баклажан': [['1 шт', 250]],
  'Картофель': [['1 шт', 120], ['маленькая', 70], ['большая', 180]],
  'Яйцо': [['1 шт', 55], ['2 шт', 110], ['3 шт', 165]],
  'Яичный белок': [['1 шт', 35]],
  'Яйцо перепелиное': [['1 шт', 12]],
  'Куриная грудка': [['1 шт', 180], ['половина', 90]],
  'Куриное бедро': [['1 шт без кости', 120]],
  'Куриные крылья': [['1 шт', 45]],
  'Овсянка': [['стакан 250 мл', 220], ['тарелка', 300], ['порция', 200]],
  'Рис': [['стакан 250 мл', 200], ['порция', 150]],
  'Гречка': [['стакан 250 мл', 200], ['порция', 150]],
  'Хлеб белый': [['ломтик', 30], ['кусок', 40]],
  'Хлеб ржаной': [['ломтик', 30]],
  'Хлеб цельнозерновой': [['ломтик', 32]],
  'Батон': [['ломтик', 25]],
  'Грецкий орех': [['1 шт', 5], ['горсть', 30]],
  'Миндаль': [['горсть', 30]],
  'Сыр российский': [['ломтик', 20], ['порция', 40]],
  'Шоколад молочный': [['долька', 5], ['плитка', 90]],
  'Шоколад тёмный': [['долька', 5], ['плитка', 90]],
  'Печенье овсяное': [['1 шт', 15]],
  'Молоко': [['стакан 250 мл', 250], ['кружка', 300]],
  'Кефир': [['стакан 250 мл', 250]],
  'Творог': [['пачка', 200], ['порция', 150], ['ст. ложка', 25]],
  'Сметана': [['ст. ложка', 20], ['порция', 50]],
  'Йогурт': [['баночка', 125], ['стакан', 200]],
  'Греческий йогурт': [['баночка', 140], ['порция', 100]],
  'Сливки': [['ст. ложка', 15], ['порция', 50]],
  // McDonald's — точные граммовки порций
  'Биг Мак': [['1 шт', 200]],
  'Гамбургер': [['1 шт', 110]],
  'Чизбургер Мак': [['1 шт', 130]],
  'Двойной чизбургер Мак': [['1 шт', 195]],
  'МакЧикен': [['1 шт', 185]],
  'Биг Тейсти': [['1 шт', 240]],
  'Биг Тейсти с беконом': [['1 шт', 260]],
  'Ролл с курицей Мак': [['1 шт', 225]],
  'Фишбургер Мак': [['1 шт', 145]],
  'Картофель фри S': [['1 порция', 100]],
  'Картофель фри M': [['1 порция', 150]],
  'Картофель фри L': [['1 порция', 197]],
  'Картошка по-деревенски M': [['1 порция', 154]],
  'Наггетсы 4 шт': [['4 шт', 67]],
  'Наггетсы 6 шт': [['6 шт', 100]],
  'Наггетсы 9 шт': [['9 шт', 150]],
  'МакФлури Орео': [['1 стакан', 260]],
  'Мороженое рожок Мак': [['1 шт', 125]],
  'Пирожок яблочный Мак': [['1 шт', 77]],
  'Маффин с яйцом Мак': [['1 шт', 137]],
  'Биг Брекфаст': [['1 порция', 265]],
  'Кола S Мак': [['S (0.2 л)', 200]],
  'Кола M Мак': [['M (0.4 л)', 400], ['L (0.5 л)', 500]],
  'Молочный коктейль Мак': [['M (0.4 л)', 420], ['L (0.5 л)', 500]],
  'Латте Мак': [['S', 200], ['M (0.3 л)', 300], ['L', 400]],
}

const DISH_CATS = new Set(['dish', 'pasta', 'pizza', 'asian', 'mexican', 'fastfood', 'mcdonalds', 'salad', 'soups', 'hot', 'seafood2', 'caucasus', 'breakfast', 'dessert'])

const PORTIONS_BY_CAT = {
  fruit: [['1 шт', 130], ['горсть', 100]],
  berry: [['горсть', 80], ['стакан', 150]],
  grain: [['стакан 250 мл', 200], ['порция', 150], ['тарелка', 250], ['ст. ложка', 25]],
  legume: [['стакан', 200], ['порция', 150]],
  poultry: [['порция', 150], ['1 грудка', 180]],
  meat: [['порция', 150], ['стейк', 200]],
  fish: [['1 филе', 150], ['порция', 150]],
  sea: [['горсть', 100], ['порция', 120]],
  egg: [['1 шт', 55], ['2 шт', 110]],
  dairy: [['стакан', 200], ['порция', 150], ['ст. ложка', 20]],
  cheese: [['ломтик', 20], ['порция', 40]],
  veg: [['1 шт', 100], ['горсть', 80]],
  nut: [['горсть', 30], ['ст. ложка', 15]],
  bread: [['ломтик', 30], ['кусок', 40]],
  oil: [['ч. ложка', 5], ['ст. ложка', 15]],
  sweet: [['кусок', 40], ['ложка', 20], ['долька', 10]],
  snack: [['горсть', 25], ['маленькая пачка', 40], ['пачка', 100]],
  drink: [['стакан', 250], ['кружка', 300], ['банка', 330], ['бутылка', 500]],
  sauce: [['ч. ложка', 6], ['ст. ложка', 15]],
  dish: [['порция', 250], ['полпорции', 150], ['тарелка', 350]],
  pastry: [['1 шт', 70], ['половина', 35], ['кусок', 100]],
  supp: [['порция (мерная ложка)', 30], ['половина порции', 15], ['2 порции', 60]],
  _default: [['порция', 100], ['половина', 50], ['двойная', 200]],
}

// Категория по НАЗВАНИЮ — для продуктов, у которых её нет: товары из Open Food
// Facts и собственные записи пользователя. Без этого им доставались бесполезные
// «порция / половина / двойная» вместо человеческих «ломтик», «стакан», «ложка».
//
// Сопоставление идёт по НАЧАЛУ СЛОВА, а не по подстроке: иначе «шоКОЛАд» попадал
// бы в напитки («кола»), а «выСОКий» — в соки. Начало слова при этом переживает
// склонения: «молочн» → «молочного». Порядок проверок важен: узкие признаки
// раньше широких (сладости раньше напитков, иначе «шоколадный коктейль» уедет
// не туда).
const CAT_HINTS = [
  // Солёные снеки — раньше сладостей: «чипсы с карамелью» это всё-таки чипсы,
  // и мера у них пачка, а не долька.
  ['snack', ['чипс', 'попкорн', 'начос', 'крекер', 'сухарик', 'соломк', 'палочк', 'снек', 'chips', 'popcorn', 'nachos', 'cracker']],
  ['sweet', ['шоколад', 'конфет', 'печень', 'пряник', 'зефир', 'халв', 'мармелад', 'вафл', 'торт', 'пирожн', 'мороженое', 'пломбир', 'десерт', 'батончик', 'карамел', 'ирис', 'нуга', 'сахар', 'варень', 'джем', 'повидл', 'сгущен', 'нутелл']],
  ['drink', ['вода', 'воды', 'сок', 'кола', 'пепси', 'лимонад', 'газиров', 'квас', 'морс', 'компот', 'нектар', 'напиток', 'напитк', 'чай', 'кофе', 'латте', 'капучино', 'смузи', 'энергет', 'пиво', 'вино', 'сидр', 'коктейл', 'juice', 'drink', 'cola', 'water']],
  ['cheese', ['сыр', 'сыра', 'чеддер', 'моцарел', 'пармезан', 'фета', 'бри', 'гауда', 'сулугуни', 'брынз', 'маскарпоне', 'рикотт']],
  ['dairy', ['молоко', 'молока', 'молочн', 'кефир', 'йогурт', 'творог', 'творож', 'сметан', 'сливк', 'ряженк', 'простокваш', 'айран', 'закваск']],
  ['bread', ['хлеб', 'батон', 'лаваш', 'тортиль', 'багет', 'хлебц', 'сухар', 'тост']],
  ['pastry', ['круассан', 'булочк', 'булка', 'пирожок', 'пирожк', 'слойк', 'пончик', 'маффин', 'капкейк', 'кекс', 'ватрушк', 'штрудел', 'бискв']],
  ['oil', ['масло', 'масла', 'олив', 'oil']],
  ['sauce', ['соус', 'кетчуп', 'майонез', 'горчиц', 'аджик', 'песто', 'терияки', 'сальса', 'хумус', 'подлив']],
  ['nut', ['орех', 'миндал', 'фундук', 'кешью', 'арахис', 'фисташ', 'семечк', 'семена', 'чиа', 'кунжут']],
  ['berry', ['клубник', 'малин', 'черник', 'ежевик', 'смородин', 'вишн', 'голубик', 'брусник', 'клюкв', 'ягод']],
  ['fruit', ['яблок', 'банан', 'груш', 'апельсин', 'мандарин', 'виноград', 'киви', 'ананас', 'манго', 'персик', 'слив', 'абрикос', 'арбуз', 'дын', 'гранат', 'хурма', 'грейпфрут', 'лимон', 'фрукт', 'изюм', 'финик', 'курага', 'чернослив']],
  ['veg', ['помидор', 'томат', 'огурец', 'огурц', 'капуст', 'брокколи', 'морков', 'свекл', 'перец', 'кабач', 'баклажан', 'лук', 'чеснок', 'шпинат', 'руккол', 'грибы', 'шампиньон', 'овощ', 'картоф', 'картош']],
  ['egg', ['яйцо', 'яйца', 'яичниц', 'омлет']],
  ['legume', ['фасол', 'чечевиц', 'нут', 'горох', 'бобы', 'маш', 'эдамаме', 'соя']],
  ['grain', ['крупа', 'крупы', 'каша', 'овсян', 'гречк', 'гречнев', 'рис', 'рисов', 'булгур', 'киноа', 'перловк', 'пшен', 'кускус', 'мюсли', 'гранол', 'хлопья', 'отруб']],
  ['pasta', ['макарон', 'паста', 'спагетти', 'лапш', 'вермишел', 'феттучин', 'пенне']],
  ['poultry', ['куриц', 'куриное', 'куриная', 'кури', 'индейк', 'утка', 'грудка']],
  ['fish', ['рыба', 'рыбы', 'лосос', 'семга', 'форел', 'тунец', 'треск', 'минтай', 'сельд', 'селедк', 'скумбр', 'горбуш']],
  ['sea', ['кревет', 'мидии', 'кальмар', 'краб', 'осьминог', 'устриц', 'морепродукт']],
  ['meat', ['мясо', 'мясн', 'говядин', 'свинин', 'баранин', 'телятин', 'фарш', 'колбас', 'сосиск', 'ветчин', 'бекон', 'салями', 'стейк', 'котлет', 'шашлык']],
  ['supp', ['протеин', 'изолят', 'гейнер', 'whey', 'креатин', 'bcaa', 'добавк']],
]

export function inferCat(name) {
  const n = fold(name || '')
  if (!n) return null
  const words = n.split(/[^0-9a-zа-я%]+/).filter(Boolean)
  if (!words.length) return null
  for (const [cat, stems] of CAT_HINTS) {
    if (stems.some((stem) => words.some((w) => w.startsWith(stem)))) return cat
  }
  return null
}

export function getPortions(food) {
  if (!food) return []
  // Категория: явная → выведенная из названия. Так бытовые меры получают и
  // товары из Open Food Facts, и продукты, добавленные вручную.
  const effectiveCat = food.cat || inferCat(food.name)
  const isDrink = food.unit === 'мл' || effectiveCat === 'drink'
  const catKey = isDrink ? 'drink' : DISH_CATS.has(effectiveCat) ? 'dish' : effectiveCat
  const spec = PORTIONS_BY_NAME[food.name] || []
  const byCat = PORTIONS_BY_CAT[catKey] || PORTIONS_BY_CAT._default
  const base = spec.length >= 3 ? spec : [...spec, ...byCat]
  // Порции самого товара (у продукта со штрихкода — порция и вес с упаковки)
  // идут первыми: они точнее любых наших усреднённых «стакан / порция».
  const own = (food.portions || []).map((p) => [p.label, p.grams])
  const list = own.length ? [...own, ...base] : base
  const seen = new Set()
  const out = []
  for (const [label, grams] of list) {
    if (seen.has(label)) continue
    seen.add(label)
    out.push({ label, grams })
    if (out.length >= 6) break
  }
  return out
}

// Поиск по названиям в произвольном списке (свои блюда, рецепты).
//
// Те же правила, что и для продуктов: нормализация, синонимы, опечатки. Своё
// человек ищет по имени ровно так же, как всё остальное. Название своё —
// поэтому без каталога: «Борщ» человека не превращается в борщ из базы.
// minResults: 1 — опечатки в своих названиях человек делает так же, как в
// чужих, и нечёткий проход нужен, даже если строгий что-то нашёл.
export function searchByName(list, query) {
  const m = searchModule()
  if (!m) return basicSearch(list || [], query).results
  return m.searchItems(list || [], query, { minResults: 1, toEntity: m.ownEntity }).results
}

export function searchIngredients(query) {
  return searchLocal(query, { items: CONSTRUCTOR_ING })
}

// ── Товар по штрихкоду ───────────────────────────────────────────────────────

const OFF_FIELDS = [
  'product_name', 'product_name_ru', 'generic_name', 'brands', 'quantity',
  'product_quantity', 'serving_size', 'serving_quantity', 'nutriments', 'categories_tags',
  'image_front_url', 'image_front_small_url', 'image_url', 'image_small_url',
].join(',')

const DRINK_TAGS = /(beverages|boissons|drinks|напитки|waters|juices|sodas|milks)/i
const VOLUME_RE = /\d\s*(ml|мл|cl|l\b|л\b|liter|litre|литр)/i

function looksLikeDrink(p) {
  if ((p.categories_tags || []).some((t) => DRINK_TAGS.test(t))) return true
  return VOLUME_RE.test(p.quantity || '') || VOLUME_RE.test(p.serving_size || '')
}

// Значение на 100 г/мл. Если база знает только «за порцию», пересчитываем —
// это перевод единиц реальных данных, а не выдумывание недостающих.
function per100(nutriments, key, servingQty) {
  const direct = nutriments[key + '_100g']
  if (direct != null && Number.isFinite(+direct)) return +direct
  const serving = nutriments[key + '_serving']
  if (serving != null && Number.isFinite(+serving) && servingQty > 0) {
    return (+serving * 100) / servingQty
  }
  return null
}

const offMacro = (v) => (v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(1))

// Известны ли БЖУ. Ни одного из трёх — значит показывать «Б0 У0 Ж0» нельзя.
export function hasMacros(f) {
  return f?.protein != null || f?.carbs != null || f?.fat != null
}

// Единая подпись количества: «150 г», «2 шт», «1,5 порции».
//
// Две вещи, на которых легко опозориться и которые нельзя чинить в каждом
// месте по-своему:
//   • десятичный разделитель. По-русски это запятая, а Number печатает точку;
//   • склонение. «1 порция», «2 порции», «5 порций», а любое дробное — всегда
//     «порции» (1,5 порции; 0,5 порции). Раньше дневник печатал «1.5 порция».
// Граммы, миллилитры и штуки не склоняются, поэтому таблица нужна только для
// порций — но проходить через эту функцию должны все, иначе разделитель снова
// разъедется.
//
// Единица в данных — по-прежнему русское слово ('г', 'мл', 'шт', 'порция'):
// это значение, которое лежит в дневнике, а не подпись. Подпись и склонение
// даёт словарь, разделитель дробной части — Intl на языке интерфейса.
const UNIT_LABEL = { 'г': 'units.gN', 'мл': 'units.mlN', 'шт': 'units.piece', 'порция': 'units.serving' }

export function formatAmount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return fmtNum(Math.round(n * 100) / 100, { maximumFractionDigits: 2, useGrouping: false })
}

export function amountLabel(value, unit = 'г') {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  const key = UNIT_LABEL[unit]
  if (!key) return `${formatAmount(n)} ${unit}`
  return t(key, { n: formatAmount(n), count: n })
}

// Подпись единицы без числа: «г», «ml», «Portion».
export { unitLabel } from './units.js'

// Единая подпись «Б… У… Ж…» для всего приложения.
//
// Неизвестное показываем прочерком, а не нулём и не пустотой. Пустота — это
// как раз то, что получалось раньше: в дневнике висела буква «Ж» без числа.
// В русской строке БЖУ дробная часть исторически через точку («Б7.5»), и тесты
// это закрепляют; в остальных языках — свой разделитель («P7,5» по-испански).
export function macroLabel(m) {
  const num = (n) => (getLang() === SOURCE_LANG ? n : fmtNum(n, { maximumFractionDigits: 1, useGrouping: false }))
  const v = (x) => (x == null || !Number.isFinite(+x) ? '—' : num(+(+x).toFixed(1)))
  return t('macro.line', { p: v(m?.protein), c: v(m?.carbs), f: v(m?.fat) })
}

const posNum = (v, max) => {
  const n = +v
  return Number.isFinite(n) && n > 0 && n <= max ? n : null
}

// Поиск продукта по считанному коду.
//
// Возвращает:
//   { status: 'ok', food }            — нашли и название, и калорийность
//   { status: 'no-nutrition', name }  — название есть, данных о составе нет
//   { status: 'not-found' }           — такого кода в базе нет
// Ошибка сети — исключение: «нет связи» и «нет товара» человеку надо показывать
// по-разному, и молча подменять одно другим нельзя.
export async function lookupBarcode(code, signal) {
  let product = null
  // Разбор штрихкода нужен только сканеру — грузится вместе с ним.
  const { barcodeVariants } = await import('./barcode.js')
  // Один и тот же товар лежит в базе то с ведущим нулём, то без — пробуем оба.
  for (const variant of barcodeVariants(code)) {
    const url = `https://ru.openfoodfacts.org/api/v2/product/${encodeURIComponent(variant)}.json?fields=${OFF_FIELDS}`
    const res = await fetch(url, { signal })
    if (res.status === 404) continue
    if (!res.ok) throw new Error('off_http_' + res.status)
    const data = await res.json()
    if (data && data.status === 1 && data.product) { product = data.product; break }
  }
  if (!product) return { status: 'not-found' }

  const raw = (product.product_name_ru || product.product_name || product.generic_name || '').trim()
  if (!raw) return { status: 'not-found' }
  const brand = product.brands ? product.brands.split(',')[0].trim() : ''
  const name = brand && !raw.toLowerCase().includes(brand.toLowerCase()) ? `${raw} · ${brand}` : raw

  const drink = looksLikeDrink(product)
  const unit = drink ? 'мл' : 'г'
  const serving = posNum(product.serving_quantity, 3000)
  const pack = posNum(product.product_quantity, 5000)

  const n = product.nutriments || {}
  let kcal = per100(n, 'energy-kcal', serving)
  if (kcal == null) {
    const kj = per100(n, 'energy', serving)
    if (kj != null) kcal = kj / 4.184
  }
  // Название нашли — но состав в базе не заполнен. Переписывать название рукой
  // человека уже не заставим, а цифры пусть возьмёт с этикетки.
  if (kcal == null || !(kcal > 0) || kcal >= 1000) return { status: 'no-nutrition', name, drink }

  // Порции — только те, что указаны на упаковке.
  const portions = []
  if (serving) portions.push({ label: 'порция', grams: Math.round(serving) })
  if (pack && pack !== serving) portions.push({ label: 'упаковка', grams: Math.round(pack) })

  // cat намеренно не ставим — как и у продуктов из поиска по той же базе.
  // Во-первых, классификация питательности (nutritionClassification) читает
  // `food.cat || inferCategory(food)`: выдуманная категория «блюдо» перекрыла бы
  // разбор по названию, и сканированное молоко перестало бы считаться молочным.
  // Во-вторых, подсказки порций для «блюда» — тарелка на 350 г — для
  // произвольной пачки с полки бессмысленны.
  const food = {
    name,
    emoji: drink ? '🥤' : '🛒',
    unit,
    kcal: Math.round(kcal),
    // null, а не ноль: см. пояснение в searchOpenFoodFacts ниже.
    protein: offMacro(per100(n, 'proteins', serving)),
    carbs: offMacro(per100(n, 'carbohydrates', serving)),
    fat: offMacro(per100(n, 'fat', serving)),
    source: 'off',
    barcode: code,
    portions,
  }
  // Фото упаковки. База отдаёт лицевую сторону в нескольких размерах и на
  // разных языках (на русском поддомене — сразу русскую этикетку, если она
  // залита). Поля может не быть вовсе — тогда ключа photo просто нет.
  const photo = product.image_front_url || product.image_front_small_url || product.image_url || product.image_small_url
  if (photo) food.photo = photo

  const sugar = per100(n, 'sugars', serving)
  if (sugar != null) food.sugar = +(+sugar).toFixed(1)
  const satFat = per100(n, 'saturated-fat', serving)
  if (satFat != null) food.satFat = +(+satFat).toFixed(1)

  // Сколько подставить в поле количества. Порция с упаковки — лучший ответ;
  // маленькую пачку человек обычно съедает целиком; иначе просто круглое число,
  // которое всё равно правится одним касанием.
  food.defaultGrams = serving ? Math.round(serving) : pack && pack <= 500 ? Math.round(pack) : drink ? 250 : 100

  return { status: 'ok', food }
}

export async function searchOpenFoodFacts(query, signal) {
  const url =
    'https://ru.openfoodfacts.org/cgi/search.pl?search_terms=' +
    encodeURIComponent(query) +
    '&search_simple=1&action=process&json=1&page_size=25' +
    '&fields=product_name,product_name_ru,brands,nutriments'
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('off_http_' + res.status)
  const data = await res.json()
  const seen = new Set()
  return (data.products || [])
    .map((p) => {
      const n = p.nutriments || {}
      let kcal = n['energy-kcal_100g']
      if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184
      const name = p.product_name_ru || p.product_name
      if (kcal == null || !name || !name.trim()) return null
      const brand = p.brands ? p.brands.split(',')[0].trim() : ''
      const label = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${name} · ${brand}` : name
      const key = label.toLowerCase()
      if (seen.has(key)) return null
      seen.add(key)
      // База знает калорийность далеко не для всех записей полностью. Раньше
      // отсутствующий белок записывался нулём, и строка «Б0 У0 Ж0» выглядела
      // как измеренный факт: человек добавлял продукт и получал в дневнике
      // честный на вид ноль белка. Не знаем — так и говорим.
      const macro = (v) => (v == null || !Number.isFinite(+v) ? null : +(+v).toFixed(1))
      return {
        name: label,
        kcal: Math.round(kcal),
        protein: macro(n.proteins_100g),
        carbs: macro(n.carbohydrates_100g),
        fat: macro(n.fat_100g),
        emoji: '🛒',
        source: 'off',
      }
    })
    .filter((f) => f && f.kcal > 0 && f.kcal < 1000)
    .slice(0, 20)
}
