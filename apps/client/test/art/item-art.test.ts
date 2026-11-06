import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  NO_ART, coinArt, defaultItemArt, itemArt, itemArtKey, itemArtPath, rarityArtKey, rarityFrame, schoolArt, schoolArtKey, setArtOverrides,
} from '../../src/art/itemArt.ts';
import { SRD_GEAR } from '../../../../packages/domain/srd/gear.ts';
import { SRD_WEAPONS } from '../../../../packages/domain/srd/weapons.ts';
import { SRD_MAGIC_ITEMS } from '../../../../packages/domain/character/magic-items.ts';
import { builtWithPack, inPack, inVanilla, packLibrary, pathOfUrl, useArtPack, vanillaLibrary } from './artPack.ts';

useArtPack(true);

test('every picture named in itemArt.ts is built: into public/art or the ai-art pack (scripts/build-art.py)', () => {
  const source = readFileSync(new URL('../../src/art/itemArt.ts', import.meta.url), 'utf8');
  const paths = [...new Set([...source.matchAll(/'((?:items|scene|ui)\/[a-z0-9/-]+)'/g)].map(match => match[1]!))];
  assert.ok(paths.length > 100);
  for (const path of paths) assert.ok(builtWithPack(path), path);
});

test('SRD weapons: every weapon has its picture, by Russian or English name', () => {
  const expected: Record<string, string | null> = {
    'Кинжал': 'items/weapons/daggers/dagger', 'Метательное копьё': 'items/weapons/polearms/javelin', 'Боевой посох': 'items/weapons/staves/quarterstaff',
    'Серп': 'items/weapons/scythes/sickle', 'Копьё': 'items/weapons/polearms/spear', 'Лёгкий арбалет': 'items/weapons/crossbows/crossbow-light',
    'Дротик': 'items/weapons/thrown/dart', 'Короткий лук': 'items/weapons/bows/shortbow', 'Глефа': 'items/weapons/polearms/glaive',
    'Секира': 'items/weapons/axes/greataxe', 'Двуручный меч': 'items/weapons/swords/greatsword', 'Алебарда': 'items/weapons/polearms/halberd',
    'Кавалерийское копьё': 'items/weapons/polearms/pike', 'Длинный меч': 'items/weapons/swords/longsword', 'Пика': 'items/weapons/polearms/pike',
    'Рапира': 'items/weapons/swords/rapier', 'Скимитар': 'items/weapons/swords/scimitar', 'Короткий меч': 'items/weapons/swords/shortsword',
    'Трезубец': 'items/weapons/polearms/trident', 'Боевая кирка': 'items/gear/pickaxe', 'Ручной арбалет': 'items/weapons/crossbows/crossbow-hand',
    'Тяжёлый арбалет': 'items/weapons/crossbows/crossbow-heavy', 'Длинный лук': 'items/weapons/bows/longbow',
    'Дубинка': 'items/weapons/clubs/club', 'Палица': 'items/weapons/clubs/greatclub', 'Ручной топор': 'items/weapons/axes/handaxe',
    'Лёгкий молот': 'items/weapons/clubs/light-hammer', 'Булава': 'items/weapons/clubs/mace', 'Праща': 'items/weapons/misc/sling',
    'Боевой топор': 'items/weapons/axes/battleaxe', 'Цеп': 'items/weapons/clubs/flail', 'Молот': 'items/weapons/clubs/maul',
    'Моргенштерн': 'items/weapons/clubs/morningstar', 'Боевой молот': 'items/weapons/clubs/warhammer', 'Кнут': 'items/weapons/misc/whip',
    'Духовая трубка': 'items/weapons/misc/blowgun', 'Сеть': 'items/weapons/misc/net', 'Безоружный удар': 'items/weapons/misc/unarmed-strike',
    'Топор': 'items/weapons/axes/handaxe', 'Укус': null, 'Longsword': 'items/weapons/swords/longsword',
    'Crossbow, heavy': 'items/weapons/crossbows/crossbow-heavy', 'Light hammer': 'items/weapons/clubs/light-hammer', 'Warhammer': 'items/weapons/clubs/warhammer',
    'Battleaxe': 'items/weapons/axes/battleaxe', 'Greatclub': 'items/weapons/clubs/greatclub',
  };
  for (const [name, path] of Object.entries(expected)) assert.equal(itemArtPath(name), path, name);
});

test('the earliest word decides: wand of magic missiles is a wand, bolts are not a crossbow, a key to a chest is a key', () => {
  const expected: Record<string, string | null> = {
    'Палочка волшебных стрел': 'items/magic/wands/red-wand',
    'Арбалетные болты (20)': 'items/ammo/arrows/crossbow-bolt',
    'Ключ от сундука': 'items/keys/key-silver',
    'Сундук с золотом': 'scene/containers/chests/chest-wooden-closed',
    'Стрелы (20)': 'items/ammo/quivers/quiver-leather',
    'Свиток «Огненная стрела»': 'items/documents/scroll',
    'Ледяной длинный меч': 'items/weapons/swords/sword-ice',
    'Длинный меч +1': 'items/weapons/swords/longsword',
    'Пылающий клинок': 'items/weapons/swords/sword-lava',
    'Отравленный кинжал': 'items/weapons/daggers/dagger-poisoned',
    'Огненная стрела': 'items/ammo/arrows/arrow-fire',
    'Бочка с маслом': 'scene/containers/barrel-flammable',
    'Масло (фляга)': 'items/potions/golden-oil',
    'Противоядие (флакон)': 'items/potions/blue-drop',
    'Зелье лечения': 'items/potions/red-round',
    'Зелье большого лечения': 'items/potions/red-round-large',
    'Зелье превосходного лечения': 'items/potions/red-jug',
    'Зелье высшего лечения': 'items/potions/red-heart',
    'Посох лечения': 'items/magic/arcane/caduceus',
    'Шарики (мешочек, 1000)': 'items/gear/ball-bearings',
    'Снаряды для пращи (20)': 'scene/nature/rocks/pebbles',
    'Sling bullets': 'scene/nature/rocks/pebbles',
    'Гримуар': 'items/documents/tome-gem',
    'Бронзовый ключ': 'items/keys/key-silver',
    'Цепь (10 футов)': 'items/gear/chain',
    'Кольчуга': 'items/armor/chain-mail',
    'Кольчужная рубаха': 'items/armor/chain-shirt',
    'Ring mail': 'items/armor/ring-mail',
    'Молоток': 'items/gear/hammer',
    'Боевой молот': 'items/weapons/clubs/warhammer',
    'Доспех +1': 'items/magic/worn/armor-plus-1',
    'Кожаный доспех +1': 'items/armor/leather-armor',
    'Медная монета': 'items/valuables/coin-copper',
    'Платиновые монеты': 'items/valuables/coin-platinum',
    'Электрумовая монета': 'items/valuables/coin-electrum',
    'Набор для грима': 'items/tools/disguise-kit',
    'Плащ пилигрима': 'items/magic/worn/cloak-of-protection',
    'Мешочек с компонентами': 'items/gear/belt-pouch',
    'Кошель с монетами': 'items/valuables/coin-stacks',
    'Золотая монета': 'items/valuables/coin-gold',
  };
  for (const [name, path] of Object.entries(expected)) assert.equal(itemArtPath(name), path, name);
});

test('SRD gear: armour, shields, tools, clothes and travel gear by name', () => {
  const expected: Record<string, string | null> = {
    'Факел': 'items/gear/torch', 'Рацион (1 день)': 'items/food/bread', 'Стальное зеркальце': 'items/magic/arcane/hand-mirror',
    'Замок': 'ui/symbols/locked-slot', 'Чернила (бутылочка)': 'items/potions/black-ink', 'Бумага (лист)': 'items/documents/scroll',
    'Книга заклинаний': 'items/documents/tome-gem', 'Кислота (флакон)': 'items/potions/green-tube',
    'Алхимический огонь (фляга)': 'items/potions/orange', 'Святая вода (фляга)': 'items/potions/light-blue',
    'Снаряды для пращи (20)': 'scene/nature/rocks/pebbles', 'Магическая фокусировка (кристалл)': 'items/magic/arcane/crystal-wand',
    'Священный символ (амулет)': 'items/magic/light/sun-staff', 'Друидическая фокусировка (ветка омелы)': 'items/magic/wands/green-sprig',
    'Рюкзак': 'items/gear/backpack', 'Спальник': 'items/gear/bedroll', 'Пеньковая верёвка (50 футов)': 'items/gear/rope-hempen',
    'Шёлковая верёвка (50 футов)': 'items/gear/rope-silk', 'Набор целителя': 'items/tools/healers-kit',
    'Воровские инструменты': 'items/tools/thieves-tools', 'Фонарь с заслонкой': 'items/gear/lantern-hooded',
    'Направленный фонарь': 'items/gear/lantern-bullseye', 'Палатка на двоих': 'items/gear/tent', 'Кошка (абордажный крюк)': 'items/gear/grappling-hook',
    'Стёганый доспех': 'items/armor/padded-armor', 'Кожаный доспех': 'items/armor/leather-armor', 'Проклёпанная кожа': 'items/armor/studded-leather-armor',
    'Шкурный доспех': 'items/armor/hide-armor', 'Чешуйчатый доспех': 'items/armor/scale-mail', 'Кираса': 'items/armor/breastplate',
    'Полулаты': 'items/armor/half-plate', 'Колечный доспех': 'items/armor/ring-mail', 'Наборный доспех': 'items/armor/splint-armor',
    'Латы': 'items/armor/plate-armor', 'Щит': 'items/armor/shield', 'Plate armor': 'items/armor/plate-armor', 'Half plate': 'items/armor/half-plate',
    'Обычная одежда': 'items/clothing/clothes-common', 'Дорожная одежда': 'items/clothing/clothes-travelers', 'Богатая одежда': 'items/clothing/clothes-fine',
    'Кольцо защиты': 'items/magic/worn/ring-of-protection', 'Кольцо сопротивления (огонь)': 'items/magic/worn/ring-of-resistance',
    'Плащ защиты': 'items/magic/worn/cloak-of-protection', 'Наручи защиты': 'items/magic/worn/bracers-of-defense',
    'Обруч интеллекта': 'items/magic/worn/headband-of-intellect', 'Амулет здоровья': 'items/magic/worn/amulet-of-health',
    'Сапоги ходьбы и прыжков': 'items/magic/worn/boots-of-striding-and-springing', 'Кандалы': 'items/gear/manacles', 'Наручники': 'items/gear/manacles',
  };
  for (const [name, path] of Object.entries(expected)) assert.equal(itemArtPath(name), path, name);
});

test('every SRD weapon, piece of gear and magic item has a picture; coins of the purse too', () => {
  const missing = [
    ...SRD_WEAPONS.filter(weapon => !itemArtPath(weapon.nameRu, weapon.index)).map(weapon => weapon.nameRu),
    ...SRD_GEAR.filter(entry => !itemArtPath(entry.nameRu)).map(entry => entry.nameRu),
    ...SRD_MAGIC_ITEMS.filter(item => !itemArtPath(item.nameRu, item.index)).map(item => item.nameRu),
  ];
  assert.deepEqual(missing, []);
  assert.equal(itemArtPath('Фамильная булава', 'mace'), 'items/weapons/clubs/mace');
  assert.equal(itemArtPath('Подарок эльфийки', 'ring-of-protection'), 'items/magic/worn/ring-of-protection');
  for (const coin of ['pp', 'gp', 'ep', 'sp', 'cp']) assert.ok(builtWithPack(pathOfUrl(coinArt(coin)!)), coin);
  assert.equal(coinArt('zz'), null);
});

test('magic items by SRD index, spell schools and rarity frames', () => {
  assert.equal(itemArtPath('Что угодно', 'gauntlets-of-ogre-power'), 'ui/cursors/gauntlet-silver');
  assert.equal(itemArtPath('Перчатки силы огра'), null);
  assert.equal(itemArt('Кинжал'), '/art/items/weapons/daggers/dagger.webp');
  for (const school of ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation']) {
    assert.ok(schoolArt(school), school);
  }
  assert.equal(schoolArt('Unknown'), null);
  assert.equal(rarityFrame('very rare'), rarityFrame('very_rare'));
  assert.equal(rarityFrame('legendary'), '/art/ui/frames/slot-gold-glow.webp');
  assert.equal(rarityFrame(null), null);
});

test('the picture libraries: own (artLibrary.json) and the ai-art pack are built in full, without overlap, and hold every default picture', () => {
  const own = new Set(vanillaLibrary.groups.flatMap(group => group.items.map(item => item.path)));
  const pack = new Set(packLibrary.groups.flatMap(group => group.items.map(item => item.path)));
  assert.equal(own.size, 542);
  assert.equal(pack.size, 212);
  for (const [library, built] of [[vanillaLibrary, inVanilla], [packLibrary, inPack]] as const) {
    for (const group of library.groups) {
      assert.ok(group.label.startsWith(`${group.section} · `), group.label);
      for (const item of group.items) {
        assert.ok(item.label.trim(), item.path);
        assert.ok(built(item.path), item.path);
        assert.ok(!(own.has(item.path) && pack.has(item.path)), item.path);
      }
    }
  }
  const paths = new Set([...own, ...pack]);
  const source = readFileSync(new URL('../../src/art/itemArt.ts', import.meta.url), 'utf8');
  for (const match of source.matchAll(/'((?:items|scene|ui)\/[a-z0-9/-]+)'/g)) assert.ok(paths.has(match[1]!), match[1]);
});

test('personal pictures (the «Облик» tab) win over the defaults: by name without «+1» and brackets, school, rarity frame', () => {
  const overrides: Record<string, string> = {};
  setArtOverrides(key => overrides[key]);
  try {
    assert.equal(itemArtKey('Длинный меч +1'), itemArtKey('длинный  МЕЧ'));
    assert.equal(itemArtKey('Стрелы (20)'), 'item:стрелы');
    assert.equal(itemArtKey('Ёж'), 'item:еж');

    overrides[itemArtKey('Длинный меч')] = 'items/weapons/swords/katana';
    assert.equal(itemArt('Длинный меч +1'), '/art/items/weapons/swords/katana.webp');
    assert.equal(defaultItemArt('Длинный меч +1'), '/art/items/weapons/swords/longsword.webp');
    assert.equal(itemArt('Короткий меч'), '/art/items/weapons/swords/shortsword.webp');

    overrides[itemArtKey('Кинжал')] = NO_ART;
    assert.equal(itemArt('Кинжал'), null);

    overrides[itemArtKey('Булава')] = 'data:image/webp;base64,AAAA';
    assert.equal(itemArt('Булава'), 'data:image/webp;base64,AAAA');
    assert.equal(itemArt('Булава', 'mace'), 'data:image/webp;base64,AAAA');

    overrides[schoolArtKey('Evocation')] = 'items/magic/fire/fireball-staff';
    assert.equal(schoolArt('Evocation'), '/art/items/magic/fire/fireball-staff.webp');
    overrides[rarityArtKey('very rare')] = 'ui/frames/slot-gold-ornate';
    assert.equal(rarityFrame('very_rare'), '/art/ui/frames/slot-gold-ornate.webp');
  } finally {
    setArtOverrides(() => undefined);
  }
  assert.equal(itemArt('Кинжал'), '/art/items/weapons/daggers/dagger.webp');
});

test('without the ai-art pack its pictures are not offered: no picture instead of a broken one', () => {
  useArtPack(false);
  try {
    assert.equal(itemArtPath('Булава'), 'items/weapons/clubs/mace');
    assert.equal(defaultItemArt('Булава'), null);
    assert.equal(itemArt('Кольчуга'), null);
    assert.equal(coinArt('pp'), null);
    assert.equal(coinArt('gp'), '/art/items/valuables/coin-gold.webp');
    assert.equal(itemArt('Кинжал'), '/art/items/weapons/daggers/dagger.webp');
  } finally {
    useArtPack(true);
  }
});
