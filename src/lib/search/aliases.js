// @i18n-data-file
// ─────────────────────────────────────────────────────────────────────────────
// Многоязычные синонимы канонических продуктов: id → { язык: [названия] }.
//
// Основное название каждого продукта на каждом языке уже есть в словарях
// (src/locales/<код>/data/foods.js) и в поиске участвует само. Здесь — то, что
// люди набирают ВМЕСТО основного названия: разговорные формы, синонимы,
// региональные варианты, частые сокращения.
//
// Правила (их проверяет src/lib/search/search.test.js):
//   • ключ — существующий id каталога, а не название;
//   • синоним означает ТОТ ЖЕ продукт. «Молоко» не пишется синонимом
//     овсяного молока, «овсянка» — синонимом мюсли: питательно это разное;
//   • если слово равно подходит нескольким продуктам («porridge» — и каша
//     вообще, и овсянка), оно остаётся у того, кого им называют чаще, а
//     остальные найдутся по своему названию;
//   • опечатки сюда не пишутся: их прощает нечёткий поиск.
//
// Язык синонима нужен для ранжирования и отладки, поиск идёт по всем сразу:
// немецкий интерфейс находит «овсянку», арабский — «oat milk».
// ─────────────────────────────────────────────────────────────────────────────

export default {
  // ── Крупы и завтраки ──────────────────────────────────────────────────────
  food_oatmeal: {
    ru: ['овсяная каша', 'каша овсяная', 'геркулесовая каша'],
    en: ['porridge', 'oat porridge', 'cooked oats'],
    de: ['Haferbrei', 'Porridge', 'Haferschleim'],
    es: ['gachas de avena', 'avena cocida', 'porridge'],
    pt: ['mingau de aveia', 'aveia cozida'],
    tr: ['yulaf lapası'],
    ar: ['عصيدة الشوفان', 'شوفان مطبوخ'],
  },
  food_rolled_oats_dry: {
    ru: ['овсяные хлопья', 'геркулес', 'овёс', 'хлопья овсяные'],
    en: ['oats', 'rolled oats', 'oat flakes', 'porridge oats', 'oatmeal dry'],
    de: ['Haferflocken', 'Hafer', 'Vollkornhaferflocken'],
    es: ['avena', 'copos de avena', 'avena en hojuelas'],
    pt: ['aveia', 'flocos de aveia', 'aveia em flocos'],
    tr: ['yulaf', 'yulaf ezmesi'],
    ar: ['شوفان', 'رقائق الشوفان'],
  },
  food_buckwheat: {
    ru: ['гречневая каша', 'гречка варёная'],
    en: ['buckwheat porridge', 'kasha'],
    de: ['Buchweizenbrei'],
    es: ['trigo sarraceno cocido', 'alforfón'],
    pt: ['trigo sarraceno cozido'],
    tr: ['karabuğday lapası'],
    ar: ['حنطة سوداء مطبوخة'],
  },
  food_rice: {
    ru: ['рис отварной', 'рис варёный'],
    en: ['boiled rice', 'cooked rice', 'steamed rice'],
    de: ['gekochter Reis'],
    es: ['arroz cocido', 'arroz blanco'],
    pt: ['arroz cozido', 'arroz branco'],
    tr: ['pilav', 'haşlanmış pirinç'],
    ar: ['رز', 'أرز مسلوق', 'رز أبيض'],
  },
  food_muesli: { de: ['Müsli'], es: ['muesli'], pt: ['muesli', 'müsli'], tr: ['müsli'], ar: ['موسلي'] },
  food_corn_flakes: { en: ['cornflakes'], de: ['Cornflakes'], es: ['copos de maíz'], pt: ['flocos de milho', 'sucrilhos'], tr: ['mısır gevreği'], ar: ['كورن فليكس', 'رقائق الذرة'] },
  food_pasta_cooked: {
    ru: ['макароны', 'паста', 'вермишель', 'рожки'],
    en: ['pasta', 'macaroni', 'noodles'],
    de: ['Nudeln', 'Pasta'],
    es: ['pasta', 'macarrones', 'fideos'],
    pt: ['macarrão', 'massa'],
    tr: ['makarna'],
    ar: ['معكرونة', 'مكرونة', 'باستا'],
  },

  // ── Молочное ──────────────────────────────────────────────────────────────
  food_milk: {
    en: ['cow milk', 'dairy milk'],
    de: ['Kuhmilch', 'Vollmilch'],
    es: ['leche de vaca', 'leche entera'],
    pt: ['leite de vaca', 'leite integral'],
    tr: ['inek sütü'],
    ar: ['حليب بقر', 'حليب كامل الدسم'],
  },
  food_oat_milk: {
    ru: ['овсяное молоко'],
    en: ['oat drink', 'oatmilk'],
    de: ['Haferdrink', 'Hafermilch'],
    es: ['bebida de avena', 'leche de avena'],
    pt: ['bebida de aveia', 'leite de aveia'],
    tr: ['yulaf sütü', 'yulaf içeceği'],
    ar: ['حليب الشوفان'],
  },
  food_almond_milk: { en: ['almond drink'], de: ['Mandeldrink', 'Mandelmilch'], es: ['bebida de almendra', 'leche de almendras'], pt: ['leite de amêndoas', 'bebida de amêndoa'], tr: ['badem sütü'], ar: ['حليب اللوز'] },
  food_soy_milk: { en: ['soya milk', 'soy drink'], de: ['Sojadrink', 'Sojamilch'], es: ['bebida de soja', 'leche de soja'], pt: ['leite de soja', 'bebida de soja'], tr: ['soya sütü'], ar: ['حليب الصويا'] },
  food_coconut_milk: { de: ['Kokosmilch'], es: ['leche de coco'], pt: ['leite de coco'], tr: ['hindistan cevizi sütü'], ar: ['حليب جوز الهند'] },
  food_cottage_cheese: {
    ru: ['творожок', 'творог зернёный'],
    en: ['quark', 'curd cheese', 'farmer cheese'],
    de: ['Quark', 'Magerquark', 'Hüttenkäse'],
    es: ['requesón', 'queso cottage', 'quark'],
    pt: ['queijo cottage', 'requeijão fresco', 'quark'],
    tr: ['lor peyniri', 'süzme peynir'],
    ar: ['جبن قريش', 'جبنة قريش', 'كوتج'],
  },
  food_kefir: { de: ['Kefir'], es: ['kéfir'], pt: ['kefir', 'quefir'], tr: ['kefir'], ar: ['كفير'] },
  food_sour_cream: { de: ['saure Sahne', 'Schmand'], es: ['crema agria', 'nata agria'], pt: ['creme azedo', 'nata azeda'], tr: ['ekşi krema'], ar: ['قشطة حامضة'] },
  food_yogurt: { en: ['yoghurt', 'plain yogurt'], de: ['Joghurt', 'Naturjoghurt'], es: ['yogur natural'], pt: ['iogurte natural'], tr: ['yoğurt', 'sade yoğurt'], ar: ['زبادي', 'لبن زبادي', 'روب'] },
  food_greek_yogurt: { en: ['greek yoghurt'], de: ['griechischer Joghurt'], es: ['yogur griego'], pt: ['iogurte grego'], tr: ['süzme yoğurt'], ar: ['زبادي يوناني'] },
  food_butter: { ru: ['масло сливочное'], de: ['Butter'], es: ['mantequilla'], pt: ['manteiga'], tr: ['tereyağı'], ar: ['زبدة'] },
  food_feta: { ru: ['брынза фета'], de: ['Feta', 'Schafskäse'], es: ['queso feta'], pt: ['queijo feta'], tr: ['beyaz peynir', 'feta peyniri'], ar: ['جبنة فيتا', 'جبنة بيضاء'] },
  food_mozzarella: { de: ['Mozzarella'], es: ['mozzarella'], pt: ['muçarela', 'mussarela'], tr: ['mozarella'], ar: ['موزاريلا'] },

  // ── Мясо, птица, рыба, яйца ───────────────────────────────────────────────
  food_chicken_breast: {
    ru: ['куриное филе', 'грудка куриная', 'филе курицы'],
    en: ['chicken fillet', 'chicken breast fillet'],
    de: ['Hähnchenbrust', 'Hühnerbrust', 'Hähnchenbrustfilet', 'Hühnchenbrust'],
    es: ['pechuga de pollo', 'filete de pollo'],
    pt: ['peito de frango', 'filé de frango'],
    tr: ['tavuk göğsü', 'tavuk fileto'],
    ar: ['صدر دجاج', 'فيليه دجاج'],
  },
  food_egg: {
    ru: ['яйца', 'куриное яйцо'],
    en: ['eggs', 'chicken egg'],
    de: ['Ei', 'Eier', 'Hühnerei'],
    es: ['huevo', 'huevos'],
    pt: ['ovo', 'ovos'],
    tr: ['yumurta'],
    ar: ['بيض', 'بيضة'],
  },
  food_beef: { en: ['beef steak'], de: ['Rindfleisch', 'Rind'], es: ['ternera', 'carne de res', 'res'], pt: ['carne bovina', 'carne de vaca'], tr: ['dana eti', 'sığır eti'], ar: ['لحم بقري', 'لحم عجل'] },
  food_pork: { de: ['Schweinefleisch'], es: ['cerdo', 'carne de cerdo'], pt: ['carne de porco', 'porco'], tr: ['domuz eti'], ar: ['لحم خنزير'] },
  food_ground_beef: { ru: ['говяжий фарш'], en: ['minced beef', 'beef mince'], de: ['Rinderhack', 'Hackfleisch Rind'], es: ['carne picada de ternera'], pt: ['carne moída'], tr: ['dana kıyma', 'kıyma'], ar: ['لحم مفروم'] },
  food_turkey_breast: { ru: ['филе индейки', 'грудка индейки'], de: ['Putenbrust'], es: ['pechuga de pavo'], pt: ['peito de peru'], tr: ['hindi göğsü'], ar: ['صدر ديك رومي'] },
  food_salmon: { ru: ['сёмга', 'семга', 'красная рыба'], de: ['Lachs'], es: ['salmón'], pt: ['salmão'], tr: ['somon'], ar: ['سلمون', 'سمك السلمون'] },
  food_tuna_fresh: { de: ['Thunfisch'], es: ['atún'], pt: ['atum'], tr: ['ton balığı'], ar: ['تونة', 'تونا'] },
  food_shrimp: { ru: ['креветка'], en: ['prawns', 'prawn'], de: ['Garnelen', 'Shrimps', 'Krabben'], es: ['gambas', 'camarones'], pt: ['camarão', 'camarões'], tr: ['karides'], ar: ['جمبري', 'روبيان', 'قريدس'] },
  food_bacon: { de: ['Speck'], es: ['beicon', 'tocino', 'panceta'], pt: ['bacon', 'toucinho'], tr: ['domuz pastırması'], ar: ['لحم مقدد'] },
  food_ham: { de: ['Schinken', 'Kochschinken'], es: ['jamón cocido', 'jamón york'], pt: ['presunto'], tr: ['jambon'] },

  // ── Овощи, фрукты ─────────────────────────────────────────────────────────
  food_potato: { ru: ['картошка', 'картофан'], en: ['potatoes'], de: ['Kartoffel', 'Kartoffeln', 'Erdäpfel'], es: ['patata', 'papa', 'patatas'], pt: ['batata', 'batatas'], tr: ['patates'], ar: ['بطاطس', 'بطاطا'] },
  food_tomato: { ru: ['помидоры', 'томат'], en: ['tomatoes'], de: ['Tomate', 'Tomaten', 'Paradeiser'], es: ['tomate', 'tomates'], pt: ['tomate'], tr: ['domates'], ar: ['طماطم', 'بندورة'] },
  food_cucumber: { ru: ['огурцы', 'огурчик'], en: ['cucumbers'], de: ['Gurke', 'Gurken', 'Salatgurke'], es: ['pepino'], pt: ['pepino'], tr: ['salatalık', 'hıyar'], ar: ['خيار'] },
  food_carrot: { ru: ['морковка'], en: ['carrots'], de: ['Karotte', 'Möhre', 'Mohrrübe'], es: ['zanahoria'], pt: ['cenoura'], tr: ['havuç'], ar: ['جزر'] },
  food_onion: { ru: ['лук', 'луковица'], en: ['onions'], de: ['Zwiebel', 'Zwiebeln'], es: ['cebolla'], pt: ['cebola'], tr: ['soğan'], ar: ['بصل'] },
  food_broccoli: { de: ['Brokkoli'], es: ['brócoli'], pt: ['brócolis', 'brócolos'], tr: ['brokoli'], ar: ['بروكلي', 'بروكولي'] },
  food_avocado: { de: ['Avocado'], es: ['aguacate', 'palta'], pt: ['abacate'], tr: ['avokado'], ar: ['أفوكادو'] },
  food_banana: { ru: ['бананы'], en: ['bananas'], de: ['Banane', 'Bananen'], es: ['plátano', 'banana'], pt: ['banana'], tr: ['muz'], ar: ['موز'] },
  food_apple: { ru: ['яблоки'], en: ['apples'], de: ['Apfel', 'Äpfel'], es: ['manzana'], pt: ['maçã'], tr: ['elma'], ar: ['تفاح', 'تفاحة'] },
  food_orange: { ru: ['апельсины'], en: ['oranges'], de: ['Orange', 'Apfelsine'], es: ['naranja'], pt: ['laranja'], tr: ['portakal'], ar: ['برتقال', 'برتقالة'] },
  food_strawberries: { ru: ['клубничка', 'виктория'], en: ['strawberry'], de: ['Erdbeeren', 'Erdbeere'], es: ['fresas', 'fresa', 'frutillas'], pt: ['morango', 'morangos'], tr: ['çilek'], ar: ['فراولة', 'فريز'] },
  food_grapes: { de: ['Trauben', 'Weintrauben'], es: ['uvas', 'uva'], pt: ['uva', 'uvas'], tr: ['üzüm'], ar: ['عنب'] },
  food_watermelon: { de: ['Wassermelone'], es: ['sandía'], pt: ['melancia'], tr: ['karpuz'], ar: ['بطيخ', 'بطيخ أحمر'] },

  // ── Хлеб, сладкое, жиры ───────────────────────────────────────────────────
  food_white_bread: { ru: ['батон', 'хлеб пшеничный'], en: ['wheat bread'], de: ['Weißbrot', 'Weizenbrot'], es: ['pan blanco', 'pan de trigo'], pt: ['pão branco', 'pão de trigo'], tr: ['beyaz ekmek', 'ekmek'], ar: ['خبز أبيض', 'خبز'] },
  food_rye_bread: { ru: ['чёрный хлеб'], en: ['black bread'], de: ['Roggenbrot', 'Schwarzbrot'], es: ['pan de centeno'], pt: ['pão de centeio'], tr: ['çavdar ekmeği'], ar: ['خبز الجاودار'] },
  food_honey: { de: ['Honig'], es: ['miel'], pt: ['mel'], tr: ['bal'], ar: ['عسل'] },
  food_sugar: { de: ['Zucker'], es: ['azúcar'], pt: ['açúcar'], tr: ['şeker'], ar: ['سكر'] },
  food_olive_oil: { de: ['Olivenöl'], es: ['aceite de oliva'], pt: ['azeite', 'azeite de oliva'], tr: ['zeytinyağı'], ar: ['زيت زيتون', 'زيت الزيتون'] },
  food_peanut_butter: { ru: ['арахисовое масло'], de: ['Erdnussbutter', 'Erdnussmus'], es: ['crema de cacahuete', 'mantequilla de maní'], pt: ['pasta de amendoim', 'manteiga de amendoim'], tr: ['fıstık ezmesi'], ar: ['زبدة الفول السوداني'] },
  food_almonds: { de: ['Mandeln'], es: ['almendras'], pt: ['amêndoas', 'amêndoa'], tr: ['badem'], ar: ['لوز'] },
  food_dark_chocolate: { ru: ['чёрный шоколад'], de: ['Zartbitterschokolade', 'dunkle Schokolade'], es: ['chocolate negro'], pt: ['chocolate amargo', 'chocolate meio amargo'], tr: ['bitter çikolata'], ar: ['شوكولاتة داكنة'] },

  // ── Напитки ───────────────────────────────────────────────────────────────
  food_water: { de: ['Wasser', 'Leitungswasser'], es: ['agua'], pt: ['água'], tr: ['su'], ar: ['ماء', 'مياه'] },
  food_black_coffee: { ru: ['кофе', 'кофе без сахара'], en: ['coffee', 'filter coffee'], de: ['Kaffee', 'schwarzer Kaffee'], es: ['café', 'café solo'], pt: ['café', 'café preto'], tr: ['kahve', 'sade kahve'], ar: ['قهوة', 'قهوة سوداء'] },
  food_tea_unsweetened: { ru: ['чай'], en: ['tea', 'black tea'], de: ['Tee', 'schwarzer Tee'], es: ['té'], pt: ['chá'], tr: ['çay'], ar: ['شاي'] },
  food_orange_juice: { ru: ['апельсиновый сок'], de: ['Orangensaft', 'O-Saft'], es: ['zumo de naranja', 'jugo de naranja'], pt: ['suco de laranja'], tr: ['portakal suyu'], ar: ['عصير برتقال'] },
  food_beer: { ru: ['пивко'], de: ['Bier'], es: ['cerveza'], pt: ['cerveja'], tr: ['bira'], ar: ['بيرة'] },
  food_energy_drink: { de: ['Energydrink', 'Energy-Drink'], es: ['bebida energética'], pt: ['energético', 'bebida energética'], tr: ['enerji içeceği'], ar: ['مشروب طاقة'] },
  food_protein_shake: { ru: ['протеин', 'белковый коктейль'], en: ['protein drink', 'whey shake'], de: ['Proteinshake', 'Eiweißshake'], es: ['batido de proteínas'], pt: ['shake de proteína', 'shake proteico'], tr: ['protein shake', 'protein içeceği'], ar: ['مخفوق البروتين', 'بروتين شيك'] },

  // ── Блюда ─────────────────────────────────────────────────────────────────
  food_borscht: { ru: ['борщик'], en: ['borsch', 'beet soup'], de: ['Borschtsch', 'Rote-Bete-Suppe'], es: ['borsch', 'sopa de remolacha'], pt: ['borsch', 'sopa de beterraba'], tr: ['pancar çorbası', 'borş'], ar: ['بورش', 'حساء الشمندر'] },
  food_syrniki_quark_pancakes: { ru: ['сырник', 'творожники'], en: ['syrniki', 'cottage cheese pancakes'], de: ['Quarkpfannkuchen', 'Quarkkeulchen'], es: ['tortitas de requesón'], pt: ['panquecas de ricota'], tr: ['lor pankeki'], ar: ['فطائر الجبن'] },
  food_pancakes: { ru: ['панкейк', 'оладушки'], de: ['Pancakes', 'Pfannkuchen'], es: ['tortitas', 'panqueques', 'hotcakes'], pt: ['panquecas', 'panqueca'], tr: ['pankek'], ar: ['بان كيك', 'فطائر'] },
  food_pepperoni_pizza: { ru: ['пицца с пепперони'], de: ['Salamipizza'], es: ['pizza de pepperoni'], pt: ['pizza de pepperoni', 'pizza calabresa'], tr: ['pepperoni pizza', 'sucuklu pizza'], ar: ['بيتزا بيبروني'] },
}
