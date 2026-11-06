import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignMonogram, campaignNumber, campaignVariant, worldTime, type LobbyCampaign } from '../../src/lobby/campaignCards.ts';

const campaign = (id: string, name: string): LobbyCampaign => ({ id, name, owner_user_id: 'u1', avatar_asset_id: null, banner_asset_id: null });

test('campaignMonogram takes the first letters of two words or the first two letters', () => {
  assert.equal(campaignMonogram(campaign('a', 'Проклятие северных земель')), 'ПС');
  assert.equal(campaignMonogram(campaign('a', 'ёлка')), 'ЁЛ');
});

test('campaignNumber is the 1-based place in the list, two digits', () => {
  const list = [campaign('a', 'A'), campaign('b', 'B')];
  assert.equal(campaignNumber(list, list[1]!), '02');
  assert.equal(campaignNumber(list, campaign('x', 'X')), '00');
});

test('campaignVariant is one of four stable looks', () => {
  const variant = campaignVariant(campaign('abc', 'A'));
  assert.ok(variant >= 0 && variant < 4);
  assert.equal(campaignVariant(campaign('abc', 'B')), variant);
});

test('worldTime shows the day and the clock', () => {
  assert.equal(worldTime(0), 'День 1, 00:00');
  assert.equal(worldTime(1440 + 65), 'День 2, 01:05');
  assert.equal(worldTime(-5), 'День 1, 00:00');
});
