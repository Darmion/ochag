import {test} from 'node:test';
import assert from 'node:assert/strict';
import {addToWallet, payFromWallet, priceText, splitWallet, walletText, walletTotal, EMPTY_WALLET} from './coins.ts';

const wallet = (coins: Partial<typeof EMPTY_WALLET>) => ({...EMPTY_WALLET, ...coins});

test('the total is in copper: 1 pp = 10 gp = 100 sp = 1000 cp, 1 ep = 5 sp', () => {
  assert.equal(walletTotal(wallet({pp: 1, gp: 2, ep: 1, sp: 3, cp: 4})), 1000 + 200 + 50 + 30 + 4);
});

test('paying takes small coins first and breaks a bigger one with change', () => {
  assert.deepEqual(payFromWallet(wallet({gp: 1, cp: 5}), 7), wallet({sp: 9, cp: 8}), '5 cp + a broken gold coin');
  assert.deepEqual(payFromWallet(wallet({gp: 3}), 100), wallet({gp: 2}));
  assert.deepEqual(payFromWallet(wallet({sp: 1, gp: 1}), 15), wallet({sp: 9, cp: 5}));
  assert.deepEqual(payFromWallet(wallet({pp: 1}), 5000), null, 'not enough');
  const after = payFromWallet(wallet({pp: 2, ep: 3, cp: 1}), 1234)!;
  assert.equal(walletTotal(after), 2000 + 150 + 1 - 1234, 'nothing is lost in change');
});

test('income comes as gold, silver and copper', () => {
  assert.deepEqual(addToWallet(wallet({cp: 1}), 257), wallet({gp: 2, sp: 5, cp: 8}));
});

test('a wallet reads as the coins in it, without change into gold', () => {
  assert.equal(walletText(wallet({pp: 2, gp: 5, ep: 3})), '2 пм 5 зм 3 эм');
  assert.equal(walletText(EMPTY_WALLET), '');
});

test('prices read as gold, silver and copper', () => {
  assert.equal(priceText(150), '1 зм 5 см');
  assert.equal(priceText(1), '1 мм');
  assert.equal(priceText(0), '0 мм');
  assert.equal(priceText(150000), '1500 зм');
});

test('loot splits coin by coin, the remainder to the one who searched', () => {
  assert.deepEqual(splitWallet(wallet({gp: 10, sp: 3, cp: 1}), 3), [wallet({gp: 4, sp: 1, cp: 1}), wallet({gp: 3, sp: 1}), wallet({gp: 3, sp: 1})]);
  assert.deepEqual(splitWallet(wallet({pp: 2}), 1), [wallet({pp: 2})]);
  assert.deepEqual(splitWallet(wallet({ep: 1}), 0), [wallet({ep: 1})]);
});
