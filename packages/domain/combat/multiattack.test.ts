import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SRD_MONSTERS } from '../srd/monsters.ts';
import { legendaryAttack, multiattackRoutines, multiattackText, routineCount } from './multiattack.ts';

const weaponsOf = (index: string) => SRD_MONSTERS.find(monster => monster.index === index)!.attacks.map(attack => ({ id: attack.name, name: attack.name, kind: attack.kind }));
const parse = (index: string) => multiattackRoutines(SRD_MONSTERS.find(monster => monster.index === index)!.multiattack!.text, weaponsOf(index));
const shape = (index: string) => parse(index).map(routine => routine.steps.map(step => `${step.weaponId ?? '*'}:${step.mode}×${step.count}`).join(' + '));

test('every SRD multiattack text is understood', () => {
  for (const monster of SRD_MONSTERS.filter(entry => entry.multiattack)) {
    const routines = parse(monster.index);
    assert.ok(routines.length, `${monster.index}: ${monster.multiattack!.text}`);
    for (const routine of routines) assert.ok(routineCount(routine) <= monster.multiattack!.count, monster.index);
  }
});

test('different weapons by name, with fleeting vowels and two-word names', () => {
  assert.deepEqual(shape('troll'), ['Укус:any×1 + Коготь:any×2']);
  assert.deepEqual(shape('giant-scorpion'), ['Клешня:any×2 + Жало:any×1']);
  assert.deepEqual(shape('ettin'), ['Боевой топор:any×1 + Моргенштерн:any×1']);
  assert.deepEqual(shape('veteran'), ['Длинный меч:any×2'], 'not the short sword');
  assert.deepEqual(shape('wyvern'), ['Укус:any×1 + Жало:any×1'], 'the in-flight claws are a remark, not a routine');
});

test('alternatives and generic attacks', () => {
  assert.deepEqual(shape('manticore'), ['Укус:any×1 + Коготь:any×2', 'Хвостовой шип:any×3']);
  assert.deepEqual(shape('bandit-captain'), ['Скимитар:melee×2 + Кинжал:melee×1', 'Кинжал:ranged×2']);
  assert.deepEqual(shape('scout'), ['*:melee×2', '*:ranged×2']);
  assert.deepEqual(shape('gladiator'), ['*:melee×3', '*:ranged×2']);
  const lizard = parse('lizardfolk')[0]!;
  assert.equal(lizard.distinct, true, 'each with a different weapon');
  const boss = parse('goblin-boss')[0]!;
  assert.equal(boss.disadvantageAfterFirst, true, 'the second one with disadvantage');
});

test('sheet text and nonsense', () => {
  assert.equal(multiattackText('Мультиатака. Совершает две атаки палицей.\n\nПалица. Рукопашная атака…'), 'Совершает две атаки палицей.');
  assert.equal(multiattackText('Палица. Рукопашная атака…'), null);
  assert.deepEqual(multiattackRoutines('Пугает всех вокруг.', [{ id: 'a', name: 'Палица', kind: 'melee' }]), []);
});

test('legendary options: attacks with a count and a weapon, the rest are not attacks', () => {
  const weapons = [{ id: 'tail', name: 'Хвост', kind: 'melee' as const }, { id: 'bite', name: 'Укус', kind: 'melee' as const }];
  assert.deepEqual(legendaryAttack({ name: 'Атака', text: 'Одна атака оружием.' }, weapons), { weaponId: null, mode: 'any', count: 1 });
  assert.deepEqual(legendaryAttack({ name: 'Сокрушительный удар', text: 'Две атаки оружием подряд.' }, weapons), { weaponId: null, mode: 'any', count: 2 });
  assert.deepEqual(legendaryAttack({ name: 'Удар хвостом', text: 'Совершает атаку хвостом.' }, weapons), { weaponId: 'tail', mode: 'any', count: 1 });
  assert.equal(legendaryAttack({ name: 'Перемещение', text: 'Перемещается на половину скорости, не провоцируя атак при уходе.' }, weapons), null);
  assert.equal(legendaryAttack({ name: 'Удар крыльями', text: 'Каждое существо в 10 фт. — спасбросок Ловкости, иначе сбито с ног.' }, weapons), null);
  assert.equal(legendaryAttack({ name: 'Обнаружение', text: 'Проверка Мудрости (Восприятие).' }, weapons), null);
});

test('legendary options without attacks: an area with a save and a move', async () => {
  const { legendaryArea, legendaryMove } = await import('./multiattack.ts');
  const wing = { radiusFeet: 10, ability: 'dexterity', dc: 19, damage: '2d6+8', damageType: 'bludgeoning', half: false, prone: true };
  assert.deepEqual(legendaryArea({ name: 'Удар крыльями', text: 'Каждое существо в 10 фт. — спасбросок Ловкости СЛ 19, иначе 15 (2к6 + 8) дробящего урона и сбито с ног.' }), wing);
  assert.deepEqual(legendaryArea({
    name: 'Wing Attack',
    text: 'Each creature within 10 feet of the dragon must succeed on a DC 19 Dexterity saving throw or take 15 (2d6 + 8) bludgeoning damage and be knocked prone.',
  }), wing);
  assert.equal(legendaryArea({ name: 'Атака', text: 'Одна атака оружием.' }), null);
  assert.deepEqual(legendaryMove({ name: 'Перемещение', text: 'Перемещается на половину скорости, не провоцируя атак при уходе.' }), { fraction: 0.5 });
  assert.equal(legendaryMove({ name: 'Удар крыльями', text: 'Каждое существо в 10 фт. — спасбросок Ловкости СЛ 19.' }), null);
});
