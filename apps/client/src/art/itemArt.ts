import { artHas, artUrl } from './artSource.ts';

const w = (...stems: string[]) => new RegExp(`(?:^|[^a-zа-я0-9])(?:${stems.join('|')})`);

type Rule = { art: string | null; all: RegExp[] };
const rule = (art: string | null, ...all: RegExp[]): Rule => ({ art, all });

const ICE = w('ледян', 'морозн', 'льда', 'ice', 'frost');
const FIRE = w('огнен', 'пылающ', 'пламен', 'лавов', 'flame', 'fire');
const LIGHTNING = w('молни', 'гром', 'lightning', 'thunder', 'storm');
const DEATH = w('смерт', 'некро', 'death', 'necro');
const DARK = w('черн', 'темн', 'тене', 'shadow', 'dark', 'black');
const GOLD = w('золот', 'gold');
const POISON = w('ядовит', 'отравлен', 'poison');

const POTION = w('зель', 'potion', 'эликсир', 'elixir', 'снадоб', 'настойк');
const SWORD = w('меч', 'sword', 'клинок', 'blade');
const DAGGER = w('кинжал', 'dagger');
const ARROW = w('стрел', 'arrow');
const STAFF = w('посох', 'staff');
const WAND = w('палочк', 'wand', 'жезл', 'rod(?![a-z])');
const BOW = w('лук(?![а-я])', 'bow(?![a-z])');
const CROSSBOW = w('арбалет(?!н)', 'crossbow');
const KEY = w('ключ', 'key(?![a-z])');
const COIN = w('монет', 'coin');
const BARREL = w('бочк', 'бочон', 'barrel', 'keg');

const RULES: Rule[] = [
  rule('items/potions/red-heart', POTION, /высш\S* лечени|supreme healing/),
  rule('items/potions/red-jug', POTION, /превосходн\S* лечени|superior healing/),
  rule('items/potions/red-round-large', POTION, /больш\S* лечени|greater healing/),
  rule('items/potions/red-round', POTION, /лечени|healing/),
  rule('items/potions/blue-drop', w('противояд', 'antitoxin', 'antidote')),
  rule('items/potions/light-blue', /свят\S* вод|holy water/),
  rule('items/potions/poison-skull', w('яд(?![а-я])', 'яда', 'poison')),
  rule('items/potions/crystal-vial', POTION, w('невидим', 'invisib')),
  rule('items/potions/lightning-flask', POTION, LIGHTNING),
  rule('items/potions/orange', POTION, FIRE),
  rule('items/potions/blue-round', POTION),
  rule('items/potions/green-tube', w('кислот', 'acid')),
  rule('items/potions/orange', /алхимическ\S* огон|alchemist/),
  rule('items/potions/black-ink', w('чернил', 'ink(?![a-z])')),
  rule('scene/containers/barrel-flammable', BARREL, w('масл', 'порох', 'oil', 'powder')),
  rule('scene/containers/barrel', BARREL),
  rule('items/potions/golden-oil', w('масл', 'oil(?![a-z])')),

  rule('items/ammo/arrows/crossbow-bolt', w('болт', 'bolt')),
  rule('scene/nature/rocks/pebbles', /снаряд\S* для пращ|sling bullet/),
  rule('items/ammo/quivers/quiver-leather', w('колчан', 'quiver', 'стрелы', 'arrows')),
  rule('items/ammo/arrows/arrow-fire', ARROW, FIRE),
  rule('items/ammo/arrows/arrow-ice', ARROW, ICE),
  rule('items/ammo/arrows/arrow-poison', ARROW, POISON),
  rule('items/ammo/arrows/arrow-lightning', ARROW, LIGHTNING),
  rule('items/ammo/arrows/arrow-silver', ARROW, w('серебр', 'silver')),
  rule('items/ammo/arrows/arrow', ARROW),

  rule('items/weapons/thrown/throwing-knives', /метательн\S* нож|throwing knife/),
  rule('items/weapons/thrown/shuriken', w('сюрикен', 'shuriken')),
  rule('items/weapons/thrown/kunai', w('кунай', 'kunai')),
  rule('items/weapons/daggers/dagger-ice', DAGGER, ICE),
  rule('items/weapons/daggers/dagger-poisoned', DAGGER, POISON),
  rule('items/weapons/daggers/dagger-bone', DAGGER, w('костян', 'bone')),
  rule('items/weapons/daggers/dagger-gold', DAGGER, GOLD),
  rule('items/weapons/daggers/dagger-obsidian', DAGGER, w('обсидиан', 'obsidian')),
  rule('items/weapons/daggers/dagger-obsidian', DAGGER, DARK),
  rule('items/weapons/daggers/dagger-blood', DAGGER, w('кровав', 'кровопийц', 'blood')),
  rule('items/weapons/daggers/kris', w('крис(?![а-я])', 'kris(?![a-z])')),
  rule('items/weapons/daggers/dagger', DAGGER),
  rule('items/weapons/daggers/knife', w('нож(?!н|ниц)', 'knife')),

  rule('items/weapons/swords/sword-ice', SWORD, ICE),
  rule('items/weapons/swords/sword-lava', SWORD, FIRE),
  rule('items/weapons/swords/sword-crystal', SWORD, w('хрустал', 'crystal')),
  rule('items/weapons/swords/sword-runic', SWORD, w('рун', 'rune')),
  rule('items/weapons/swords/sword-black', SWORD, DARK),
  rule('items/weapons/swords/sword-gold-guard', SWORD, GOLD),
  rule('items/weapons/swords/sword-rusty', SWORD, w('ржав', 'rust')),
  rule('items/weapons/swords/sword-wooden', SWORD, w('деревян', 'учебн', 'тренировочн', 'wood')),
  rule('items/weapons/swords/sword-broken', SWORD, w('сломан', 'broken')),
  rule('items/weapons/swords/greatsword', /двуручн\S* меч|great ?sword/),
  rule('items/weapons/swords/shortsword', /коротк\S* меч|short ?sword/),
  rule('items/weapons/swords/longsword', /длинн\S* меч|long ?sword/),
  rule('items/weapons/swords/rapier', w('рапир', 'rapier')),
  rule('items/weapons/swords/scimitar', w('скимитар', 'ятаган', 'scimitar')),
  rule('items/weapons/swords/cutlass', w('сабл', 'cutlass', 'saber', 'sabre')),
  rule('items/weapons/swords/katana', w('катан', 'katana')),
  rule('items/weapons/swords/epee', w('шпаг', 'epee')),
  rule('items/weapons/swords/falchion', w('фальшион', 'falchion')),
  rule('items/weapons/swords/flamberge', w('фламберг', 'flamberge')),
  rule('items/weapons/swords/estoc', w('эсток', 'estoc')),
  rule('items/weapons/swords/sword-steel', SWORD),

  rule('items/weapons/polearms/halberd', w('алебард', 'halberd')),
  rule('items/weapons/polearms/glaive', w('глеф', 'glaive')),
  rule('items/weapons/polearms/trident', w('трезуб', 'trident')),
  rule('items/weapons/polearms/pike', /кавалерийск\S* копь|lance/),
  rule('items/weapons/polearms/pike', w('пика', 'пики', 'пику', 'пикой', 'pike')),
  rule('items/weapons/polearms/javelin', /метательн\S* копь|javelin/),
  rule('items/weapons/polearms/spear', w('копь', 'spear')),
  rule('items/weapons/polearms/pitchfork', w('вилы', 'pitchfork')),
  rule('items/weapons/scythes/scythe', w('коса(?![а-я])', 'косу(?![а-я])', 'scythe')),
  rule('items/weapons/scythes/sickle', w('серп', 'sickle')),
  rule('items/weapons/axes/bardiche', w('бердыш', 'bardiche')),
  rule('items/weapons/axes/greataxe', w('секир', 'great ?axe')),
  rule('items/weapons/axes/battleaxe', /боев\S* топор|battle ?axe/),
  rule('items/weapons/axes/handaxe', /ручн\S* топор|hand ?axe/),
  rule('items/weapons/axes/handaxe', w('топор', 'axe(?![a-z])')),

  rule('items/weapons/clubs/greatclub', w('палиц', 'great ?club')),
  rule('items/weapons/clubs/club', w('дубин', 'club(?![a-z])')),
  rule('items/weapons/clubs/mace', w('булав', 'mace(?![a-z])')),
  rule('items/weapons/clubs/morningstar', w('моргенштерн', 'morning ?star')),
  rule('items/weapons/clubs/flail', w('цеп(?![ьияеюй])', 'flail')),
  rule('items/weapons/clubs/light-hammer', /легк\S* молот(?!ок|к)|light hammer/),
  rule('items/weapons/clubs/warhammer', /боев\S* молот(?!ок|к)|war ?hammer/),
  rule('items/weapons/clubs/maul', w('молот(?!ок|к)', 'кувалд', 'maul')),
  rule('items/weapons/misc/whip', w('кнут', 'плеть', 'плетью', 'whip')),
  rule('items/weapons/misc/sling', w('пращ', 'sling')),
  rule('items/weapons/misc/net', w('сеть', 'сети(?![а-я])', 'net(?![a-z])')),
  rule('items/weapons/misc/blowgun', /духов\S* трубк|blowgun/),
  rule('items/weapons/misc/unarmed-strike', w('безоруж', 'unarmed')),

  rule('items/magic/worn/armor-plus-1', /(?:доспех|брон[яеюи]|латы)\S* \+\d|armou?r,? \+\d/),
  rule('items/armor/padded-armor', w('стеган', 'padded')),
  rule('items/armor/studded-leather-armor', w('проклепан', 'studded')),
  rule('items/armor/leather-armor', /кожан\S* (?:доспех|брон)|leather armou?r/),
  rule('items/armor/hide-armor', w('шкурн', 'hide armou?r')),
  rule('items/armor/chain-shirt', /кольчужн\S* рубах|chain shirt/),
  rule('items/armor/scale-mail', w('чешуйчат', 'scale mail', 'scale armou?r')),
  rule('items/armor/breastplate', w('кирас', 'breastplate')),
  rule('items/armor/half-plate', w('полулат', 'half[- ]?plate')),
  rule('items/armor/ring-mail', /колечн\S* доспех|ring mail/),
  rule('items/armor/chain-mail', w('кольчуг', 'chain ?mail')),
  rule('items/armor/splint-armor', /наборн\S* доспех|splint/),
  rule('items/armor/plate-armor', w('латы', 'латах', 'латн', 'plate(?: armou?r)?(?![a-z])')),
  rule('items/armor/shield', w('щит', 'shield')),
  rule('items/armor/chain-mail', w('доспех', 'брон[яеюи](?![а-я])', 'armou?r(?![a-z])')),

  rule('items/magic/worn/ring-of-protection', /кольц\S* защит|ring of protection/),
  rule('items/magic/worn/ring-of-resistance', w('кольц', 'перстен', 'ring(?![a-z])')),
  rule('items/magic/worn/cloak-of-protection', w('плащ', 'накидк', 'cloak', 'cape(?![a-z])', 'mantle')),
  rule('items/magic/worn/bracers-of-defense', w('наруч(?!ник)', 'bracer')),
  rule('items/magic/worn/headband-of-intellect', w('обруч', 'диадем', 'тиар', 'headband', 'circlet', 'tiara')),
  rule('items/magic/worn/amulet-of-health', w('амулет', 'медальон', 'кулон', 'ожерель', 'amulet', 'pendant', 'necklace')),
  rule('items/magic/worn/boots-of-striding-and-springing', w('сапог', 'сапоги', 'ботин', 'boots')),

  rule('items/magic/arcane/caduceus', /посох\S* лечени|staff of healing/),
  rule('items/weapons/staves/quarterstaff', /боев\S* посох|quarterstaff/),
  rule('items/magic/fire/fireball-staff', STAFF, FIRE),
  rule('items/magic/cold/snowflake-staff', STAFF, ICE),
  rule('items/magic/storm/lightning-bolt', STAFF, LIGHTNING),
  rule('items/magic/death/skull-staff', STAFF, DEATH),
  rule('items/weapons/staves/quarterstaff', STAFF),
  rule('items/magic/wands/birch-wand', WAND, w('паутин', 'web')),
  rule('items/magic/wands/red-wand', WAND, /волшебн\S* стрел|magic missile/),
  rule('items/magic/fire/burning-branch', WAND, FIRE),
  rule('items/magic/scepters/ice-crystal-wand', WAND, ICE),
  rule('items/magic/storm/spark-wand', WAND, LIGHTNING),
  rule('items/magic/wands/wooden-wand', WAND),
  rule('items/magic/scepters/royal-scepter', w('скипетр', 'scepter', 'sceptre')),

  rule('items/weapons/crossbows/crossbow-hand', /ручн\S* арбалет|hand crossbow|crossbow, hand/),
  rule('items/weapons/crossbows/crossbow-heavy', /тяжел\S* арбалет|heavy crossbow|crossbow, heavy/),
  rule('items/weapons/crossbows/crossbow-light', CROSSBOW),
  rule('items/weapons/bows/bow-leaf', BOW, w('эльф', 'elven')),
  rule('items/weapons/bows/bow-ice', BOW, ICE),
  rule('items/weapons/bows/shortbow', /коротк\S* лук|short ?bow/),
  rule('items/weapons/bows/longbow', /длинн\S* лук|long ?bow/),
  rule('items/weapons/bows/longbow', BOW),
  rule('items/weapons/thrown/dart', w('дротик', 'dart')),
  rule('items/weapons/firearms/pistol-flintlock', w('пистол', 'мушкет', 'pistol', 'musket')),
  rule('items/gear/pickaxe', w('кирк', 'pick(?![a-z])', 'pickaxe')),

  rule('items/magic/arcane/crystal-wand', w('кристалл', 'crystal')),
  rule('items/magic/arcane/crystal-wand', /магическ\S* фокус|arcane focus/),
  rule('items/magic/wands/green-sprig', w('омел', 'sprig', 'друидическ', 'druidic')),
  rule('items/magic/light/sun-staff', /священн\S* символ|holy symbol/),
  rule('items/gear/belt-pouch', /мешоч\S* с компонент|component pouch/),

  rule('items/valuables/coin-gold', COIN, GOLD),
  rule('items/valuables/coin-silver', COIN, w('серебр', 'silver')),
  rule('items/valuables/coin-platinum', COIN, w('платин', 'platinum')),
  rule('items/valuables/coin-electrum', COIN, w('электр', 'electrum')),
  rule('items/valuables/coin-copper', COIN, w('медн', 'copper')),
  rule('items/valuables/coin-copper', w('медяк')),
  rule('items/valuables/coin-stacks', COIN),
  rule('items/valuables/coin-stacks', w('кошел', 'кошель', 'purse')),
  rule('items/valuables/coin-stacks', /мешоч\S* (с )?(золот|серебр|монет|денег)/),
  rule('items/valuables/pearl', w('жемчуг', 'жемчуж', 'pearl')),
  rule('items/valuables/ruby', w('рубин', 'ruby')),
  rule('items/valuables/sapphire', w('сапфир', 'sapphire')),
  rule('items/valuables/emerald', w('изумруд', 'emerald')),
  rule('items/valuables/diamond', w('алмаз', 'бриллиант', 'diamond')),
  rule('items/valuables/diamond', w('самоцвет', 'драгоцен', 'gem(?![a-z])', 'gems')),
  rule('items/valuables/gold-ingot', w('слит', 'ingot')),

  rule('items/documents/map', w('карта', 'карты', 'карту', 'map(?![a-z])')),
  rule('items/documents/scroll', w('свит', 'scroll')),
  rule('items/documents/letter-sealed', w('письм', 'послани', 'letter')),
  rule('ui/symbols/paper-note', w('записк', 'note(?![a-z])')),
  rule('items/documents/tome-gem', w('книг', 'фолиант', 'гримуар', 'tome', 'book', 'spellbook')),
  rule('items/documents/scroll', w('бумаг', 'пергамент', 'paper', 'parchment')),
  rule('items/gear/compass', w('компас', 'compass')),
  rule('items/keys/key-skull', KEY, w('череп', 'skull')),
  rule('items/keys/key-gold', KEY, GOLD),
  rule('items/keys/key-rusty', KEY, w('ржав', 'желез', 'rust', 'iron')),
  rule('items/keys/key-silver', KEY),
  rule('items/gear/torch', w('факел', 'torch')),
  rule('items/magic/arcane/hand-mirror', w('зеркал', 'mirror')),
  rule('ui/symbols/locked-slot', w('замок(?![а-я])', 'padlock', 'lock(?![a-z])')),
  rule('items/gear/case-leather', w('футляр', 'тубус', 'case(?![a-z])')),
  rule('items/gear/belt-pouch', w('подсум', 'поясн\\S* сумк', 'pouch')),
  rule('items/gear/feathers', w('перо(?![а-я])', 'перья', 'feather', 'quill')),
  rule('items/gear/bowstring-coil', w('тетив', 'bowstring')),
  rule('scene/containers/cauldron', w('котел', 'котелок', 'cauldron')),
  rule('items/magic/death/bone', w('кость', 'кости(?![а-я])', 'bone(?![a-z])')),
  rule('items/gear/ball-bearings', w('шарик', 'ball bearing')),

  rule('items/gear/backpack', w('рюкзак', 'ранец', 'котомк', 'backpack')),
  rule('items/gear/bedroll', w('спальн', 'bedroll')),
  rule('items/gear/blanket', w('одеял', 'плед', 'blanket')),
  rule('items/gear/tent', w('палатк', 'шатер', 'tent(?![a-z])')),
  rule('items/gear/candle', w('свеч', 'candle')),
  rule('items/gear/lantern-bullseye', /направленн\S* фонар|bullseye/),
  rule('items/gear/lantern-hooded', w('фонар', 'lantern')),
  rule('items/gear/lamp', w('ламп', 'lamp(?![a-z])')),
  rule('items/gear/tinderbox', w('трутниц', 'огнив', 'tinderbox')),
  rule('items/gear/waterskin', w('бурдюк', 'waterskin')),
  rule('items/gear/rope-silk', /шелков\S* верев|silk(?:en)? rope|rope,? silk/),
  rule('items/gear/rope-hempen', w('верев', 'канат', 'rope(?![a-z])')),
  rule('items/gear/chain', w('цеп[ьи]', 'chain(?! ?mail| shirt)')),
  rule('items/gear/manacles', w('кандал', 'наручник', 'оков', 'manacle', 'shackle')),
  rule('items/gear/crowbar', w('ломик', 'лом(?![а-я])', 'фомк', 'crowbar')),
  rule('items/gear/hammer', w('молот(?:ок|к)', 'hammer(?![a-z])')),
  rule('items/gear/piton', w('шлямбур', 'piton')),
  rule('items/gear/shovel', w('лопат', 'shovel', 'spade')),
  rule('items/gear/hunting-trap', w('капкан', 'hunting trap', 'bear trap')),
  rule('items/gear/grappling-hook', w('кошк', 'абордажн', 'grappling')),
  rule('items/gear/caltrops', w('колтроп', 'чеснок', 'caltrop')),
  rule('items/tools/thieves-tools', /воровск\S* инструмент|отмычк|thieves'? tools/),
  rule('items/tools/climbers-kit', /скалолаз|climber/),
  rule('items/tools/herbalism-kit', /травни|herbalism/),
  rule('items/tools/disguise-kit', /грим(?!уар)|disguise/),
  rule('items/tools/healers-kit', /набор\S* целител|healer/),
  rule('items/clothing/clothes-fine', /богат\S* одежд|благородн\S* одежд|fine clothes|clothes,? fine/),
  rule('items/clothing/clothes-travelers', /дорожн\S* одежд|travell?er/),
  rule('items/clothing/clothes-common', w('одежд', 'рубах', 'clothes', 'clothing')),

  rule('items/food/bread', w('рацион', 'паек', 'пайк', 'ration')),
  rule('items/food/bread', w('хлеб', 'bread', 'лепешк')),
  rule('items/food/apple', w('яблок', 'apple')),
  rule('items/food/cheese', w('сыр(?:$|[^а-я]|а|ом|у)', 'cheese')),
  rule('items/food/fish', w('рыб', 'fish')),
  rule('items/food/drumstick', w('куриц', 'курин', 'chicken')),
  rule('items/food/steak', w('мяс', 'окорок', 'бекон', 'steak', 'meat', 'bacon')),
  rule('items/food/pie', w('пирог', 'пирож', 'pie(?![a-z])')),
  rule('items/food/grapes', w('виноград', 'grape')),
  rule('items/food/carrot', w('морков', 'carrot')),
  rule('items/food/stew', w('похлеб', 'суп(?![а-я])', 'рагу', 'stew', 'soup')),

  rule('scene/containers/chests/mimic-closed', w('мимик', 'mimic')),
  rule('scene/containers/chests/chest-wooden-closed', w('сундук', 'ларец', 'шкатулк', 'chest(?![a-z])')),
  rule('scene/containers/crate', w('ящик', 'crate')),
  rule('scene/containers/vase-porcelain', w('ваз[аыу]', 'vase')),
  rule('scene/containers/amphora', w('амфор', 'amphora')),
  rule('scene/containers/pot-round', w('горш', 'кувшин', 'jar(?![a-z])')),
];

const SRD_INDEX: Record<string, string> = {
  dagger: 'items/weapons/daggers/dagger', javelin: 'items/weapons/polearms/javelin', quarterstaff: 'items/weapons/staves/quarterstaff',
  sickle: 'items/weapons/scythes/sickle', spear: 'items/weapons/polearms/spear', 'crossbow-light': 'items/weapons/crossbows/crossbow-light',
  dart: 'items/weapons/thrown/dart', shortbow: 'items/weapons/bows/shortbow', glaive: 'items/weapons/polearms/glaive',
  greataxe: 'items/weapons/axes/greataxe', greatsword: 'items/weapons/swords/greatsword', halberd: 'items/weapons/polearms/halberd',
  lance: 'items/weapons/polearms/pike', longsword: 'items/weapons/swords/longsword', pike: 'items/weapons/polearms/pike',
  rapier: 'items/weapons/swords/rapier', scimitar: 'items/weapons/swords/scimitar', shortsword: 'items/weapons/swords/shortsword',
  trident: 'items/weapons/polearms/trident', 'war-pick': 'items/gear/pickaxe', 'crossbow-hand': 'items/weapons/crossbows/crossbow-hand',
  'crossbow-heavy': 'items/weapons/crossbows/crossbow-heavy', longbow: 'items/weapons/bows/longbow',
  'staff-of-healing': 'items/magic/arcane/caduceus',
  'wand-of-magic-missiles': 'items/magic/wands/red-wand',
  'wand-of-web': 'items/magic/wands/birch-wand',
  'gauntlets-of-ogre-power': 'ui/cursors/gauntlet-silver',
  club: 'items/weapons/clubs/club', greatclub: 'items/weapons/clubs/greatclub', mace: 'items/weapons/clubs/mace',
  morningstar: 'items/weapons/clubs/morningstar', flail: 'items/weapons/clubs/flail', 'light-hammer': 'items/weapons/clubs/light-hammer',
  maul: 'items/weapons/clubs/maul', warhammer: 'items/weapons/clubs/warhammer', handaxe: 'items/weapons/axes/handaxe',
  battleaxe: 'items/weapons/axes/battleaxe', whip: 'items/weapons/misc/whip', sling: 'items/weapons/misc/sling',
  net: 'items/weapons/misc/net', blowgun: 'items/weapons/misc/blowgun',
  'ring-of-protection': 'items/magic/worn/ring-of-protection', 'ring-of-resistance': 'items/magic/worn/ring-of-resistance',
  'cloak-of-protection': 'items/magic/worn/cloak-of-protection', 'bracers-of-defense': 'items/magic/worn/bracers-of-defense',
  'headband-of-intellect': 'items/magic/worn/headband-of-intellect', 'amulet-of-health': 'items/magic/worn/amulet-of-health',
  'armor-plus-1': 'items/magic/worn/armor-plus-1', 'boots-of-striding-and-springing': 'items/magic/worn/boots-of-striding-and-springing',
};

const COINS: Record<string, string> = {
  pp: 'items/valuables/coin-platinum', gp: 'items/valuables/coin-gold', ep: 'items/valuables/coin-electrum',
  sp: 'items/valuables/coin-silver', cp: 'items/valuables/coin-copper',
};

const SCHOOLS: Record<string, string> = {
  Abjuration: 'items/magic/light/ring-staff',
  Conjuration: 'items/magic/shadow/portal-vortex',
  Divination: 'items/magic/shadow/purple-eye',
  Enchantment: 'items/magic/scepters/spiral-staff',
  Evocation: 'items/magic/storm/spark-wand',
  Illusion: 'items/magic/arcane/hand-mirror',
  Necromancy: 'items/magic/death/skull-staff',
  Transmutation: 'items/potions/bubbling-green',
};

const FRAMES: Record<string, string> = {
  common: 'ui/frames/slot-wood',
  uncommon: 'ui/frames/slot-green-wood',
  rare: 'ui/frames/slot-blue-glow',
  very_rare: 'ui/frames/slot-silver-ornate',
  legendary: 'ui/frames/slot-gold-glow',
  artifact: 'ui/frames/slot-gold-ornate',
};

const url = (path: string) => artUrl(path);
const shown = (path: string | null | undefined) => (path && artHas(path) ? artUrl(path) : null);

export const NO_ART = 'none';
let lookupOverride: (key: string) => string | undefined = () => undefined;
export function setArtOverrides(lookup: (key: string) => string | undefined) {
  lookupOverride = lookup;
}

export function normalizeItemName(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function itemArtKey(name: string): string {
  return `item:${normalizeItemName(name).replace(/\s*\([^)]*\)/g, '').replace(/\s*\+\s*\d+$/, '').trim()}`;
}
export const schoolArtKey = (school: string) => `school:${school}`;
export const rarityArtKey = (rarity: string) => `rarity:${rarity.replace(' ', '_')}`;

export function artSource(value: string): string | null {
  if (value === NO_ART) return null;
  return value.startsWith('data:') || value.startsWith('blob:') ? value : shown(value);
}
export const libraryArt = (path: string) => url(path);

export function itemArtPath(name: string | null | undefined, srdIndex?: string | null): string | null {
  const byName = name ? artByName(normalizeItemName(name)) : null;
  return byName ?? (srdIndex ? SRD_INDEX[srdIndex] ?? null : null);
}

function artByName(text: string): string | null {
  let best: { art: string | null; at: number } | null = null;
  for (const entry of RULES) {
    let at = Infinity;
    for (const pattern of entry.all) {
      const found = pattern.exec(text);
      if (!found) { at = -1; break; }
      at = Math.min(at, found.index + (/^[^a-zа-я0-9]/.test(found[0]) ? 1 : 0));
    }
    if (at >= 0 && (!best || at < best.at)) best = { art: entry.art, at };
  }
  return best?.art ?? null;
}

export function defaultItemArt(name: string | null | undefined, srdIndex?: string | null): string | null {
  return shown(itemArtPath(name, srdIndex));
}

export function itemArt(name: string | null | undefined, srdIndex?: string | null): string | null {
  const custom = name ? lookupOverride(itemArtKey(name)) : undefined;
  return custom !== undefined ? artSource(custom) : defaultItemArt(name, srdIndex);
}

export const coinArt = (coin: string) => shown(COINS[coin]);

export function schoolArtPath(school: string | null | undefined): string | null {
  return school && SCHOOLS[school] ? SCHOOLS[school]! : null;
}

export function defaultSchoolArt(school: string | null | undefined): string | null {
  return school ? shown(SCHOOLS[school]) : null;
}

export function schoolArt(school: string | null | undefined): string | null {
  const custom = school ? lookupOverride(schoolArtKey(school)) : undefined;
  return custom !== undefined ? artSource(custom) : defaultSchoolArt(school);
}

export function defaultRarityFrame(rarity: string | null | undefined): string | null {
  const key = rarity?.replace(' ', '_');
  return key ? shown(FRAMES[key]) : null;
}

export function rarityFrame(rarity: string | null | undefined): string | null {
  const custom = rarity ? lookupOverride(rarityArtKey(rarity)) : undefined;
  return custom !== undefined ? artSource(custom) : defaultRarityFrame(rarity);
}
