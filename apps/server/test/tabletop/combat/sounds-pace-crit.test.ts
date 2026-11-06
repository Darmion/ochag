import {test} from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('scene ambience, spell sound fields, auto-turn pace, natural 20/1, custom spell edits', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
  t.after(() => app.close());
  const asApp = async <T>(fn: () => Promise<T>) => {
    await pg.exec('SET ROLE ttrpg_app');
    try { return await fn(); } finally { await pg.exec('RESET ROLE'); }
  };
  const request = (method: any, url: string, token?: string, payload?: any) => asApp(() => app.inject({
    method, url, ...(token ? {headers: {authorization: `Bearer ${token}`}} : {}), ...(payload !== undefined ? {payload} : {}),
  }));
  const register = async (username: string) => (await request('POST', '/auth/register', undefined, {username, password: 'x'})).json();
  const gm = await register('gm_sounds'), alice = await register('alice_sounds');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Sounds'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const base = `/campaigns/${campaignId}`;
  const sceneId = (await request('POST', `${base}/scenes`, gm.token, {name: 'Опушка', widthCells: 16, heightCells: 12})).json().id;
  const scenePath = `${base}/scenes/${sceneId}`;
  const initiative = `${scenePath}/initiative`;
  const create = async (token: string, body: any) => (await request('POST', `${base}/characters`, token, body)).json();
  const place = async (characterId: string, x: number, z: number) => {
    const made = await request('POST', `${scenePath}/objects`, gm.token, {characterId, x, z});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };
  const learn = async (characterId: string, srdIndex: string) => {
    const made = await request('POST', `${base}/characters/${characterId}/spells`, gm.token, {source: 'srd', srdIndex});
    assert.equal(made.statusCode, 201, made.body);
    return made.json().id as string;
  };

  const wsAddress = (await app.listen({host: '127.0.0.1', port: 0})).replace('http', 'ws');
  const messages: any[] = [];
  const socket = new WebSocket(`${wsAddress}/live`);
  t.after(() => socket.terminate());
  socket.on('message', raw => messages.push(JSON.parse(raw.toString())));
  await new Promise(resolve => socket.once('open', resolve));
  socket.send(JSON.stringify({token: alice.token, campaignId, sceneId}));
  while (!messages.some(m => m.type === 'ready')) await new Promise(resolve => setTimeout(resolve, 20));
  const settle = () => new Promise(resolve => setTimeout(resolve, 250));

  await t.test('scene ambience: the GM sets the place, the water and the footsteps; everyone gets it', async () => {
    const sceneOf = async (token: string) => (await request('GET', scenePath, token)).json().scene;
    assert.deepEqual((await sceneOf(alice.token)).ambience, {}, 'a new scene is quiet');
    const ambience = {place: 'forest', water: 'river', volume: 0.5, steps: 'dirt'};
    const saved = await request('PATCH', scenePath, gm.token, {ambience});
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual((await sceneOf(alice.token)).ambience, ambience);
    assert.equal((await request('PATCH', scenePath, alice.token, {ambience: {place: 'cave'}})).statusCode, 403);
    for (const bad of [{place: 'desert'}, {water: 'ocean'}, {volume: 2}, {steps: 'sand'}, {music: true}]) {
      assert.equal((await request('PATCH', scenePath, gm.token, {ambience: bad})).statusCode, 400, JSON.stringify(bad));
    }
    await request('PATCH', scenePath, gm.token, {ambience: {}});
    assert.deepEqual((await sceneOf(alice.token)).ambience, {});
  });

  const hero = await create(alice.token, {kind: 'character', name: 'Лира', dexterity: 10, hpMax: 200, hpCurrent: 200, armorClass: 12});
  const heroAt = await place(hero.id, -0.5, 0.5);
  const mage = await create(gm.token, {kind: 'npc', name: 'Пиромант', disposition: 'hostile', intelligence: 16, hpMax: 30, hpCurrent: 30});
  const fireball = await learn(mage.id, 'fireball');
  const bolt = await learn(mage.id, 'fire-bolt');
  await pg.query(`INSERT INTO character_spell_slots(campaign_id, character_id, level, current, max) VALUES ($1,$2,3,3,3)`, [campaignId, mage.id]);
  const mageAt = await place(mage.id, 5.5, 0.5);

  await t.test('a spell tells the table its element and the shape of its area (for the sound)', async () => {
    const templateId = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: -0.5, z: 0.5, sizeFeet: 20, label: 'Шар'})).json().id;
    messages.length = 0;
    const cast = await request('POST', `${base}/characters/${mage.id}/spells/${fireball}/cast`, gm.token, {sceneId, templateId});
    assert.equal(cast.statusCode, 201, cast.body);
    await settle();
    const blast = messages.find(m => m.type === 'attack' && m.attackerId === mage.id);
    assert.ok(blast, `the attack event reached the table: ${JSON.stringify(messages.map(m => m.type))}`);
    assert.deepEqual([blast.source, blast.damageType, blast.area, blast.targetId], ['spell', 'fire', 'circle', hero.id]);

    messages.length = 0;
    const single = await request('POST', `${base}/characters/${mage.id}/spells/${bolt}/cast`, gm.token, {sceneId, targetIds: [hero.id]});
    assert.equal(single.statusCode, 201, single.body);
    await settle();
    const shot = messages.find(m => m.type === 'attack' && m.attackerId === mage.id);
    assert.deepEqual([shot?.damageType, shot?.area], ['fire', null], 'one target — no area');
  });

  await t.test('auto turn pace: the server waits for the walk and between blows; fast by default', async () => {
    await pg.query(`DELETE FROM character_spells WHERE character_id=$1`, [mage.id]);
    await request('POST', `${base}/characters/${mage.id}/weapons`, gm.token, {name: 'Посох', ability: 'strength', proficient: false, damageFormula: '1d6'});
    for (const [id, score] of [[mage.id, 30], [hero.id, 5]] as const) {
      const entry = (await request('POST', `${initiative}/join`, gm.token, {characterId: id})).json().id;
      await request('PATCH', `${initiative}/${entry}`, gm.token, {score});
    }
    await request('POST', `${initiative}/advance`, gm.token, {});
    const fresh = () => pg.query('UPDATE initiative_entries SET action_used=false, bonus_used=false, attacks_made=0, moved_feet=0, dashes=0 WHERE scene_id=$1 AND is_current', [sceneId]);

    assert.equal((await request('POST', `${initiative}/auto`, gm.token, {advance: false, pace: 'crawl'})).statusCode, 400);

    await fresh();
    const started = Date.now();
    const paced = await request('POST', `${initiative}/auto`, gm.token, {advance: false, pace: 'normal'});
    const took = Date.now() - started;
    assert.equal(paced.statusCode, 200, paced.body);
    const result = paced.json();
    assert.ok(result.moved, `walks up to the hero: ${result.summary}`);
    assert.ok(result.attacks.length >= 1, result.summary);
    assert.ok(took >= 1500, `paced: ${took} ms`);

    await pg.query('UPDATE scene_objects SET x=5.5, z=0.5 WHERE id=$1', [mageAt]);
    await fresh();
    const quickStart = Date.now();
    const quick = await request('POST', `${initiative}/auto`, gm.token, {advance: false});
    assert.equal(quick.statusCode, 200, quick.body);
    assert.ok(quick.json().moved);
    assert.ok(Date.now() - quickStart < took, 'no pace — no pauses');
    assert.ok(heroAt);
    await request('DELETE', initiative, gm.token);
  });

  await t.test('natural 20 and 1 on saves the server rolls: PHB by default, auto success/failure by the GM rule', async () => {
    await pg.query('DELETE FROM scene_objects WHERE scene_id=$1', [sceneId]);
    const crowd: string[] = [];
    for (const x of [-1.5, -0.5, 0.5, 1.5]) {
      for (const z of [-1.5, -0.5, 0.5, 1.5]) {
        const npc = await create(gm.token, {kind: 'npc', name: `Гоблин ${crowd.length + 1}`, disposition: 'hostile', dexterity: 10, hpMax: 7, hpCurrent: 7});
        await place(npc.id, x, z);
        crowd.push(npc.id);
      }
    }
    const templateId = (await request('POST', `${scenePath}/templates`, gm.token, {shape: 'circle', x: 0, z: 0, sizeFeet: 20, label: 'Волна'})).json().id;
    const roll = async (dc: number) => {
      const response = await request('POST', `${scenePath}/templates/${templateId}/saves`, gm.token, {ability: 'constitution', dc});
      assert.equal(response.statusCode, 200, response.body);
      return response.json().results as Array<{ total: number; success: boolean }>;
    };
    const until = async (dc: number, die: number) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const found = (await roll(dc)).find(entry => entry.total === die);
        if (found) return found;
      }
      assert.fail(`no natural ${die} in 640 saves`);
    };
    assert.equal((await until(30, 20)).success, false, 'PHB: 20 short of DC 30 fails');
    assert.equal((await until(1, 1)).success, true, 'PHB: 1 meets DC 1');

    const rule = await request('POST', `${base}/rules`, gm.token, {key: 'natural_checks', kind: 'text', label: 'Натуральные 20 и 1', value: 'auto'});
    assert.equal(rule.statusCode, 201, rule.body);
    assert.equal((await until(30, 20)).success, true, 'home rule: a natural 20 succeeds');
    assert.equal((await until(1, 1)).success, false, 'home rule: a natural 1 fails');
    const ordinary = (await roll(30)).filter(entry => entry.total > 1 && entry.total < 20);
    assert.ok(ordinary.every(entry => entry.success === false), 'other rolls still need the DC');
  });

  await t.test('custom spells: everything is editable, formulas can be cleared, a player’s edit goes back to review', async () => {
    const made = await request('POST', `${base}/spells`, alice.token, {
      name: 'Искра', level: 1, school: 'Evocation', castingTime: '1 действие', range: '60 футов', duration: 'Мгновенная',
      description: 'Искра бьёт цель.', damageFormula: '2d6', upcastFormula: '1d6',
    });
    assert.equal(made.statusCode, 201, made.body);
    const spellId = made.json().id;
    assert.equal(made.json().status, 'pending');
    assert.equal((await request('PATCH', `${base}/spells/${spellId}/review`, gm.token, {status: 'approved'})).statusCode, 200);

    const edited = await request('PATCH', `${base}/spells/${spellId}`, alice.token, {
      name: 'Большая искра', level: 2, range: '90 футов', description: 'Искра побольше.', damageFormula: null, material: null,
    });
    assert.equal(edited.statusCode, 200, edited.body);
    const spell = edited.json();
    assert.deepEqual([spell.name, spell.level, spell.range, spell.desc, spell.damageFormula, spell.upcastFormula], ['Большая искра', 2, '90 футов', 'Искра побольше.', null, '1d6']);
    assert.equal(spell.status, 'pending', 'a player’s edit of an approved spell goes back to the GM');

    assert.equal((await request('PATCH', `${base}/spells/${spellId}/review`, gm.token, {status: 'approved'})).statusCode, 200);
    const byGm = await request('PATCH', `${base}/spells/${spellId}`, gm.token, {upcastFormula: '2d6', higherLevel: 'Ещё 2d6 за круг.'});
    assert.equal(byGm.statusCode, 200, byGm.body);
    assert.deepEqual([byGm.json().upcastFormula, byGm.json().higherLevel, byGm.json().status], ['2d6', 'Ещё 2d6 за круг.', 'approved']);
    assert.equal((await request('PATCH', `${base}/spells/${spellId}`, gm.token, {upcastFormula: '1d6+2'})).statusCode, 400);
  });
});
