import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../../../src/app.ts';
import {createTestDatabase} from '../../helpers.ts';

test('initiative queue: deterministic order, group turns over many rounds', async t => {
  const {pg, db} = await createTestDatabase();
  t.after(() => pg.close());
  const app = await buildApp(db, {rateMax: 1_000_000});
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
  const gm = await register('gm_queue'), alice = await register('alice_queue');
  const campaignId = (await request('POST', '/campaigns', gm.token, {name: 'Queue'})).json().id;
  const code = (await request('POST', `/campaigns/${campaignId}/invites`, gm.token)).json().code;
  await request('POST', '/campaigns/join', alice.token, {code});
  await pg.query('UPDATE campaigns SET fog_enabled=false WHERE id=$1', [campaignId]);
  const characters = `/campaigns/${campaignId}/characters`;

  type Side = 'party' | 'enemy' | 'neutral';
  let sceneNumber = 0;
  async function battle(members: Array<{name: string; side: Side; score: number; dex?: number; owner?: 'alice'}>) {
    sceneNumber += 1;
    const sceneId = (await request('POST', `/campaigns/${campaignId}/scenes`, gm.token, {name: `Бой ${sceneNumber}`, widthCells: 20, heightCells: 20})).json().id;
    const scenePath = `/campaigns/${campaignId}/scenes/${sceneId}`;
    const ids: Record<string, string> = {};
    for (const [index, member] of members.entries()) {
      const body: any = member.side === 'party' && member.owner
        ? {kind: 'character', name: member.name, dexterity: member.dex ?? 10}
        : {kind: 'npc', name: member.name, dexterity: member.dex ?? 10, disposition: member.side === 'enemy' ? 'hostile' : member.side === 'party' ? 'friendly' : 'neutral'};
      const created = (await request('POST', characters, member.owner === 'alice' ? alice.token : gm.token, body)).json();
      ids[member.name] = created.id;
      const placed = await request('POST', `${scenePath}/objects`, member.owner === 'alice' ? alice.token : gm.token, {characterId: created.id, x: (index % 10) - 4.5, z: Math.floor(index / 10) - 4.5});
      assert.equal(placed.statusCode, 201, placed.body);
    }
    const started = await request('POST', `${scenePath}/initiative/start`, gm.token, {});
    assert.equal(started.statusCode, 201, started.body);
    for (const member of members) {
      await pg.query('UPDATE initiative_entries SET score=$2, is_current=false WHERE scene_id=$1 AND character_id=$3', [sceneId, member.score, ids[member.name]]);
    }
    const sameTime = (await pg.query<{n: string}>('SELECT count(DISTINCT created_at) AS n FROM initiative_entries WHERE scene_id=$1', [sceneId])).rows[0]!.n;
    assert.equal(Number(sameTime), 1, 'everyone joined in one transaction');
    await request('POST', `${scenePath}/initiative/advance`, gm.token, {});
    return {sceneId, scenePath, ids, sideOf: new Map(members.map(member => [ids[member.name]!, member.side]))};
  }

  const queue = async (scenePath: string) => {
    const body = (await request('GET', `${scenePath}/initiative`, gm.token)).json();
    return {entries: body.entries as Array<{id: string; character_id: string; name: string; is_current: boolean}>, round: body.round ?? null};
  };
  const roundOf = async (sceneId: string) => Number((await pg.query<any>('SELECT combat_round FROM scenes WHERE id=$1', [sceneId])).rows[0].combat_round);

  function checkCurrent(entries: Array<{character_id: string; is_current: boolean; name: string}>, sideOf: Map<string, Side>, label: string) {
    const current = entries.map((entry, index) => (entry.is_current ? index : -1)).filter(index => index >= 0);
    assert.ok(current.length >= 1, `${label}: someone is current`);
    for (let k = 1; k < current.length; k += 1) assert.equal(current[k], current[k - 1]! + 1, `${label}: current entries are adjacent — ${entries.map(e => (e.is_current ? `[${e.name}]` : e.name)).join(' ')}`);
    const side = sideOf.get(entries[current[0]!]!.character_id)!;
    for (const index of current) assert.equal(sideOf.get(entries[index]!.character_id), side, `${label}: one side`);
    if (side === 'neutral') assert.equal(current.length, 1, `${label}: a neutral goes alone`);
    return current;
  }

  async function playRounds(fight: Awaited<ReturnType<typeof battle>>, rounds: number, finishOneByOne: boolean, random: () => number) {
    const startRound = await roundOf(fight.sceneId);
    const order = (await queue(fight.scenePath)).entries.map(entry => entry.id);
    for (let round = 0; round < rounds; round += 1) {
      const seen: string[] = [];
      while (true) {
        const {entries} = await queue(fight.scenePath);
        assert.deepEqual(entries.map(entry => entry.id), order, 'the shown order never changes');
        const current = checkCurrent(entries, fight.sideOf, `round ${round + 1}`);
        if (seen.length && current[0] === 0) break;
        assert.equal(current[0], seen.length, `the next chain starts right after the previous one — ${entries.map(e => (e.is_current ? `[${e.name}]` : e.name)).join(' ')}`);
        for (const index of current) seen.push(entries[index]!.id);
        if (finishOneByOne && current.length > 1) {
          const shuffled = [...current].sort(() => random() - 0.5);
          for (const [k, index] of shuffled.entries()) {
            const done = await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {entryId: entries[index]!.id});
            assert.equal(done.statusCode, 204, done.body);
            if (k < shuffled.length - 1) {
              const middle = (await queue(fight.scenePath)).entries;
              assert.equal(middle.filter(entry => entry.is_current).length, shuffled.length - k - 1, 'the group waits for the rest');
            }
          }
        } else {
          const done = await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {});
          assert.equal(done.statusCode, 204, done.body);
        }
        if (seen.length === order.length) {
          const after = (await queue(fight.scenePath)).entries;
          checkCurrent(after, fight.sideOf, 'wrap');
          assert.ok(after[0]!.is_current, 'after the last chain the round starts from the top');
          break;
        }
      }
      assert.deepEqual([...seen].sort(), [...order].sort(), `round ${round + 1}: everyone moves exactly once`);
      assert.equal(new Set(seen).size, seen.length);
    }
    assert.equal(await roundOf(fight.sceneId), startRound + rounds, 'the round counter grows once per pass');
  }

  let seed = 7;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  await t.test('the reported line-up with ties: friend 1 is never skipped', async () => {
    const fight = await battle([
      {name: 'Враг3', side: 'enemy', score: 12, dex: 12},
      {name: 'Друг1', side: 'party', score: 12, dex: 14, owner: 'alice'},
      {name: 'Враг1', side: 'enemy', score: 12, dex: 16},
      {name: 'Враг4', side: 'enemy', score: 10, dex: 18},
      {name: 'Друг3', side: 'party', score: 8},
      {name: 'Друг2', side: 'party', score: 10, dex: 8},
      {name: 'Враг2', side: 'enemy', score: 15},
    ]);
    const {entries} = await queue(fight.scenePath);
    assert.deepEqual(entries.map(entry => entry.name), ['Враг2', 'Враг1', 'Друг1', 'Враг3', 'Враг4', 'Друг2', 'Друг3']);
    assert.deepEqual(entries.filter(entry => entry.is_current).map(entry => entry.name), ['Враг2', 'Враг1']);
    for (let k = 0; k < 10; k += 1) assert.deepEqual((await queue(fight.scenePath)).entries.map(entry => entry.name), entries.map(entry => entry.name));

    await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {});
    assert.deepEqual((await queue(fight.scenePath)).entries.filter(entry => entry.is_current).map(entry => entry.name), ['Друг1'], 'friend 1 alone, enemies wait');
    assert.equal((await request('POST', `${fight.scenePath}/initiative/advance`, alice.token, {})).statusCode, 204);
    assert.deepEqual((await queue(fight.scenePath)).entries.filter(entry => entry.is_current).map(entry => entry.name), ['Враг3', 'Враг4']);
    assert.equal((await request('POST', `${fight.scenePath}/initiative/advance`, alice.token, {})).statusCode, 403, 'not her turn — nothing is skipped');
    await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {});
    assert.deepEqual((await queue(fight.scenePath)).entries.filter(entry => entry.is_current).map(entry => entry.name), ['Друг2', 'Друг3']);
    await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {});
    assert.deepEqual((await queue(fight.scenePath)).entries.filter(entry => entry.is_current).map(entry => entry.name), ['Враг2', 'Враг1']);
    assert.equal(await roundOf(fight.sceneId), 2);

    await playRounds(fight, 3, false, random);
    await playRounds(fight, 3, true, random);
  });

  await t.test('random line-ups with ties, neutrals and one-by-one turn ends', async () => {
    for (let trial = 0; trial < 12; trial += 1) {
      const size = 4 + Math.floor(random() * 6);
      const sides: Side[] = ['party', 'enemy', 'neutral'];
      const members = Array.from({length: size}, (_, index) => ({
        name: `С${trial}-${index}`,
        side: sides[random() < 0.45 ? 0 : random() < 0.85 ? 1 : 2]!,
        score: 8 + Math.floor(random() * 4),
        dex: 8 + Math.floor(random() * 3) * 2,
      }));
      const fight = await battle(members);
      await playRounds(fight, 2, trial % 2 === 1, random);
    }
  });

  await t.test('a double click on «next» does not skip a chain', async () => {
    const fight = await battle([
      {name: 'Е1', side: 'enemy', score: 20},
      {name: 'П1', side: 'party', score: 15},
      {name: 'Е2', side: 'enemy', score: 10},
    ]);
    const seen = (await queue(fight.scenePath)).entries.filter(entry => entry.is_current).map(entry => entry.id);
    assert.equal((await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {current: seen})).statusCode, 204);
    const again = await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {current: seen});
    assert.equal(again.statusCode, 409, 'the second click saw an old turn');
    assert.deepEqual((await queue(fight.scenePath)).entries.filter(entry => entry.is_current).map(entry => entry.name), ['П1']);
    assert.equal((await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {current: ['bad']})).statusCode, 400);
  });

  await t.test('removing the one whose turn it is passes the turn to the next chain, not to the top', async () => {
    const fight = await battle([
      {name: 'А', side: 'enemy', score: 20},
      {name: 'Б', side: 'party', score: 15},
      {name: 'В', side: 'enemy', score: 10},
      {name: 'Г', side: 'enemy', score: 9},
      {name: 'Д', side: 'party', score: 5},
    ]);
    await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {});
    let {entries} = await queue(fight.scenePath);
    const b = entries.find(entry => entry.name === 'Б')!;
    assert.ok(b.is_current);
    assert.equal((await request('DELETE', `${fight.scenePath}/initiative/${b.id}`, gm.token)).statusCode, 204);
    entries = (await queue(fight.scenePath)).entries;
    assert.deepEqual(entries.filter(entry => entry.is_current).map(entry => entry.name), ['В', 'Г'], 'the chain after Б, not А at the top');
    assert.equal(await roundOf(fight.sceneId), 1, 'still the first round');

    const v = entries.find(entry => entry.name === 'В')!;
    await request('DELETE', `${fight.scenePath}/initiative/${v.id}`, gm.token);
    assert.deepEqual((await queue(fight.scenePath)).entries.filter(entry => entry.is_current).map(entry => entry.name), ['Г']);

    await request('POST', `${fight.scenePath}/initiative/advance`, gm.token, {});
    const d = (await queue(fight.scenePath)).entries.find(entry => entry.name === 'Д')!;
    assert.ok(d.is_current);
    await request('DELETE', `${fight.scenePath}/initiative/${d.id}`, gm.token);
    assert.deepEqual((await queue(fight.scenePath)).entries.filter(entry => entry.is_current).map(entry => entry.name), ['А', 'Г'], 'only enemies are left — they now stand together');
    assert.equal(await roundOf(fight.sceneId), 2);
  });
});
