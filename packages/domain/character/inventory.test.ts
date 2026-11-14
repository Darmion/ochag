import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INVENTORY_CATALOG, carriedWeight, catalogEntry, encumberedSpeed, encumbrance, gearArmorClass, handsNeeded, heavyArmorSlow, itemAmmo,
  itemCategory, itemSlots, normalizeDoll, planEquip, unitPrice, unitWeight, weaponAmmo, type InventoryItem,
} from './inventory.ts';

const item = (patch: Partial<InventoryItem>): InventoryItem => ({
  id: patch.name ?? 'x', name: 'Предмет', containerId: 'hero', quantity: 1, weightLb: 1, priceCp: null, category: null, srd: null,
  wear: null, slot: null, grip: null, infinite: false, ...patch,
});

test('the catalogue keeps SRD packs and prices every SRD weapon', () => {
  const arrows = catalogEntry('gear:arrows-20')!;
  assert.deepEqual([arrows.nameRu, arrows.pack, unitPrice(arrows), unitWeight(arrows)], ['Стрелы', 20, 5, 0.05]);
  const weapons = INVENTORY_CATALOG.filter(entry => entry.category === 'weapon');
  assert.ok(weapons.length >= 37);
  assert.ok(weapons.every(entry => entry.priceCp !== null && entry.weightLb !== null), 'all SRD weapons have cost and weight');
  assert.equal(catalogEntry('weapon:longsword')!.priceCp, 1500);
  assert.equal(catalogEntry('gear:shield')?.category ?? INVENTORY_CATALOG.find(entry => entry.armor?.kind === 'shield')!.category, 'shield');
});

test('categories and slots come from the reference first, then from the name', () => {
  assert.equal(itemCategory(item({ name: 'Длинный меч' })), 'weapon');
  assert.equal(itemCategory(item({ name: 'Кольчуга' })), 'armor');
  assert.equal(itemCategory(item({ name: 'Стрелы' })), 'ammo');
  assert.deepEqual(itemSlots(item({ name: 'Кольцо защиты' })), ['ring_1', 'ring_2']);
  assert.deepEqual(itemSlots(item({ name: 'Плащ эльфов' })), ['cloak']);
  assert.deepEqual(itemSlots(item({ name: 'Щит' })), ['off_hand']);
  assert.deepEqual(itemSlots(item({ name: 'Священный символ (амулет)' })), ['neck']);
  assert.deepEqual(itemSlots(item({ name: 'Бурдюк' })), [], 'a waterskin is not worn');
  assert.deepEqual(itemSlots(item({ name: 'Странный камень', wear: 'neck' })), ['neck'], 'a custom item says where it goes');
});

test('a two-handed weapon takes both hands and pushes the shield back into the bag', () => {
  const shield = item({ id: 'shield', name: 'Щит', slot: 'off_hand' });
  const sword = item({ id: 'sword', name: 'Длинный меч', slot: 'main_hand' });
  const greatsword = item({ id: 'great', name: 'Двуручный меч' });
  assert.equal(handsNeeded(greatsword), 2);
  assert.equal(handsNeeded(item({ name: 'Длинный меч', grip: 'two' })), 2, 'versatile held in two hands');
  const plan = planEquip(greatsword, [shield, sword], 'main_hand');
  assert.ok('slot' in plan);
  assert.deepEqual(plan.displaced.map(entry => entry.id).sort(), ['shield', 'sword']);
  const ring = planEquip(item({ id: 'ring', name: 'Кольцо' }), [item({ id: 'r1', name: 'Кольцо силы', slot: 'ring_1' })], null);
  assert.ok('slot' in ring && ring.slot === 'ring_2' && ring.displaced.length === 0, 'the free ring finger first');
  assert.ok('error' in planEquip(item({ name: 'Бурдюк' }), [], null));
});

test('armour class from worn gear: armour with its DEX cap, shield, Defense, unarmoured classes', () => {
  const chain = item({ name: 'Кольчуга', slot: 'body' });
  const scale = item({ name: 'Чешуйчатый доспех', slot: 'body' });
  const shield = item({ name: 'Щит', slot: 'off_hand' });
  const base = { dexterity: 16, constitution: 14, wisdom: 12, classes: [], defenseStyle: false };
  assert.equal(gearArmorClass({ ...base, worn: [chain, shield] }).value, 18, 'chain mail 16, no DEX, +2 shield');
  assert.equal(gearArmorClass({ ...base, worn: [scale] }).value, 16, 'scale 14 + DEX capped at 2');
  assert.equal(gearArmorClass({ ...base, worn: [chain], defenseStyle: true }).value, 17);
  assert.equal(gearArmorClass({ ...base, worn: [] }).value, 13, '10 + DEX');
  assert.equal(gearArmorClass({ ...base, worn: [], classes: [{ id: 'barbarian', level: 1 }] }).value, 15, 'barbarian 10 + DEX + CON');
  assert.equal(gearArmorClass({ ...base, worn: [shield], classes: [{ id: 'monk', level: 1 }] }).value, 15, 'a monk with a shield loses Unarmored Defense');
  assert.equal(heavyArmorSlow([chain], 12), 10, 'chain mail needs STR 13');
  assert.equal(heavyArmorSlow([chain], 13), 0);
});

test('carried weight counts stacks, nested containers and coins once; encumbrance by STR', () => {
  const items = [
    { id: 'bag', containerId: 'hero', quantity: 1, weightLb: 5 },
    { id: 'rope', containerId: 'bag', quantity: 1, weightLb: 10 },
    { id: 'arrows', containerId: 'hero', quantity: 40, weightLb: 0.05 },
    { id: 'gem', containerId: 'bag', quantity: 2, weightLb: null },
    { id: 'other', containerId: 'someone', quantity: 1, weightLb: 100 },
  ];
  assert.deepEqual(carriedWeight('hero', items, 100), { pounds: 19, unknown: 1 });
  const strong = encumbrance(76, 0, 15, 'medium');
  assert.deepEqual([strong.level, strong.penalty, strong.capacity], ['loaded', 10, 225]);
  assert.equal(encumbrance(160, 0, 15, 'medium').level, 'heavy');
  assert.equal(encumbrance(240, 0, 15, 'medium').level, 'over');
  assert.equal(encumbrance(240, 0, 15, 'large').level, 'loaded', 'large creatures carry twice as much');
  assert.equal(encumberedSpeed(30, { level: 'heavy', penalty: 20 }), 10);
  assert.equal(encumberedSpeed(30, { level: 'over', penalty: 0 }), 5);
  assert.equal(encumberedSpeed(0, { level: 'over', penalty: 0 }), 0, 'overload never raises a speed of 0');
});

test('ammunition matches the weapon', () => {
  assert.equal(weaponAmmo({ srd_index: 'longbow', name: 'Длинный лук' }), 'arrow');
  assert.equal(weaponAmmo({ name: 'Тяжёлый арбалет', properties: ['ammunition'] }), 'bolt');
  assert.equal(weaponAmmo({ name: 'Длинный меч', properties: [] }), null);
  assert.equal(itemAmmo(item({ name: 'Стрелы' })), 'arrow');
  assert.equal(itemAmmo(item({ name: 'Арбалетные болты' })), 'bolt');
});

test('a doll keeps sane points; objects default to a list', () => {
  const doll = normalizeDoll({ preset: 'humanoid', points: { head: { x: 3, y: -1, size: 9 } } }, 'character');
  assert.deepEqual(doll.points.head, { x: 1, y: 0, size: 1.6, hidden: false });
  assert.equal(normalizeDoll(null, 'object').preset, 'list');
  assert.equal(normalizeDoll({ preset: 'beast' }, 'npc').points.main_hand?.hidden, true, 'a beast has no hands');
});
