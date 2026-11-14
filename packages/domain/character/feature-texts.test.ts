import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CLASS_FEATURES} from '../srd/progression.ts';
import {FEATURE_TITLES, featureCard} from './feature-texts.ts';

const titles = new Set(Object.values(CLASS_FEATURES).flatMap(levels => Object.values(levels).flat()));

test('every feature of the level table has a card, and every card belongs to the table', () => {
  assert.deepEqual([...titles].filter(title => !featureCard(title)), [], 'a feature without a description');
  assert.deepEqual(FEATURE_TITLES.filter(title => !titles.has(title)), [], 'a description of a feature the table does not have');
});

test('a card says whether the game applies the feature', () => {
  assert.deepEqual(featureCard('Безрассудная атака')?.automation, 'auto', 'from the automation catalogue');
  assert.match(featureCard('Безрассудная атака')!.text, /преимуществ/);
  assert.equal(featureCard('Язык солнца и луны')?.automation, 'manual');
  assert.equal(featureCard('Предмет договора')?.automation, 'manual');
  assert.equal(featureCard('Клятва преданности: заклинания клятвы, Божественный канал')?.automation, 'partial');
  assert.equal(featureCard('Нет такого умения'), null);
});
