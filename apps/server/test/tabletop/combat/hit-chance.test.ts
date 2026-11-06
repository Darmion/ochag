import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('hit chance preview', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 100_000});
  t.after(() => app.close());

  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url,
    ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}),
    ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();

  const gm = await register('gm_hitchance'), alice = await register('alice_hitchance');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Hit'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Арена', widthCells: 12, heightCells: 12})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;

  const hero = (await request('POST', `${base}/characters`, alice.token, {
    kind: 'character', name: 'Лира', strength: 16, dexterity: 10, hpMax: 20, hpCurrent: 20, armorClass: 14, speedFeet: 30, level: 3,
  })).json();
  const goblin = (await request('POST', `${base}/characters`, gm.token, {
    kind: 'npc', name: 'Гоблин', disposition: 'hostile', hpMax: 7, hpCurrent: 7, armorClass: 15, speedFeet: 30,
  })).json();
  await request('POST', `${scenePath}/objects`, alice.token, {characterId: hero.id, x: 0.5, z: 0.5});
  await request('POST', `${scenePath}/objects`, gm.token, {characterId: goblin.id, x: 1.5, z: 0.5});
  const axe = (await request('POST', `${base}/characters/${hero.id}/weapons`, alice.token, {
    name: 'Секира', ability: 'strength', proficient: true, damageFormula: '1d12+@str', damageType: 'slashing',
  })).json();

  const preview = (qs: string, token = alice.token) =>
    request('GET', `${base}/rolls/attack-preview?characterId=${hero.id}&key=${axe.id}${qs}`, token);

  await t.test('no target: average damage only, no hit chance', async () => {
    const result = await preview('');
    assert.equal(result.statusCode, 200, result.body);
    const body = result.json();
    assert.equal(body.hitChance, null);
    assert.equal(body.averageDamage, 6 + 3);
  });

  await t.test('matches hitChance(modifier, AC, advantage) exactly, and reacts to distance and the requested advantage', async () => {
    const plain = await preview(`&targetCharacterId=${goblin.id}&sceneId=${sceneId}`);
    const body = plain.json();
    assert.ok(Math.abs(body.hitChance - 0.55) < 1e-9, JSON.stringify(body));
    assert.equal(body.advantage, 'none');
    assert.equal(body.distance, 5);
    assert.equal(body.cover, 'none');

    const adv = (await preview(`&targetCharacterId=${goblin.id}&sceneId=${sceneId}&advantage=adv`)).json();
    assert.ok(adv.hitChance > body.hitChance, JSON.stringify(adv));
    assert.equal(adv.advantage, 'adv');
    assert.ok(adv.reasons.some((r: string) => r.includes('выбрано преимущество')));

    const disadv = (await preview(`&targetCharacterId=${goblin.id}&sceneId=${sceneId}&advantage=disadv`)).json();
    assert.ok(disadv.hitChance < body.hitChance, JSON.stringify(disadv));
  });

  await t.test('the owner or the GM can see it, a bystander cannot; a bad weapon id is a clear 404', async () => {
    const bob = await register('bob_hitchance');
    const bobCode = (await request('POST', `${base}/invites`, gm.token)).json().code;
    await request('POST', '/campaigns/join', bob.token, {code: bobCode});
    assert.equal((await preview('', bob.token)).statusCode, 403);
    assert.equal((await preview('', gm.token)).statusCode, 200);
    const badWeapon = await request('GET', `${base}/rolls/attack-preview?characterId=${hero.id}&key=not-a-uuid`, alice.token);
    assert.equal(badWeapon.statusCode, 404);
  });

  await t.test('full cover (another wall between, point-blank) is "too far" with a cover reason, not a silent miss', async () => {
    await request('POST', `${scenePath}/walls`, gm.token, {x1: 1, z1: 0, x2: 1, z2: 1});
    const covered = (await preview(`&targetCharacterId=${goblin.id}&sceneId=${sceneId}`)).json();
    assert.equal(covered.hitChance, null);
    assert.match(covered.tooFar, /укрытием/);
  });

  await t.test('moving the target out of reach gives "too far" with a range reason, not a hard error', async () => {
    const moveGoblin = async (x: number, z: number) => {
      const current = (await request('GET', `${scenePath}`, gm.token)).json().objects.find((o: any) => o.character_id === goblin.id);
      return request('PUT', `${scenePath}/objects/${current.id}`, gm.token, {
        x, y: 0, z, rotationY: 0, scale: 1, snapToGrid: true, parentObjectId: null, animationName: null, revision: current.revision,
      });
    };
    await moveGoblin(0.5, 5.5);
    const far = (await preview(`&targetCharacterId=${goblin.id}&sceneId=${sceneId}`)).json();
    assert.equal(far.hitChance, null);
    assert.match(far.tooFar, /вне досягаемости/);
    await moveGoblin(0.5, -0.5);
  });

  await t.test('an incapacitated attacker previews no hit chance either', async () => {
    await request('POST', `${base}/characters/${hero.id}/effects`, gm.token, {effectCode: 'stunned'});
    const stunned = (await preview(`&targetCharacterId=${goblin.id}&sceneId=${sceneId}`)).json();
    assert.equal(stunned.hitChance, null);
    assert.equal(stunned.unable, 'ошеломлён');
  });
});
