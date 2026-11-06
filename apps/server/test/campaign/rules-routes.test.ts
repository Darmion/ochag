import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../src/app.ts';
import {createTestDatabase} from '../helpers.ts';

test('campaign rules: flags, numbers, formulas and text', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db);
  t.after(() => app.close());

  const request = (method: any, url: string, token?: string, payload?: any) => app.inject({
    method, url,
    ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
    ...(payload !== undefined ? {payload} : {}),
  });
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_rules'), trusted = await register('trusted_rules'), player = await register('player_rules');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Rules test'})).json().id;
  for (const account of [trusted, player]) {
    const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', account.token, {code});
  }
  assert.equal(
    (await request('PUT', `/campaigns/${campaignId}/members/${trusted.user.id}/permissions`, gm.token, {isFullGm: false, permissions: ['rules.manage']})).statusCode,
    200,
  );

  const rulesPath = () => `/campaigns/${campaignId}/rules`;
  let flagId = '';

  await t.test('a plain player cannot create rules, but sees the list read-only', async () => {
    const denied = await request('POST', rulesPath(), player.token, {key: 'flanking', kind: 'flag', label: 'Фланкирование', value: true});
    assert.equal(denied.statusCode, 403);

    const list = await request('GET', rulesPath(), player.token);
    assert.equal(list.statusCode, 200);
    assert.deepEqual(list.json(), {canManage: false, rules: []});
  });

  await t.test('the GM creates a flag, a number, a formula and a text rule', async () => {
    const flag = await request('POST', rulesPath(), gm.token, {key: 'flanking', kind: 'flag', label: 'Фланкирование', description: 'Даёт преимущество атакующим с двух сторон.', value: true});
    assert.equal(flag.statusCode, 201, flag.body);
    flagId = flag.json().id;
    assert.equal(flag.json().revision, 1);

    const number = await request('POST', rulesPath(), gm.token, {key: 'crit_multiplier', kind: 'number', label: 'Множитель крита', value: 2});
    assert.equal(number.statusCode, 201);

    const formula = await request('POST', rulesPath(), gm.token, {key: 'sneak_attack', kind: 'formula', label: 'Скрытая атака', value: '2d6'});
    assert.equal(formula.statusCode, 201);

    const text = await request('POST', rulesPath(), gm.token, {key: 'resting', kind: 'text', label: 'Отдых', value: 'Долгий отдых — раз в игровые сутки.'});
    assert.equal(text.statusCode, 201);

    const list = await request('GET', rulesPath(), gm.token);
    assert.equal(list.json().canManage, true);
    assert.equal(list.json().rules.length, 4);
  });

  await t.test('a trusted player without is_full_gm, but with rules.manage, can also manage rules', async () => {
    const list = await request('GET', rulesPath(), trusted.token);
    assert.equal(list.json().canManage, true);

    const created = await request('POST', rulesPath(), trusted.token, {key: 'extra', kind: 'flag', label: 'Доп. правило', value: false});
    assert.equal(created.statusCode, 201, created.body);
  });

  await t.test('the value is validated by kind', async () => {
    assert.equal((await request('POST', rulesPath(), gm.token, {key: 'bad_flag', kind: 'flag', label: 'x', value: 'yes'})).statusCode, 400);
    assert.equal((await request('POST', rulesPath(), gm.token, {key: 'bad_number', kind: 'number', label: 'x', value: 'nan'})).statusCode, 400);
    assert.equal((await request('POST', rulesPath(), gm.token, {key: 'bad_formula', kind: 'formula', label: 'x', value: 'сколько-то кубиков'})).statusCode, 400);
    assert.equal((await request('POST', rulesPath(), gm.token, {key: 'bad_formula2', kind: 'formula', label: 'x', value: '2d6'})).statusCode, 201);
    assert.equal((await request('POST', rulesPath(), gm.token, {key: 'Bad-Key', kind: 'text', label: 'x', value: 'y'})).statusCode, 400, 'key must be lowercase snake_case');
  });

  await t.test('a formula rule may use @-token variables (packages/domain/dice/formula.ts, этап A), but only known tokens', async () => {
    const withVariables = await request('POST', rulesPath(), gm.token, {key: 'attack_bonus', kind: 'formula', label: 'Бонус атаки', value: '1d20+@dex+@prof'});
    assert.equal(withVariables.statusCode, 201, withVariables.body);

    const unknownToken = await request('POST', rulesPath(), gm.token, {key: 'bad_token', kind: 'formula', label: 'x', value: '1d20+@luck'});
    assert.equal(unknownToken.statusCode, 400);
  });

  await t.test('the same key cannot be used twice in one campaign', async () => {
    const dup = await request('POST', rulesPath(), gm.token, {key: 'flanking', kind: 'flag', label: 'Ещё раз', value: false});
    assert.equal(dup.statusCode, 409);
  });

  await t.test('updating a rule checks permission, kind-matching value and the revision', async () => {
    const denied = await request('PUT', `${rulesPath()}/${flagId}`, player.token, {label: 'x', value: false, revision: 1});
    assert.equal(denied.statusCode, 403);

    const wrongType = await request('PUT', `${rulesPath()}/${flagId}`, gm.token, {label: 'Фланкирование', value: 'nope', revision: 1});
    assert.equal(wrongType.statusCode, 400);

    const updated = await request('PUT', `${rulesPath()}/${flagId}`, gm.token, {label: 'Фланкирование (выключено)', description: 'Больше не действует.', value: false, revision: 1});
    assert.equal(updated.statusCode, 200, updated.body);
    assert.equal(updated.json().value, false);
    assert.equal(updated.json().revision, 2);

    const stale = await request('PUT', `${rulesPath()}/${flagId}`, gm.token, {label: 'x', value: true, revision: 1});
    assert.equal(stale.statusCode, 409);

    const missing = await request('PUT', `${rulesPath()}/00000000-0000-4000-8000-000000000000`, gm.token, {label: 'x', value: true, revision: 1});
    assert.equal(missing.statusCode, 404);
  });

  await t.test('only a manager deletes a rule, and it disappears from the list', async () => {
    assert.equal((await request('DELETE', `${rulesPath()}/${flagId}`, player.token)).statusCode, 403);
    assert.equal((await request('DELETE', `${rulesPath()}/${flagId}`, gm.token)).statusCode, 204);
    const list = await request('GET', rulesPath(), gm.token);
    assert.ok(!list.json().rules.some((r: any) => r.id === flagId));
  });

  await t.test('a non-member gets 404, not a peek at the rules', async () => {
    const outsider = await register('outsider_rules');
    assert.equal((await request('GET', rulesPath(), outsider.token)).statusCode, 404);
  });
});
