import type { Queryable } from '../db.ts';
import { advanceWorldTime, announceTime } from '../campaign/world-time.ts';
import { objectSchema, reject, uuid, type SceneFeatureContext } from '../tabletop/scene-feature.ts';
import { addCondition, loadConditionState } from '../rules/conditions.ts';
import { abilityModifier, proficiencyBonusForLevel } from '../../../../packages/domain/dice/dice.ts';
import {
  hitDicePools, hitDiceRecovered, hitDieHealing, recharges, recoverHitDice, spendHitDice, spentByDieOf, type RestKind,
} from '../../../../packages/domain/character/rest.ts';
import { characterClassLevels } from '../../../../packages/domain/character/classes.ts';
import { classFeaturesFor, classLevelOf, songOfRestDie } from '../../../../packages/domain/character/class-features.ts';
import { hasFeat } from '../../../../packages/domain/character/feats.ts';
import { rechargeOnRest } from './magic-items.ts';
import { restorePactSlots } from './class-slots.ts';
import { relationsOf } from '../campaign/factions.ts';

type Notice = { title: string; detail: string; characterId?: string };

type HpChange = (
  q: Queryable, campaignId: string, userId: string, characterId: string,
  change: { mode: 'damage' | 'heal'; amount: number; damageType: string | null; critical: boolean },
) => Promise<{ row: any; applied: number; blocked: string | null; notices: Notice[] }>;

export type RestContext = SceneFeatureContext & {
  insertRoll: (
    q: Queryable, campaignId: string, userId: string, characterId: string | null, label: string | null,
    formula: string, results: number[], modifier: number, total: number, hidden: boolean,
    breakdown?: unknown[] | null, outcome?: Record<string, unknown> | null,
  ) => Promise<any>;
  rollDie: (sides: number) => number;
  canManageCharacter: (q: Queryable, member: any, userId: string, ownerUserId: string | null, characterId?: string | null) => Promise<boolean>;
  applyHpChange: HpChange;
  announceHpChange: (campaignId: string, characterId: string, mode: 'damage' | 'heal', change: { applied: number; blocked: string | null; notices: any[] }) => void;
  campaignFlag: (q: Queryable, campaignId: string, key: string) => Promise<boolean | null>;
};

const DAY_MINUTES = 24 * 60;

export type RestResult = {
  characterId: string;
  name: string;
  skipped: string | null;
  healed: number;
  hitDice: {
    die: number; rolls: number[]; left: number; total: number; recovered: number;
    pools: Array<{ die: number; total: number; left: number }>; spentDice: number[];
  };
  slots: number;
  resources: string[];
  exhaustion: { before: number; after: number } | null;
  arcaneRecovery?: string;
  song?: { bard: string; value: number };
};

const LABELS: Record<RestKind, string> = { short: 'Короткий отдых', long: 'Долгий отдых' };

export function registerRestRoutes(ctx: RestContext) {
  const { app, db, auth, membership, canManage, notifyCampaign, insertRoll, rollDie, canManageCharacter, applyHpChange, announceHpChange, campaignFlag } = ctx;

  type HpEvent = { characterId: string; change: { applied: number; blocked: string | null; notices: any[] } };

  async function songOf(q: Queryable, campaignId: string, ids: string[]): Promise<{ die: number; bard: string } | null> {
    if (!ids.length) return null;
    const rows = (
      await q.query(
        `SELECT c.id, c.name, c.level, c.class_name, c.hp_current FROM characters c
         WHERE c.campaign_id=$1 AND c.id = ANY($2::uuid[]) AND c.hp_current > 0
           AND NOT EXISTS (SELECT 1 FROM character_effects e WHERE e.campaign_id=c.campaign_id AND e.character_id=c.id AND e.active AND e.effect_code IN ('unconscious', 'dead'))`,
        [campaignId, ids],
      )
    ).rows as any[];
    let best: { die: number; bard: string } | null = null;
    for (const row of rows) {
      const classes = characterClassLevels(row).classes;
      if (!classFeaturesFor(classes).some(feature => feature.id === 'song-of-rest')) continue;
      const die = songOfRestDie(classLevelOf(classes, 'bard', row.level));
      if (die > (best?.die ?? 0)) best = { die, bard: row.name };
    }
    return best;
  }

  async function restOne(
    q: Queryable, campaignId: string, userId: string, characterId: string, kind: RestKind,
    hitDice: number | 'auto', events: HpEvent[], song: { die: number; bard: string } | null = null,
  ): Promise<RestResult> {
    const character = (
      await q.query(
        `SELECT id, name, kind, level, constitution, wisdom, hp_current, hp_max, hit_die, hit_dice_spent, hit_dice_spent_by_die,
                sheet_extra, class_name, long_rest_at
         FROM characters WHERE campaign_id=$1 AND id=$2 FOR UPDATE`,
        [campaignId, characterId],
      )
    ).rows[0] as any;
    if (!character) reject(404, 'Персонаж не найден.');
    if (character.kind === 'object') reject(400, 'Отдыхают существа, не предметы.');

    const classes = characterClassLevels(character).classes;
    let pools = hitDicePools(classes, character.hit_die, character.level, character.hit_dice_spent ?? 0, character.hit_dice_spent_by_die);
    const leftOf = () => pools.reduce((sum, pool) => sum + pool.total - pool.spent, 0);
    const poolView = () => pools.map(pool => ({ die: pool.die, total: pool.total, left: pool.total - pool.spent }));
    const result: RestResult = {
      characterId, name: character.name, skipped: null, healed: 0,
      hitDice: { die: pools[0]!.die, rolls: [], left: leftOf(), total: pools.reduce((sum, pool) => sum + pool.total, 0), recovered: 0, pools: poolView(), spentDice: [] },
      slots: 0, resources: [], exhaustion: null,
    };

    const state = await loadConditionState(q, campaignId, characterId);
    if (state.codes.has('dead') || state.exhaustion >= 6) return { ...result, skipped: 'мёртв' };
    const fighting = (await q.query('SELECT 1 FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 LIMIT 1', [campaignId, characterId])).rows[0];
    if (fighting) return { ...result, skipped: 'в бою' };

    const heal = async (amount: number) => {
      if (amount <= 0) return 0;
      const change = await applyHpChange(q, campaignId, userId, characterId, { mode: 'heal', amount, damageType: null, critical: false });
      const healed = Math.max(0, change.row.hp_current - character.hp_current);
      events.push({ characterId, change: { ...change, applied: healed } });
      return healed;
    };

    let longRestAt: number | null = character.long_rest_at;
    let calmNote: string | null = null;
    if (kind === 'short') {
      const left = result.hitDice.left;
      if (hitDice !== 'auto' && hitDice > left) reject(400, `У «${character.name}» осталось костей хитов: ${left}.`);
      const ceiling = state.exhaustion >= 4 ? Math.floor(character.hp_max / 2) : character.hp_max;
      const con = abilityModifier(character.constitution);
      const durable = hasFeat(character.sheet_extra, 'durable');
      const wanted = hitDice === 'auto' ? left : hitDice;
      let healing = 0;
      while (result.hitDice.rolls.length < wanted) {
        if (hitDice === 'auto' && character.hp_current + healing >= ceiling) break;
        const spent = spendHitDice(pools, 1);
        pools = spent.pools;
        const roll = rollDie(spent.dice[0]!);
        result.hitDice.rolls.push(roll);
        result.hitDice.spentDice.push(spent.dice[0]!);
        healing += durable ? Math.max(hitDieHealing(roll, con), Math.max(2, 2 * con)) : hitDieHealing(roll, con);
      }
      const count = result.hitDice.rolls.length;
      if (count) {
        result.hitDice.left = leftOf();
        result.hitDice.pools = poolView();
        const modifier = con * count;
        const groups = [...new Set(result.hitDice.spentDice)].map(die => `${result.hitDice.spentDice.filter(entry => entry === die).length}d${die}`).join('+');
        await insertRoll(
          q, campaignId, userId, characterId, `${LABELS.short}: кости хитов — ${character.name}`.slice(0, 100),
          `${groups}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`.slice(0, 20),
          result.hitDice.rolls, modifier, healing, false, null, { kind: 'rest', rest: 'short' },
        );
        if (song) {
          const value = rollDie(song.die);
          await insertRoll(
            q, campaignId, userId, characterId, `Песнь отдыха (${song.bard}) — ${character.name}`.slice(0, 100),
            `1d${song.die}`, [value], 0, value, false, null, { kind: 'rest', rest: 'short' },
          );
          healing += value;
          result.song = { bard: song.bard, value };
        }
        result.healed = await heal(healing);
      }
      result.slots = await restorePactSlots(q, campaignId, characterId, classes);
      const recovery = classes.some(entry => entry.id === 'wizard') ? 'Арканное восстановление'
        : classes.some(entry => entry.id === 'druid' && entry.level >= 2 && (entry.subclass ?? 'land') === 'land') ? 'Природное восстановление' : null;
      if (recovery) {
        const left = (await q.query(`SELECT current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name=$3`, [campaignId, characterId, recovery])).rows[0];
        const spent = (await q.query('SELECT 1 FROM character_spell_slots WHERE campaign_id=$1 AND character_id=$2 AND level <= 5 AND current < max LIMIT 1', [campaignId, characterId])).rows[0];
        if ((!left || Number(left.current) > 0) && spent) result.arcaneRecovery = recovery;
      }
    } else {
      if (character.hp_current < 1) return { ...result, skipped: 'нужен хотя бы 1 хит' };

      longRestAt = Number((await q.query('SELECT world_minutes FROM campaigns WHERE id=$1', [campaignId])).rows[0].world_minutes);
      if (character.long_rest_at !== null && (await campaignFlag(q, campaignId, 'long_rest_daily')) !== false) {
        const since = longRestAt - character.long_rest_at;
        if (since < DAY_MINUTES) {
          return { ...result, skipped: `следующий долгий отдых через ${Math.ceil((DAY_MINUTES - since) / 60)} ч (раз в сутки)` };
        }
      }

      const ended = (
        await q.query(
          `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code IN ('aid', 'mage_armor', 'overchannel') RETURNING effect_code, parameters`,
          [campaignId, characterId],
        )
      ).rows as Array<{ effect_code: string; parameters: any }>;
      const aidBonus = ended.filter(entry => entry.effect_code === 'aid').reduce((sum, entry) => sum + Number(entry.parameters?.bonus ?? 0), 0);
      if (aidBonus > 0) {
        await q.query('UPDATE characters SET hp_max = GREATEST(1, hp_max - $3), hp_current = LEAST(hp_current, GREATEST(1, hp_max - $3)) WHERE campaign_id=$1 AND id=$2', [campaignId, characterId, aidBonus]);
        character.hp_max = Math.max(1, Number(character.hp_max) - aidBonus);
        character.hp_current = Math.min(Number(character.hp_current), character.hp_max);
      }

      if (state.exhaustion > 0) {
        const after = state.exhaustion - 1;
        await q.query(
          `DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`,
          [campaignId, characterId],
        );
        if (after > 0) {
          await q.query(`INSERT INTO character_effects (campaign_id, character_id, effect_code) VALUES ($1,$2,$3)`, [campaignId, characterId, `exhaustion_${after}`]);
        }
        result.exhaustion = { before: state.exhaustion, after };
      }

      if (classFeaturesFor(characterClassLevels(character).classes).some(feature => feature.id === 'tranquility')) {
        const dc = 8 + proficiencyBonusForLevel(Math.max(1, Number(character.level ?? 1))) + abilityModifier(Number(character.wisdom ?? 10));
        await addCondition(q, campaignId, characterId, 'sanctuary', { source: 'feature', sourceCharacterId: characterId, sourceName: 'Спокойствие', dc });
        calmNote = `«Спокойствие» — «Убежище» (СЛ ${dc})`;
      }

      const exhaustionAfter = result.exhaustion?.after ?? state.exhaustion;
      const ceiling = exhaustionAfter >= 4 ? Math.floor(character.hp_max / 2) : character.hp_max;
      result.healed = await heal(ceiling - character.hp_current);

      const recovered = recoverHitDice(pools, hitDiceRecovered(character.level));
      pools = recovered.pools;
      result.hitDice.recovered = recovered.recovered;
      result.hitDice.left = leftOf();
      result.hitDice.pools = poolView();

      result.slots = (
        await q.query(
          `UPDATE character_spell_slots SET current=max WHERE campaign_id=$1 AND character_id=$2 AND current < max RETURNING level`,
          [campaignId, characterId],
        )
      ).rows.length;
      await q.query(
        `UPDATE characters SET pact_slots_current=pact_slots_max WHERE campaign_id=$1 AND id=$2 AND pact_slots_max IS NOT NULL`,
        [campaignId, characterId],
      );
    }

    const recharge = (['short', 'long'] as const).filter(entry => recharges(entry, kind));
    result.resources = (
      await q.query(
        `UPDATE character_resources SET current=max
         WHERE campaign_id=$1 AND character_id=$2 AND recharge = ANY($3::text[]) AND current < max
         RETURNING name`,
        [campaignId, characterId, recharge],
      )
    ).rows.map(row => row.name as string).sort();
    result.resources.push(...await rechargeOnRest(q, campaignId, characterId, recharge, rollDie));
    if (calmNote) result.resources.push(calmNote);
    if (kind === 'short' && classFeaturesFor(classes).some(feature => feature.id === 'sorcerous-restoration')) {
      const restored = (
        await q.query(
          `UPDATE character_resources SET current=LEAST(max, current + 4) WHERE campaign_id=$1 AND character_id=$2 AND name='Очки чародейства' AND current < max
           RETURNING current, max`,
          [campaignId, characterId],
        )
      ).rows[0];
      if (restored) result.resources.push(`очки чародейства → ${restored.current}/${restored.max} (чародейское восстановление)`);
    }

    await q.query(
      'UPDATE characters SET hit_dice_spent=$3, hit_dice_spent_by_die=$4, long_rest_at=$5, revision=revision+1 WHERE campaign_id=$1 AND id=$2',
      [campaignId, characterId, pools.reduce((sum, pool) => sum + pool.spent, 0), pools.length > 1 ? spentByDieOf(pools) : null, longRestAt],
    );
    return result;
  }

  function summary(result: RestResult) {
    if (result.skipped) return `${result.name}: без пользы — ${result.skipped}`;
    const parts: string[] = [];
    if (result.healed) parts.push(`+${result.healed} хит.`);
    if (result.hitDice.rolls.length) {
      const dice = [...new Set(result.hitDice.spentDice)].map(die => `${result.hitDice.spentDice.filter(entry => entry === die).length} d${die}`);
      parts.push(`костей хитов: ${dice.join(' + ')}`);
    }
    if (result.song) parts.push(`песнь отдыха (${result.song.bard}) +${result.song.value}`);
    if (result.hitDice.recovered) parts.push(`вернулось костей хитов: ${result.hitDice.recovered}`);
    if (result.slots) parts.push('ячейки восстановлены');
    if (result.resources.length) parts.push(result.resources.join(', '));
    if (result.exhaustion) parts.push(`истощение ${result.exhaustion.before} → ${result.exhaustion.after}`);
    if (result.arcaneRecovery) parts.push(`можно «${result.arcaneRecovery}» (в «Умениях»)`);
    return `${result.name}: ${parts.join(', ') || 'всё и так полно'}`;
  }

  function announce(campaignId: string, kind: RestKind, results: RestResult[], events: HpEvent[]) {
    void notifyCampaign(campaignId, { type: 'rolls' });
    void notifyCampaign(campaignId, { type: 'changed' });
    for (const result of results) void notifyCampaign(campaignId, { type: 'character', characterId: result.characterId });
    for (const event of events) announceHpChange(campaignId, event.characterId, 'heal', event.change);
    void notifyCampaign(campaignId, { type: 'notice', title: LABELS[kind], detail: results.map(summary).join('; '), tone: 'info' });
  }

  const restBody = {
    kind: { type: 'string', enum: ['short', 'long'] },
    hitDice: { type: 'integer', minimum: 0, maximum: 20 },
    autoHitDice: { type: 'boolean' },
  };

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { kind: RestKind; hitDice?: number; autoHitDice?: boolean } }>(
    '/campaigns/:campaignId/characters/:characterId/rest',
    { schema: { params: objectSchema({ campaignId: uuid, characterId: uuid }), body: objectSchema(restBody, ['kind']) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { kind, hitDice, autoHitDice } = request.body;
      const events: HpEvent[] = [];

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const owner = (await q.query('SELECT owner_user_id FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0];
        if (!owner) reject(404, 'Персонаж не найден.');
        if (!(await canManageCharacter(q, member, userId, owner.owner_user_id))) reject(403, 'Отдыхать может владелец персонажа или мастер.');
        const song = kind === 'short' ? await songOf(q, campaignId, await companionsOf(q, campaignId, characterId)) : null;
        const rested = await restOne(q, campaignId, userId, characterId, kind, autoHitDice ? 'auto' : hitDice ?? 0, events, song);
        if (rested.skipped === 'в бою') reject(400, `${rested.name} в бою — отдыхать нельзя.`);
        return rested;
      });

      announce(campaignId, kind, [result], events);
      return { result, summary: summary(result) };
    },
  );

  async function partyOf(q: Queryable, campaignId: string, sceneId: string) {
    const rows = (
      await q.query(
        `SELECT DISTINCT c.id, c.name, c.kind, c.disposition, c.factions_explicit FROM scene_objects p
         JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
         WHERE p.campaign_id=$1 AND p.scene_id=$2 AND c.kind IN ('character', 'npc')
         ORDER BY c.name`,
        [campaignId, sceneId],
      )
    ).rows as Array<{ id: string; name: string; kind: string; disposition: string | null; factions_explicit: boolean }>;
    const relations = await relationsOf(q, campaignId, rows);
    return rows.filter(row => relations.withParty(row.id) === 'ally').map(row => ({ id: row.id, name: row.name }));
  }

  async function companionsOf(q: Queryable, campaignId: string, characterId: string): Promise<string[]> {
    const scenes = (await q.query('SELECT DISTINCT scene_id FROM scene_objects WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])).rows.map(row => row.scene_id as string);
    const ids = new Set([characterId]);
    for (const sceneId of scenes) for (const member of await partyOf(q, campaignId, sceneId)) ids.add(member.id);
    return [...ids];
  }

  async function restParty(q: Queryable, campaignId: string, userId: string, sceneId: string, kind: RestKind, autoHitDice: boolean | undefined, events: HpEvent[]) {
    const party = await partyOf(q, campaignId, sceneId);
    if (!party.length) reject(400, 'На сцене нет отряда: персонажей игроков или союзников.');
    const song = kind === 'short' ? await songOf(q, campaignId, party.map(member => member.id)) : null;
    const rested: RestResult[] = [];
    for (const member of party) {
      rested.push(await restOne(q, campaignId, userId, member.id, kind, autoHitDice === false ? 0 : 'auto', events, song));
    }
    return rested;
  }

  app.post<{ Params: { campaignId: string; sceneId: string }; Body: { kind: RestKind; autoHitDice?: boolean } }>(
    '/campaigns/:campaignId/scenes/:sceneId/rest',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, sceneId: uuid }),
        body: objectSchema({ kind: restBody.kind, autoHitDice: restBody.autoHitDice }, ['kind']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { kind, autoHitDice } = request.body;
      const events: HpEvent[] = [];
      let clock = 0;

      const results = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Отдых отряда объявляет мастер сцен.');
        await ctx.getScene(q, campaignId, sceneId);
        const rested = await restParty(q, campaignId, userId, sceneId, kind, autoHitDice, events);
        clock = await advanceWorldTime(q, campaignId, kind === 'long' ? 480 : 60);
        return rested;
      });

      announce(campaignId, kind, results, events);
      announceTime(ctx, campaignId, clock);
      return { results, summary: results.map(summary).join('; ') };
    },
  );

  const DURATION: Record<RestKind, number> = { short: 60, long: 480 };
  const restParams = objectSchema({ campaignId: uuid, sceneId: uuid });

  app.post<{ Params: { campaignId: string; sceneId: string }; Body: { kind: RestKind } }>(
    '/campaigns/:campaignId/scenes/:sceneId/rest/begin',
    { schema: { params: restParams, body: objectSchema({ kind: restBody.kind }, ['kind']) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { kind } = request.body;
      const rest = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Привал объявляет мастер сцен.');
        const scene = await ctx.getScene(q, campaignId, sceneId);
        if (scene.rest) reject(400, 'Отряд уже на привале — завершите или прервите его.');
        if ((await q.query('SELECT 1 FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 LIMIT 1', [campaignId, sceneId])).rows[0]) {
          reject(400, 'Идёт бой — на привал не встать.');
        }
        if (!(await partyOf(q, campaignId, sceneId)).length) reject(400, 'На сцене нет отряда: персонажей игроков или союзников.');
        const value = { kind, startedMinutes: Number(scene.world_minutes), strenuousMinutes: 0, interrupted: null, startedBy: userId };
        await q.query('UPDATE scenes SET rest=$3::jsonb, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId, JSON.stringify(value)]);
        return value;
      });
      void notifyCampaign(campaignId, { type: 'changed' });
      void notifyCampaign(campaignId, {
        type: 'notice', title: kind === 'long' ? 'Привал: долгий отдых' : 'Привал: короткий отдых', tone: 'info',
        detail: kind === 'long' ? 'Восемь часов. Бой больше часа или «Прервать» срывают его.' : 'Час. Бой срывает его — пользы не будет.',
      });
      return { rest };
    },
  );

  app.post<{ Params: { campaignId: string; sceneId: string }; Body: { autoHitDice?: boolean } | undefined }>(
    '/campaigns/:campaignId/scenes/:sceneId/rest/finish',
    { schema: { params: restParams, body: { type: 'object', additionalProperties: false, properties: { autoHitDice: restBody.autoHitDice } } } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const events: HpEvent[] = [];
      let clock: number | null = null;
      const outcome = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Привал завершает мастер сцен.');
        const scene = await ctx.getScene(q, campaignId, sceneId);
        const rest = scene.rest as { kind: RestKind; startedMinutes: number; interrupted: string | null } | null;
        if (!rest) reject(400, 'Отряд не на привале.');
        await q.query('UPDATE scenes SET rest=NULL, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId]);
        if (rest.interrupted) return { kind: rest.kind, interrupted: rest.interrupted, results: [] as RestResult[] };
        if ((await q.query('SELECT 1 FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 LIMIT 1', [campaignId, sceneId])).rows[0]) {
          reject(400, 'Идёт бой — сначала завершите его.');
        }
        const remaining = Math.max(0, DURATION[rest.kind] - (Number(scene.world_minutes) - rest.startedMinutes));
        if (remaining) clock = await advanceWorldTime(q, campaignId, remaining);
        return { kind: rest.kind, interrupted: null, results: await restParty(q, campaignId, userId, sceneId, rest.kind, request.body?.autoHitDice, events) };
      });
      void notifyCampaign(campaignId, { type: 'changed' });
      if (outcome.interrupted) {
        void notifyCampaign(campaignId, {
          type: 'notice', title: `${LABELS[outcome.kind]} не удался`, tone: 'info',
          detail: `Привал сорван: ${outcome.interrupted}. Пользы нет — встаньте на привал заново.`,
        });
        return { ...outcome, summary: `Привал сорван: ${outcome.interrupted}` };
      }
      announce(campaignId, outcome.kind, outcome.results, events);
      if (clock !== null) announceTime(ctx, campaignId, clock);
      return { ...outcome, summary: outcome.results.map(summary).join('; ') };
    },
  );

  app.post<{ Params: { campaignId: string; sceneId: string } }>(
    '/campaigns/:campaignId/scenes/:sceneId/rest/cancel',
    { schema: { params: restParams } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const had = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        if (!(await canManage(q, member, userId))) reject(403, 'Привал прерывает мастер сцен.');
        const scene = await ctx.getScene(q, campaignId, sceneId);
        if (!scene.rest) return false;
        await q.query('UPDATE scenes SET rest=NULL, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, sceneId]);
        return true;
      });
      if (had) {
        void notifyCampaign(campaignId, { type: 'changed' });
        void notifyCampaign(campaignId, { type: 'notice', title: 'Привал прерван', detail: 'Пользы отдыха нет.', tone: 'info' });
      }
      return reply.code(204).send();
    },
  );
}
