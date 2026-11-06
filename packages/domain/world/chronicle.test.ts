import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildRecap} from './chronicle.ts';

test('a recap tells of fights, quests, bright moments, handouts and experience', () => {
  const recap = buildRecap({
    date: new Date('2026-10-10T18:00:00Z'),
    clockFrom: 'День 3, 14:00', clockTo: 'День 3, 22:30',
    fights: [{
      sceneName: 'Тракт у мельницы', rounds: 3,
      participants: [
        {name: 'Лиэна', side: 'party', damageDealt: 24, kills: 2, crits: 1, experience: 100},
        {name: 'Бран', side: 'party', damageDealt: 9, kills: 1, crits: 0, experience: 100},
        {name: 'Огр', side: 'enemy', damageDealt: 15, kills: 0, crits: 0, experience: null},
      ],
    }],
    quests: [{title: 'Найти барона', status: 'completed'}, {title: 'Спасти мельника', status: 'failed'}],
    highlights: [{name: 'Лиэна', kind: 'crit', target: 'Огр'}, {name: 'Бран', kind: 'fumble', target: null}],
    handouts: ['Письмо барона'],
  });
  assert.equal(recap.title, 'Сессия 10 октября 2026 г.');
  assert.deepEqual(recap.body.split('\n'), [
    'Время в мире: День 3, 14:00 → День 3, 22:30.',
    'Бой: Тракт у мельницы — 3 раунда; повержено врагов: 3; больше всех урона — Лиэна (24).',
    'Выполнено: «Найти барона».',
    'Провалено: «Спасти мельника».',
    'Яркие моменты: Лиэна — критическое попадание по «Огр»; Бран — единица на кубике.',
    'Найдено и прочитано: «Письмо барона».',
    'Опыт: Лиэна +100, Бран +100.',
  ]);
});

test('a quiet session says so', () => {
  const recap = buildRecap({date: new Date('2026-10-10T18:00:00Z'), fights: [], quests: [], highlights: [], handouts: []});
  assert.match(recap.body, /Тихая сессия/);
});

test('rounds read right in Russian', () => {
  const rounds = (n: number) => buildRecap({date: new Date(), fights: [{sceneName: 'Лес', rounds: n, participants: []}], quests: [], highlights: [], handouts: []}).body;
  assert.match(rounds(1), /1 раунд\./);
  assert.match(rounds(2), /2 раунда\./);
  assert.match(rounds(5), /5 раундов\./);
  assert.match(rounds(21), /21 раунд\./);
});
