import { shieldMasterBonus, hasEvasion, shieldMasterDodge } from '../../rules/class-features.ts';
import { hasFeat } from '../../../../../packages/domain/character/feats.ts';
import { READIED_EFFECT, bonusAttackBasis, BONUS_BASIS_LABELS, bonusAttackRefusal, REACTION_REFUSAL } from '../../../../../packages/domain/combat/attack-economy.ts';
import { classLevelOf } from '../../../../../packages/domain/character/class-features.ts';
import { loadStates } from '../scene/object-states.ts';
import { deadCreatures } from './loot-routes.ts';
import { characterClassLevels } from '../../../../../packages/domain/character/classes.ts';
import { placementFactions, placementsAllied } from '../../campaign/factions.ts';
import { touches as templateTouches } from '../scene/scene-templates.ts';
import { loadConditionState, addCondition } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { hasRaceTrait, characterRace, dragonAncestry, breathWeaponDice } from '../../../../../packages/domain/character/races.ts';
import { abilityModifier, proficiencyOf, rollDice } from '../../../../../packages/domain/dice/dice.ts';
import { SIZES, footprintCells, snapFootprint } from '../../../../../packages/domain/map/footprint.ts';

import { attacksPerActionFor } from './attack.ts';
import { areaCoverBonus, areaCovers } from './cover.ts';
import { announceHpChange, applyHpChange, type HpChangeResult } from './hp.ts';
import { offerRebukes } from './reactions.ts';
import { revealHidden } from './stealth.ts';
import type { TableContext } from '../context.ts';
import { notify, notifyCampaign, notifyUsers } from '../live/notify.ts';
import { rollCheckFor, rollSaveAgainst } from '../rolls/checks.ts';
import { insertRoll, rollDie } from '../rolls/dice.ts';
import { checkModifier } from '../rolls/modifiers.ts';
import { feetBetween, getScene, sceneWalls } from '../scene/board.ts';
import { nearestFreeSpot, pushAway, withinFeet } from '../scene/movement.ts';
import { canManageCharacter, controls, loadPlacements, rightsOf } from '../scene/placements.ts';
import { type CampaignParams, canManage, objectSchema, reject, uuid } from '../shared.ts';

export type CombatAction = 'grapple' | 'shove-prone' | 'shove-push' | 'escape' | 'help' | 'ready';
export const COMBAT_ACTION_RU: Record<CombatAction, string> = { grapple: 'Захват', 'shove-prone': 'Толчок', 'shove-push': 'Толчок', escape: 'Освободиться', help: 'Помощь', ready: 'Подготовиться' };

export const SAVE_SHORT_RU: Record<string, string> = { dexterity: 'ЛОВ', constitution: 'ТЕЛ' };

export function registerCombatActionRoutes(ctx: TableContext) {
  const { actionEconomy, app, auth, db, membership } = ctx;

  app.get<{ Params: CampaignParams & { characterId: string }; Querystring: { sceneId?: string } }>(
    '/campaigns/:campaignId/characters/:characterId/attack-options',
    { schema: { params: objectSchema({ campaignId: uuid, characterId: uuid }), querystring: objectSchema({ sceneId: uuid }, []) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const sceneId = request.query.sceneId ?? null;
      return db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const character = (await q.query('SELECT id, owner_user_id, level, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0] as any;
        if (!character) reject(404, 'Существо не найдено.');
        if (!(await canManageCharacter(q, member, userId, character.owner_user_id, character.id))) reject(403, 'Это не ваше существо.');
        const turn = (
          await q.query(
            `SELECT is_current, turn_flags FROM initiative_entries WHERE campaign_id=$1 AND character_id=$2 AND ($3::uuid IS NULL OR scene_id=$3)
             ORDER BY is_current DESC, created_at LIMIT 1`,
            [campaignId, characterId, sceneId],
          )
        ).rows[0] as { is_current: boolean; turn_flags: string[] } | undefined;
        const enforced = Boolean(turn) && (await actionEconomy.enabled(q, campaignId)) && (await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)));
        const context = {
          flags: turn?.turn_flags ?? [], hasFeat: (id: string) => hasFeat(character.sheet_extra, id),
          monk: classLevelOf(characterClassLevels(character).classes, 'monk', character.level) > 0,
        };
        const weapons = (
          await q.query('SELECT id, name, weapon_kind, properties, srd_index FROM character_weapons WHERE campaign_id=$1 AND character_id=$2 ORDER BY name', [campaignId, characterId])
        ).rows as any[];
        const readied = (
          await q.query(`SELECT parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3 AND active LIMIT 1`, [campaignId, characterId, READIED_EFFECT])
        ).rows[0] as { parameters: any } | undefined;
        return {
          inCombat: Boolean(turn), current: turn?.is_current === true, enforced,
          weapons: weapons.map(weapon => {
            const basis = bonusAttackBasis(weapon, context);
            return { id: weapon.id as string, bonus: basis, bonusLabel: basis ? BONUS_BASIS_LABELS[basis] : null, bonusReason: basis ? null : bonusAttackRefusal(weapon, context) };
          }),
          readied: readied ? { trigger: typeof readied.parameters?.trigger === 'string' ? readied.parameters.trigger : null } : null,
          reactionReason: readied ? null : REACTION_REFUSAL,
        };
      });
    },
  );
  app.post<{ Params: { campaignId: string; characterId: string }; Body: { action: CombatAction; targetId?: string; foeId?: string; sceneId?: string; using?: 'action' | 'bonus'; trigger?: string } }>(
    '/campaigns/:campaignId/characters/:characterId/combat-action',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, characterId: uuid }),
        body: objectSchema({
          action: { type: 'string', enum: ['grapple', 'shove-prone', 'shove-push', 'escape', 'help', 'ready'] },
          targetId: uuid, foeId: uuid, sceneId: uuid, using: { type: 'string', enum: ['action', 'bonus'] },
          trigger: { type: 'string', maxLength: 120 },
        }, ['action']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { action, targetId, foeId, sceneId, using } = request.body;
      const COLUMNS = `id, name, kind, owner_user_id, size, level, class_name, sheet_extra, challenge_rating::float8 AS challenge_rating,
                       strength, dexterity, constitution, intelligence, wisdom, charisma`;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const actor = (await q.query(`SELECT ${COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2`, [campaignId, characterId])).rows[0] as any;
        if (!actor || actor.kind === 'object') reject(404, 'Существо не найдено.');
        if (!(await canManageCharacter(q, member, userId, actor.owner_user_id, actor.id))) reject(403, 'Действовать можно своим персонажем.');
        const enforce = !(await canManage(q, member, userId));
        const unable = incapacitatedReason(await loadConditionState(q, campaignId, characterId));
        if (unable) reject(400, `${actor.name} не может действовать: ${unable}.`);
        const loadOther = async (id: string | undefined, what: string) => {
          if (!id) reject(400, `${what}: выберите цель.`);
          const row = (await q.query(`SELECT ${COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2`, [campaignId, id])).rows[0] as any;
          if (!row || row.kind === 'object') reject(404, 'Цель не найдена.');
          if (row.id === characterId) reject(400, `${what} — не себя.`);
          return row;
        };
        const contest = async (who: any, keys: string[], label: string) => {
          let best = keys[0]!;
          let bestModifier = -Infinity;
          for (const key of keys) {
            let modifier: number;
            try {
              modifier = (await checkModifier(q, campaignId, who, 'skill', key)).modifier;
            } catch {
              modifier = abilityModifier(who[key === 'athletics' ? 'strength' : 'dexterity']);
            }
            if (modifier > bestModifier) {
              bestModifier = modifier;
              best = key;
            }
          }
          const rolled = await rollCheckFor(ctx, q, campaignId, userId, who.id, 'skill', best, `${label} — ${who.name}`.slice(0, 100), false);
          return { total: rolled.total, skill: best === 'athletics' ? 'Атлетика' : 'Акробатика', of: best === 'athletics' ? 'Атлетики' : 'Акробатики' };
        };
        const near = async (a: string, b: string) => !sceneId || (await withinFeet(q, campaignId, sceneId, a, b, 5)) !== false;

        if (action === 'grapple' || action === 'shove-prone' || action === 'shove-push') {
          const target = await loadOther(targetId, action === 'grapple' ? 'Схватить' : 'Толкнуть');
          if (!(await near(characterId, target.id))) reject(400, `«${target.name}» дальше 5 футов.`);
          const rank = (size: string | null) => Math.max(0, SIZES.indexOf((size ?? 'medium') as (typeof SIZES)[number]));
          if (rank(target.size) - rank(actor.size) > 1) reject(400, `«${target.name}» слишком велик — не больше чем на размер крупнее.`);
          if (using === 'bonus' && !(action !== 'grapple' && hasFeat(actor.sheet_extra, 'shield-master'))) reject(400, 'Бонусным действием — только толчок с чертой «Мастер щита».');
          if (action === 'shove-push' && !sceneId) reject(400, 'Оттолкнуть — на сцене (sceneId).');
          if (action === 'grapple') {
            const already = (
              await q.query(`SELECT 1 FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='grappled' AND active AND parameters->>'sourceCharacterId' = $3`, [campaignId, target.id, characterId])
            ).rows[0];
            if (already) reject(400, `${actor.name} уже держит «${target.name}».`);
          }
          const spent = await actionEconomy.spend(q, campaignId, characterId, using ?? 'action', { kind: using === 'bonus' ? 'other' : 'attack', haste: false }, {
            enforce, sceneId: sceneId ?? null, attacksPerAction: await attacksPerActionFor(q, campaignId, characterId),
          });
          const word = COMBAT_ACTION_RU[action];
          const mine = await contest(actor, ['athletics'], `${word}: Атлетика`);
          const theirs = await contest(target, ['athletics', 'acrobatics'], `${word}: сопротивление`);
          const won = mine.total > theirs.total;
          let outcome = 'не вышло';
          if (won && action === 'grapple') {
            await addCondition(q, campaignId, target.id, 'grappled', { source: 'grapple', sourceCharacterId: characterId, sourceName: actor.name });
            outcome = 'схвачен';
          } else if (won && action === 'shove-prone') {
            await addCondition(q, campaignId, target.id, 'prone', { source: 'shove', sourceCharacterId: characterId, sourceName: actor.name });
            outcome = 'сбит с ног';
          } else if (won) {
            const moved = await pushAway(q, campaignId, sceneId!, characterId, target.id, 5);
            outcome = moved > 0 ? `оттолкнут на ${moved} фт.` : 'некуда толкнуть';
          }
          return {
            won, targetIds: [target.id], economyScene: spent?.sceneId ?? null, mine: mine.total, theirs: theirs.total,
            message: `${actor.name}: «${word}» — ${mine.skill} ${mine.total} против ${theirs.of} ${theirs.total} у «${target.name}»: ${won ? outcome : mine.total === theirs.total ? 'ничья — ничего' : 'не вышло'}.`,
          };
        }

        if (action === 'escape') {
          const hold = (
            await q.query(`SELECT id, parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='grappled' AND active LIMIT 1`, [campaignId, characterId])
          ).rows[0] as { id: string; parameters: any } | undefined;
          if (!hold) reject(400, `${actor.name} не схвачен.`);
          const grapplerId = hold.parameters?.sourceCharacterId as string | undefined;
          const grappler = grapplerId ? (await q.query(`SELECT ${COLUMNS} FROM characters WHERE campaign_id=$1 AND id=$2`, [campaignId, grapplerId])).rows[0] as any : null;
          const escapeDc = Number(hold.parameters?.escapeDc ?? hold.parameters?.save?.dc ?? 0) || null;
          if (!grappler && !escapeDc) reject(400, 'Кто держит — не известно: снимет мастер.');
          const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId: sceneId ?? null });
          const mine = await contest(actor, ['athletics', 'acrobatics'], 'Освободиться из захвата');
          const theirs = grappler ? await contest(grappler, ['athletics'], 'Удержать захват') : { total: escapeDc!, skill: 'СЛ', of: 'СЛ' };
          const won = grappler ? mine.total > theirs.total : mine.total >= escapeDc!;
          if (won) await q.query('DELETE FROM character_effects WHERE id=$1', [hold.id]);
          return {
            won, targetIds: [characterId], economyScene: spent?.sceneId ?? null, mine: mine.total, theirs: theirs.total,
            message: `${actor.name}: освободиться — ${mine.skill} ${mine.total} против ${grappler ? `Атлетики ${theirs.total} у «${grappler.name}»` : `СЛ ${escapeDc}`}: ${won ? 'вырвался' : 'держат'}.`,
          };
        }

        if (action === 'ready') {
          const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId: sceneId ?? null });
          await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code=$3`, [campaignId, characterId, READIED_EFFECT]);
          const trigger = request.body.trigger?.trim() || null;
          await addCondition(q, campaignId, characterId, READIED_EFFECT, {
            source: 'ready', sourceCharacterId: characterId, sourceName: actor.name, ...(trigger ? { trigger } : {}), expires: { at: 'start', of: characterId },
          });
          return {
            won: true, targetIds: [characterId], economyScene: spent?.sceneId ?? null, mine: null, theirs: null,
            message: `${actor.name} готовит атаку${trigger ? ` — «${trigger}»` : ''}: реакцией, до начала своего следующего хода.`,
          };
        }

        const ally = await loadOther(targetId, 'Помочь');
        const foe = foeId ? await loadOther(foeId, 'Помощь в атаке') : null;
        if (foe && !(await near(characterId, foe.id))) reject(400, `«${foe.name}» дальше 5 футов от помогающего.`);
        const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce, sceneId: sceneId ?? null });
        await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='helped' AND parameters->>'sourceCharacterId' = $3`, [campaignId, ally.id, characterId]);
        await addCondition(q, campaignId, ally.id, 'helped', {
          source: 'help', sourceCharacterId: characterId, sourceName: actor.name, ...(foe ? { foeId: foe.id, foeName: foe.name } : {}), expires: { at: 'start', of: characterId },
        });
        return {
          won: true, targetIds: [ally.id], economyScene: spent?.sceneId ?? null, mine: null, theirs: null,
          message: `${actor.name} помогает «${ally.name}»: ${foe ? `первая атака по «${foe.name}» — с преимуществом` : 'следующая проверка — с преимуществом'} (до начала следующего хода помогающего).`,
        };
      });
      void notifyCampaign(ctx, campaignId, { type: 'rolls' });
      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      for (const id of result.targetIds) void notifyCampaign(ctx, campaignId, { type: 'character', characterId: id });
      if (result.economyScene) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId: result.economyScene });
      void notifyCampaign(ctx, campaignId, { type: 'notice', title: COMBAT_ACTION_RU[action], detail: result.message, tone: 'info' });
      return reply.code(201).send({ won: result.won, mine: result.mine, theirs: result.theirs, message: result.message });
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { sceneId: string } }>(
    '/campaigns/:campaignId/characters/:characterId/inspiring-leader',
    { schema: { params: objectSchema({ campaignId: uuid, characterId: uuid }), body: objectSchema({ sceneId: uuid }, ['sceneId']) } },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { sceneId } = request.body;
      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const leader = (
          await q.query('SELECT id, name, owner_user_id, level, sheet_extra, charisma FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])
        ).rows[0] as any;
        if (!leader) reject(404, 'Персонаж не найден.');
        if (!(await canManageCharacter(q, member, userId, leader.owner_user_id, leader.id))) reject(403, 'Действовать можно своим персонажем.');
        if (!hasFeat(leader.sheet_extra, 'inspiring-leader')) reject(400, `У «${leader.name}» нет черты «Воодушевляющий лидер».`);
        const fighting = (
          await q.query(`SELECT 1 FROM initiative_entries ie JOIN scenes s ON s.id = ie.scene_id WHERE ie.campaign_id=$1 AND ie.character_id=$2 AND s.combat_started_at IS NOT NULL LIMIT 1`, [campaignId, characterId])
        ).rows[0];
        if (fighting) reject(400, 'Речь — 10 минут: в бою нельзя.');
        const scene = await getScene(q, campaignId, sceneId, false);
        const placements = await loadPlacements(q, campaignId, sceneId);
        const self = placements.find(placement => placement.character_id === characterId && !placement.parent_object_id);
        if (!self) reject(400, `«${leader.name}» нет на этой сцене.`);
        const fallen = await deadCreatures(q, campaignId, placements.map(placement => placement.character_id));
        const listeners = placements
          .filter(placement => placement.id !== self.id && !placement.parent_object_id && placement.kind !== 'object' && placementFactions(self).length > 0 && placementsAllied(placement, self)
            && !fallen.has(placement.character_id) && feetBetween(scene, self, placement) <= 30)
          .sort((a, b) => feetBetween(scene, self, a) - feetBetween(scene, self, b))
          .filter((placement, index, all) => all.findIndex(other => other.character_id === placement.character_id) === index)
          .slice(0, 6);
        let charge = (
          await q.query(`SELECT id, current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name='Воодушевляющий лидер' FOR UPDATE`, [campaignId, characterId])
        ).rows[0] as { id: string; current: number } | undefined;
        if (!charge) {
          charge = (
            await q.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,'Воодушевляющий лидер',1,1,'short') RETURNING id, current`, [campaignId, characterId])
          ).rows[0] as { id: string; current: number };
        }
        if (Number(charge.current) <= 0) reject(400, `${leader.name}: речь уже звучала — снова после короткого отдыха.`);
        await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [charge.id]);
        const temp = Math.max(1, Number(leader.level ?? 1) + abilityModifier(Number(leader.charisma ?? 10)));
        const ids = [characterId, ...listeners.map(placement => placement.character_id)];
        await q.query('UPDATE characters SET hp_temp = GREATEST(hp_temp, $3), revision = revision + 1 WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, ids, temp]);
        const names = [leader.name, ...listeners.map(placement => placement.name)];
        return { temp, ids, message: `${leader.name}: «Воодушевляющий лидер» — временные хиты ${temp}: ${names.join(', ')}.` };
      });
      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      for (const id of result.ids) void notifyCampaign(ctx, campaignId, { type: 'character', characterId: id });
      void notifyCampaign(ctx, campaignId, { type: 'notice', title: 'Воодушевляющий лидер', detail: result.message, tone: 'info' });
      return reply.code(201).send({ temp: result.temp, characterIds: result.ids, message: result.message });
    },
  );
  app.post<{ Params: { campaignId: string; characterId: string }; Body: { sceneId: string; targetId?: string; x?: number; z?: number } }>(
    '/campaigns/:campaignId/characters/:characterId/breath-weapon',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, characterId: uuid }),
        body: objectSchema({
          sceneId: uuid, targetId: uuid,
          x: { type: 'number', minimum: -1000, maximum: 1000 }, z: { type: 'number', minimum: -1000, maximum: 1000 },
        }, ['sceneId']),
      },
    },
    async (request, reply) => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { sceneId, targetId, x, z } = request.body;
      const events: Array<{ characterId: string; change: HpChangeResult }> = [];

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const character = (
          await q.query(
            `SELECT id, name, kind, owner_user_id, level, challenge_rating::float8 AS challenge_rating, sheet_extra, class_name, constitution
             FROM characters WHERE campaign_id=$1 AND id=$2`,
            [campaignId, characterId],
          )
        ).rows[0] as any;
        if (!character) reject(404, 'Персонаж не найден.');
        if (!(await canManageCharacter(q, member, userId, character.owner_user_id, character.id))) reject(403, 'Действовать можно своим персонажем.');
        if (!hasRaceTrait(characterRace(character), 'breath-weapon')) reject(400, `«Оружие дыхания» — черта драконорождённых; у «${character.name}» её нет.`);
        const ancestry = dragonAncestry(character);
        if (!ancestry) reject(400, `${character.name}: дракон-предок не известен — выберите его в «Умениях».`);
        const unable = incapacitatedReason(await loadConditionState(q, campaignId, characterId));
        if (unable) reject(400, `${character.name} не может действовать: ${unable}.`);

        const scene = await getScene(q, campaignId, sceneId, true);
        const placements = await loadPlacements(q, campaignId, sceneId);
        const self = placements.find(placement => placement.character_id === characterId);
        if (!self) reject(400, `«${character.name}» нет на этой сцене.`);
        const aimed = targetId ? placements.find(placement => placement.character_id === targetId) : null;
        if (targetId && !aimed) reject(400, 'Цели нет на этой сцене.');
        const aim = aimed ? { x: aimed.world_x, z: aimed.world_z } : x !== undefined && z !== undefined ? { x, z } : null;
        if (!aim) reject(400, 'Куда дышать: выберите цель.');
        const dx = aim.x - self.world_x;
        const dz = aim.z - self.world_z;
        const length = Math.hypot(dx, dz);
        if (length < 1e-6) reject(400, 'Цель — на месте дышащего: выберите другую.');

        const line = ancestry.breath.startsWith('линия');
        const edge = footprintCells(self.size) / 2;
        const area = {
          shape: (line ? 'line' : 'cone') as 'line' | 'cone',
          x: self.world_x + (dx / length) * edge, z: self.world_z + (dz / length) * edge,
          direction: ((Math.atan2(dz, dx) * 180) / Math.PI + 360) % 360,
          size: (line ? 30 : 15) / scene.feet_per_unit, width: 5 / scene.feet_per_unit,
        };
        const covers = await areaCovers(q, campaignId, scene, { x: area.x, z: area.z }, placements);
        const seen = new Set<string>();
        const caught = placements.filter(placement => {
          if (placement.character_id === characterId || placement.kind === 'object' || placement.parent_object_id || seen.has(placement.character_id)) return false;
          if (covers.get(placement.character_id) === 'total' || !templateTouches(area, scene, placement)) return false;
          seen.add(placement.character_id);
          return true;
        });

        const spent = await actionEconomy.spend(q, campaignId, characterId, 'action', { kind: 'other' }, { enforce: await actionEconomy.enforceFor(q, campaignId, await canManage(q, member, userId)), sceneId });
        let charge = (
          await q.query(`SELECT id, current FROM character_resources WHERE campaign_id=$1 AND character_id=$2 AND name='Оружие дыхания' FOR UPDATE`, [campaignId, characterId])
        ).rows[0] as { id: string; current: number } | undefined;
        if (!charge) {
          charge = (
            await q.query(`INSERT INTO character_resources (campaign_id, character_id, name, current, max, recharge) VALUES ($1,$2,'Оружие дыхания',1,1,'short') RETURNING id, current`, [campaignId, characterId])
          ).rows[0] as { id: string; current: number };
        }
        if (Number(charge.current) <= 0) reject(400, `${character.name}: «Оружие дыхания» потрачено — вернётся после короткого отдыха.`);
        await q.query('UPDATE character_resources SET current=current-1 WHERE id=$1', [charge.id]);

        const dc = 8 + abilityModifier(character.constitution) + (proficiencyOf(character) ?? 2);
        const dice = breathWeaponDice(character.level);
        const rolled = rollDice({ count: dice, sides: 6, modifier: 0 }, rollDie);
        const targets: Array<{ id: string; name: string; total: number; success: boolean; applied: number; dropped: boolean; evasion?: true }> = [];
        for (const victim of caught) {
          const lone = caught.length === 1 && ancestry.save === 'dexterity';
          const save = await rollSaveAgainst(
            ctx, q, campaignId, userId, victim.character_id, ancestry.save, dc,
            `Спасбросок ${SAVE_SHORT_RU[ancestry.save]} (СЛ ${dc}) против «Оружия дыхания» — ${victim.name}`.slice(0, 100), false,
            areaCoverBonus(covers.get(victim.character_id), ancestry.save) ?? (lone ? await shieldMasterBonus(q, campaignId, victim.character_id) : null), [], { damageType: ancestry.damage },
          );
          const evades = ancestry.save === 'dexterity' && (await hasEvasion(q, campaignId, victim.character_id));
          const shielded = save.success && !evades && ancestry.save === 'dexterity' && (await shieldMasterDodge(q, campaignId, victim.character_id));
          const amount = shielded ? 0 : save.success ? (evades ? 0 : Math.floor(rolled.total / 2)) : evades ? Math.floor(rolled.total / 2) : rolled.total;
          let applied = 0;
          let dropped = false;
          if (amount > 0) {
            const hurt = await applyHpChange(ctx, q, campaignId, userId, victim.character_id, { mode: 'damage', amount, damageType: ancestry.damage, critical: false });
            events.push({ characterId: victim.character_id, change: hurt });
            applied = hurt.applied;
            dropped = hurt.dropped;
          }
          targets.push({ id: victim.character_id, name: victim.name, total: save.total, success: save.success, applied, dropped, ...(evades ? { evasion: true as const } : {}) });
        }
        await insertRoll(
          q, campaignId, userId, characterId, `Оружие дыхания (${ancestry.nameRu.toLowerCase()} дракон) — ${character.name}`.slice(0, 100),
          `${dice}d6`, rolled.results, 0, rolled.total, false, null,
          { kind: 'damage', damageType: ancestry.damage, dc, save: ancestry.save, targets },
        );
        const parts = targets.map(target => `${target.name} — ${target.applied}${target.success ? ', спасбросок' : ''}${target.evasion ? ', увёртливость' : ''}`);
        return {
          name: character.name, damage: rolled.total, formula: `${dice}d6`, dc, save: ancestry.save, damageType: ancestry.damage,
          shape: area.shape, direction: area.direction, targets, economyScene: spent?.sceneId ?? null,
          message: `${character.name}: «Оружие дыхания» — ${rolled.total} (${dice}d6), СЛ ${dc} ${SAVE_SHORT_RU[ancestry.save]}: ${parts.join('; ') || 'никого не задело'}.`,
        };
      });

      void notifyCampaign(ctx, campaignId, { type: 'rolls' });
      void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
      void notifyCampaign(ctx, campaignId, { type: 'float', characterId, text: 'оружие дыхания', tone: 'crit' });
      if (result.economyScene) void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId: result.economyScene });
      for (const event of events) announceHpChange(ctx, campaignId, event.characterId, 'damage', event.change);
      if (events.some(event => event.change.applied > 0)) void offerRebukes(ctx, campaignId, sceneId, characterId, events.filter(event => event.change.applied > 0).map(event => event.characterId));
      const { economyScene: _, ...body } = result;
      return reply.code(201).send(body);
    },
  );

  app.post<{ Params: { campaignId: string; characterId: string }; Body: { actorIds: string[]; withNearby?: boolean } }>(
    '/campaigns/:campaignId/characters/:characterId/travel',
    {
      schema: {
        params: objectSchema({ campaignId: uuid, characterId: uuid }),
        body: {
          type: 'object', additionalProperties: false, required: ['actorIds'],
          properties: { actorIds: { type: 'array', items: uuid, minItems: 1, maxItems: 20, uniqueItems: true }, withNearby: { type: 'boolean' } },
        },
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, characterId } = request.params;
      const { actorIds, withNearby } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const rights = await rightsOf(q, member, userId);
        const state = (await loadStates(q, campaignId, [characterId])).get(characterId) as any;
        if (!state?.passage_scene_id) reject(400, 'Этот предмет никуда не ведёт.');
        const passage = (
          await q.query(
            `SELECT p.id, p.scene_id, p.hidden, c.name FROM scene_objects p JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
             WHERE p.campaign_id=$1 AND p.character_id=$2 LIMIT 1`,
            [campaignId, characterId],
          )
        ).rows[0];
        if (!passage) reject(400, 'Прохода нет на столе.');
        if (!rights.sceneManager && (passage.hidden || (state.secret_dc !== null && !state.secret_found))) reject(404, 'Объект не найден.');
        const fromScene = await getScene(q, campaignId, passage.scene_id);
        const toScene = (await q.query('SELECT id, name FROM scenes WHERE campaign_id=$1 AND id=$2', [campaignId, state.passage_scene_id])).rows[0];
        if (!toScene) reject(400, `«${passage.name}» ведёт в никуда: сцены больше нет.`);
        const target = await getScene(q, campaignId, toScene.id);

        const placements = await loadPlacements(q, campaignId, fromScene.id);
        const door = placements.find(placement => placement.id === passage.id)!;
        const chosen = new Set(actorIds);
        const movers = placements.filter(placement => {
          if (placement.kind === 'object' || placement.parent_object_id) return false;
          if (!controls(rights, userId, placement.character_id, placement.owner_user_id)) return false;
          if (chosen.has(placement.character_id)) return true;
          return withNearby === true && feetBetween(fromScene, placement, door) <= 10;
        });
        for (const id of chosen) {
          const mover = movers.find(placement => placement.character_id === id);
          if (!mover) reject(400, 'Пройти можно своими существами, которые стоят на этой сцене.');
          if (feetBetween(fromScene, mover, door) > 5) reject(400, `${mover.name} далеко от «${passage.name}» — подойдите вплотную.`);
        }
        const fighting = (
          await q.query(
            'SELECT name FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 AND character_id = ANY($3::uuid[]) LIMIT 1',
            [campaignId, fromScene.id, movers.map(mover => mover.character_id)],
          )
        ).rows[0];
        if (fighting) reject(400, `${fighting.name} в бою — сначала бой нужно закончить.`);

        const targetPlacement = state.passage_target_id
          ? (await loadPlacements(q, campaignId, target.id)).find(placement => placement.character_id === state.passage_target_id)
          : undefined;
        const targetWalls = await sceneWalls(q, campaignId, target.id);
        const moved: string[] = [];
        const ownerIds = new Set<string>();
        for (const mover of movers) {
          const n = footprintCells(mover.size);
          const anchor = targetPlacement
            ? { x: snapFootprint(targetPlacement.world_x, target.width_cells, n), z: snapFootprint(targetPlacement.world_z, target.height_cells, n) }
            : { x: snapFootprint(0, target.width_cells, n), z: snapFootprint(0, target.height_cells, n) };
          const spot = await nearestFreeSpot(q, campaignId, target, anchor, n, targetWalls);
          const existing = (
            await q.query('SELECT id FROM scene_objects WHERE campaign_id=$1 AND scene_id=$2 AND character_id=$3', [campaignId, target.id, mover.character_id])
          ).rows[0];
          let newId: string;
          if (existing) {
            await q.query('UPDATE scene_objects SET x=$3, y=0, z=$4, parent_object_id=NULL, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, existing.id, spot.x, spot.z]);
            newId = existing.id;
          } else {
            newId = (
              await q.query(
                `INSERT INTO scene_objects (campaign_id, scene_id, character_id, x, y, z, rotation_y, scale, snap_to_grid, hidden, created_by)
                 VALUES ($1,$2,$3,$4,0,$5,$6,$7,true,false,$8) RETURNING id`,
                [campaignId, target.id, mover.character_id, spot.x, spot.z, mover.rotation_y, mover.scale, userId],
              )
            ).rows[0].id;
          }
          const carried = placements.filter(placement => placement.parent_object_id === mover.id);
          for (const item of carried) {
            await q.query(
              `INSERT INTO scene_objects (campaign_id, scene_id, character_id, parent_object_id, x, y, z, rotation_y, scale, snap_to_grid, hidden, created_by)
               SELECT campaign_id, $3, character_id, $4, x, y, z, rotation_y, scale, snap_to_grid, hidden, $5 FROM scene_objects WHERE campaign_id=$1 AND id=$2
               ON CONFLICT DO NOTHING`,
              [campaignId, item.id, target.id, newId, userId],
            );
            await q.query('DELETE FROM scene_objects WHERE campaign_id=$1 AND id=$2', [campaignId, item.id]);
          }
          await q.query('DELETE FROM scene_objects WHERE campaign_id=$1 AND id=$2', [campaignId, mover.id]);
          await revealHidden(q, campaignId, mover.character_id);
          moved.push(mover.name);
          if (mover.owner_user_id) ownerIds.add(mover.owner_user_id);
        }
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id = ANY($1::uuid[])', [[fromScene.id, target.id]]);
        return {
          fromSceneId: fromScene.id as string, sceneId: target.id as string, sceneName: toScene.name as string,
          passageName: passage.name as string, moved, ownerIds: [...ownerIds, userId],
          characterIds: movers.map(mover => mover.character_id),
        };
      });

      void notify(ctx, campaignId, result.fromSceneId);
      void notify(ctx, campaignId, result.sceneId);
      void notifyCampaign(ctx, campaignId, { type: 'changed' });
      void notifyUsers(ctx, campaignId, result.ownerIds, {
        type: 'passage', fromSceneId: result.fromSceneId, sceneId: result.sceneId, sceneName: result.sceneName, characterIds: result.characterIds,
      });
      void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${result.passageName}: ${result.sceneName}`, detail: `Прошли: ${result.moved.join(', ')}.`, tone: 'info' });
      return { sceneId: result.sceneId, sceneName: result.sceneName, moved: result.moved };
    },
  );
}
