import type { Queryable } from '../../db.ts';
import { hasFeat } from '../../../../../packages/domain/character/feats.ts';
import { loadStates } from '../scene/object-states.ts';
import { deadCreatures } from './loot-routes.ts';
import { coverBetween } from '../../../../../packages/domain/combat/targeting.ts';
import { placementRelation, placementFactions, placementRelations } from '../../campaign/factions.ts';
import { loadConditionState } from '../../rules/conditions.ts';
import { incapacitatedReason } from '../../../../../packages/domain/combat/conditions.ts';
import { weatherRules } from '../../../../../packages/domain/world/clock.ts';
import { notices, passiveScore, seesClearly } from '../../../../../packages/domain/combat/stealth.ts';
import { abilityModifier } from '../../../../../packages/domain/dice/dice.ts';
import { footprintCells } from '../../../../../packages/domain/map/footprint.ts';

import { obscuredSight, perceivesInvisible, sceneSight, type SceneSight, seenFrom } from './sight.ts';
import type { TableContext } from '../context.ts';
import { notify, notifyCampaign } from '../live/notify.ts';
import { rollCheckFor } from '../rolls/checks.ts';
import { blindsenseFinds, checkModifier } from '../rolls/modifiers.ts';
import { getScene } from '../scene/board.ts';
import { canManageCharacter, loadPlacements } from '../scene/placements.ts';
import { visionSources } from '../scene/vision.ts';
import { canManage, objectSchema, type Placement, reject, sceneParams, type SceneParams, uuid } from '../shared.ts';

export async function hiddenStealth(q: Queryable, campaignId: string, characterIds: string[]): Promise<Map<string, number>> {
  if (!characterIds.length) return new Map();
  return new Map(
    (
      await q.query(
        `SELECT character_id, (parameters->>'total')::int AS total FROM character_effects
           WHERE campaign_id=$1 AND character_id = ANY($2::uuid[]) AND active AND effect_code='hidden'`,
        [campaignId, [...new Set(characterIds)]],
      )
    ).rows.map(row => [row.character_id as string, Number(row.total)]),
  );
}

export async function perceptionModifier(q: Queryable, campaignId: string, characterId: string): Promise<number | null> {
  const actor = (
    await q.query(
      `SELECT id, name, owner_user_id, level, challenge_rating::float8 AS challenge_rating, sheet_extra, class_name,
                strength, dexterity, constitution, intelligence, wisdom, charisma
         FROM characters WHERE campaign_id=$1 AND id=$2`,
      [campaignId, characterId],
    )
  ).rows[0];
  if (!actor) return null;
  if ((await loadConditionState(q, campaignId, characterId)).codes.has('blinded')) return null;
  const observant = hasFeat(actor.sheet_extra, 'observant') ? 5 : 0;
  try {
    return (await checkModifier(q, campaignId, actor, 'skill', 'perception')).modifier + observant;
  } catch {
    return abilityModifier(actor.wisdom) + observant;
  }
}

export async function spots(
  q: Queryable, campaignId: string, sight: SceneSight, observer: Placement, hidden: Placement, total: number,
  cache: Map<string, number | null>, score?: number,
) {
  const seen = seenFrom(sight, observer, hidden.world_x, hidden.world_z);
  if (seen === null) return false;
  if (score !== undefined) return notices(score, total);
  if (!cache.has(observer.character_id)) cache.set(observer.character_id, await perceptionModifier(q, campaignId, observer.character_id));
  const modifier = cache.get(observer.character_id);
  if (modifier === null || modifier === undefined) return false;
  return notices(passiveScore(modifier, seen !== 'bright' || weatherRules(sight.scene.weather).obscured), total);
}

export function opposed(a: Placement, b: Placement) {
  const relation = placementRelation(a, b);
  return relation === 'enemy' || (relation === 'neutral' && (placementFactions(a).length > 0 || placementFactions(b).length > 0));
}

export async function stealthHiddenIds(
  q: Queryable, campaignId: string, scene: any, placements: Placement[], member: any, userId: string,
  isControlled: (placement: Placement) => boolean,
): Promise<Set<string>> {
  const result = new Set<string>();
  const secrets = await q.query(
    `SELECT character_id FROM object_states WHERE campaign_id=$1 AND secret_dc IS NOT NULL AND NOT secret_found
         AND character_id = ANY($2::uuid[])`,
    [campaignId, placements.filter(placement => placement.kind === 'object').map(placement => placement.character_id)],
  );
  const secret = new Set(secrets.rows.map(row => row.character_id as string));
  for (const placement of placements) if (secret.has(placement.character_id) && !isControlled(placement)) result.add(placement.id);

  const hiddenMap = await hiddenStealth(q, campaignId, placements.filter(placement => placement.kind !== 'object').map(placement => placement.character_id));
  if (hiddenMap.size) {
    const sources = await visionSources(q, campaignId, member, userId, placements);
    const sight = await sceneSight(q, campaignId, scene, placements);
    const cache = new Map<string, number | null>();
    for (const placement of placements) {
      const total = hiddenMap.get(placement.character_id);
      if (total === undefined || isControlled(placement) || placement.parent_object_id) continue;
      const watchers = sources.filter(source => source.id !== placement.id && opposed(source, placement));
      if (sources.length && !watchers.length) continue;
      let spotted = false;
      for (const watcher of watchers) {
        if (await spots(q, campaignId, sight, watcher, placement, total, cache)) { spotted = true; break; }
      }
      if (!spotted) result.add(placement.id);
    }
  }

  const invisible = new Set(
    (
      await q.query(
        `SELECT DISTINCT character_id FROM character_effects WHERE campaign_id=$1 AND active AND effect_code='invisible' AND character_id = ANY($2::uuid[])`,
        [campaignId, placements.filter(placement => placement.kind !== 'object').map(placement => placement.character_id)],
      )
    ).rows.map(row => row.character_id as string),
  );
  if (invisible.size) {
    const sources = await visionSources(q, campaignId, member, userId, placements);
    const sight = await sceneSight(q, campaignId, scene, placements);
    for (const placement of placements) {
      if (!invisible.has(placement.character_id) || isControlled(placement) || placement.parent_object_id || result.has(placement.id)) continue;
      const watchers = sources.filter(source => source.id !== placement.id && opposed(source, placement));
      if (sources.length && !watchers.length) continue;
      let seen = false;
      for (const watcher of watchers) {
        if (await perceivesInvisible(q, campaignId, sight, watcher, placement)) { seen = true; break; }
      }
      if (!seen) result.add(placement.id);
    }
  }

  let grew = result.size > 0;
  while (grew) {
    grew = false;
    for (const placement of placements) {
      if (placement.parent_object_id && result.has(placement.parent_object_id) && !result.has(placement.id)) {
        result.add(placement.id);
        grew = true;
      }
    }
  }
  return result;
}

export async function stealthAttack(q: Queryable, campaignId: string, sceneId: string, attackerId: string, targetId: string, attackerTotal?: number) {
  const hiddenMap = await hiddenStealth(q, campaignId, [attackerId, targetId]);
  const ownTotal = attackerTotal ?? hiddenMap.get(attackerId);
  const targetTotal = hiddenMap.get(targetId);
  if (ownTotal === undefined && targetTotal === undefined) return null;
  const scene = await getScene(q, campaignId, sceneId, false);
  const sight = await sceneSight(q, campaignId, scene);
  const pick = (id: string) => sight.placements.find(placement => placement.character_id === id && !placement.parent_object_id);
  const attacker = pick(attackerId);
  const target = pick(targetId);
  if (!attacker || !target) return null;
  const cache = new Map<string, number | null>();
  const advantages: string[] = [];
  const disadvantages: string[] = [];
  if (ownTotal !== undefined && !(await spots(q, campaignId, sight, target, attacker, ownTotal, cache))) advantages.push('из скрытности');
  let sensed = false;
  if (targetTotal !== undefined && !(await spots(q, campaignId, sight, attacker, target, targetTotal, cache))) {
    if (await blindsenseFinds(q, campaignId, scene, attacker, target)) sensed = true;
    else disadvantages.push('цель скрыта');
  }
  return { advantages, disadvantages, revealAttacker: hiddenMap.has(attackerId), sensed };
}

export async function revealHidden(q: Queryable, campaignId: string, characterId: string) {
  return (
    await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='hidden' RETURNING id`, [campaignId, characterId])
  ).rows.length > 0;
}

export async function detectAround(q: Queryable, campaignId: string, scene: any, characterId: string, score?: number): Promise<string[]> {
  const pending = (
    await q.query(
      `SELECT 1 FROM scene_triggers WHERE campaign_id=$1 AND scene_id=$2 AND kind='enter' AND enabled AND NOT detected AND detect_dc IS NOT NULL
         UNION ALL
         SELECT 1 FROM object_states s JOIN scene_objects p ON p.campaign_id=s.campaign_id AND p.character_id=s.character_id
         WHERE s.campaign_id=$1 AND p.scene_id=$2
           AND ((s.trap_armed AND NOT s.trap_detected AND s.trap_detect_dc IS NOT NULL) OR (s.secret_dc IS NOT NULL AND NOT s.secret_found))
         LIMIT 1`,
      [campaignId, scene.id],
    )
  ).rows[0];
  if (!pending) return [];
  const sight = await sceneSight(q, campaignId, scene);
  const self = sight.placements.find(placement => placement.character_id === characterId && !placement.parent_object_id);
  if (!self || (score === undefined && placementRelations(self)?.withParty(self.character_id) !== 'ally')) return [];
  const modifier = score === undefined ? await perceptionModifier(q, campaignId, characterId) : null;
  if (score === undefined && modifier === null) return [];
  const reach = (x: number, z: number) => Math.hypot(x - self.world_x, z - self.world_z) * scene.feet_per_unit <= 30 + 1e-9;
  const passes = (x: number, z: number, dc: number, ignore?: string) => {
    const seen = seenFrom(sight, self, x, z, ignore);
    if (seen === null || !reach(x, z)) return false;
    return (score ?? passiveScore(modifier!, seen !== 'bright' || weatherRules(scene.weather).obscured)) >= dc;
  };
  const found: string[] = [];
  const objects = sight.placements.filter(placement => placement.kind === 'object');
  const states = await loadStates(q, campaignId, objects.map(placement => placement.character_id));
  for (const placement of objects) {
    const state = states.get(placement.character_id) as any;
    if (!state) continue;
    if (state.trap_armed && !state.trap_detected && state.trap_detect_dc !== null && passes(placement.world_x, placement.world_z, state.trap_detect_dc, placement.id)) {
      await q.query('UPDATE object_states SET trap_detected=true WHERE campaign_id=$1 AND character_id=$2', [campaignId, placement.character_id]);
      found.push(`ловушку на «${placement.name}»`);
    }
    if (state.secret_dc !== null && state.secret_dc !== undefined && !state.secret_found && passes(placement.world_x, placement.world_z, state.secret_dc, placement.id)) {
      await q.query('UPDATE object_states SET secret_found=true WHERE campaign_id=$1 AND character_id=$2', [campaignId, placement.character_id]);
      found.push(`тайное: «${placement.name}»`);
    }
  }
  const areas = (
    await q.query(
      `SELECT id, name, x, z, detect_dc FROM scene_triggers
         WHERE campaign_id=$1 AND scene_id=$2 AND kind='enter' AND enabled AND NOT detected AND detect_dc IS NOT NULL`,
      [campaignId, scene.id],
    )
  ).rows;
  for (const area of areas) {
    if (!passes(Number(area.x), Number(area.z), area.detect_dc)) continue;
    await q.query('UPDATE scene_triggers SET detected=true WHERE id=$1', [area.id]);
    found.push(`ловушку «${area.name}»`);
  }
  if (found.length) await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [scene.id]);
  return found;
}

export function announceRevealed(ctx: TableContext, campaignId: string, characterId: string, sceneId: string | null) {
  void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
  void notifyCampaign(ctx, campaignId, { type: 'changed' });
  if (sceneId) void notify(ctx, campaignId, sceneId);
}

export function announceFound(ctx: TableContext, campaignId: string, name: string, found: string[]) {
  if (!found.length) return;
  void notifyCampaign(ctx, campaignId, { type: 'notice', title: `${name} замечает`, detail: `${found.join(', ')}.`, tone: 'info' });
  void notifyCampaign(ctx, campaignId, { type: 'changed' });
}

export const stealthBody = {
  type: 'object', additionalProperties: false, required: ['characterId'],
  properties: { characterId: uuid, using: { type: 'string', enum: ['action', 'bonus'] } },
};

export async function stealthActor(q: Queryable, member: any, userId: string, campaignId: string, scene: any, characterId: string) {
  const placements = await loadPlacements(q, campaignId, scene.id);
  const self = placements.find(placement => placement.character_id === characterId && !placement.parent_object_id);
  if (!self || self.kind === 'object') reject(400, 'Этого существа нет на сцене.');
  const manager = await canManage(q, member, userId);
  if (!manager && !(await canManageCharacter(q, member, userId, self.owner_user_id, self.character_id))) reject(403, 'Действует тот, чьё это существо, или мастер.');
  const unable = incapacitatedReason(await loadConditionState(q, campaignId, characterId));
  if (unable) reject(400, `${self.name} не может действовать: ${unable}.`);
  return { self, placements, manager };
}

export function registerStealthRoutes(ctx: TableContext) {
  const { actionEconomy, app, auth, db, membership } = ctx;

  app.post<{ Params: SceneParams; Body: { characterId: string; using?: 'action' | 'bonus' } }>(
    '/campaigns/:campaignId/scenes/:sceneId/hide',
    { schema: { params: sceneParams, body: stealthBody } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { characterId, using } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const scene = await getScene(q, campaignId, sceneId);
        const { self, placements, manager } = await stealthActor(q, member, userId, campaignId, scene, characterId);
        const sight = await sceneSight(q, campaignId, scene, placements);
        const fallen = await deadCreatures(q, campaignId, placements.map(placement => placement.character_id));
        const square = (entry: Placement) => ({ x: entry.world_x, z: entry.world_z, size: footprintCells(entry.size) });
        for (const watcher of placements) {
          if (watcher.kind === 'object' || watcher.parent_object_id || watcher.hidden || watcher.id === self.id) continue;
          if (!opposed(watcher, self) || fallen.has(watcher.character_id)) continue;
          if (incapacitatedReason(await loadConditionState(q, campaignId, watcher.character_id))) continue;
          const seen = seenFrom(sight, watcher, self.world_x, self.world_z);
          if (seen === null) continue;
          const others = placements.filter(entry => entry.kind !== 'object' && !entry.parent_object_id && entry.id !== watcher.id && entry.id !== self.id);
          const cover = coverBetween(square(watcher), square(self), sight.sightWalls, others.map(square));
          if (seesClearly(seen, cover)) {
            reject(400, `Не спрятаться: «${watcher.name}» ясно видит «${self.name}» — нужны тень, темнота, туман или укрытие.`);
          }
        }
        await actionEconomy.spend(q, campaignId, characterId, using ?? 'action', { kind: 'other', haste: true }, { enforce: await actionEconomy.enforceFor(q, campaignId, manager), sceneId });
        const secret = placementRelations(self)?.withParty(self.character_id) !== 'ally';
        const rolled = await rollCheckFor(ctx, q, campaignId, userId, characterId, 'skill', 'stealth', `Скрытность: ${self.name}`, secret);
        await revealHidden(q, campaignId, characterId);
        await q.query(
          `INSERT INTO character_effects (campaign_id, character_id, effect_code, parameters) VALUES ($1,$2,'hidden',$3::jsonb)`,
          [campaignId, characterId, JSON.stringify({ total: rolled.total, sceneId })],
        );
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        return { name: self.name, total: rolled.total, roll: rolled.roll, secret };
      });

      void notifyCampaign(ctx, campaignId, { type: 'rolls' });
      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      void notifyCampaign(ctx, campaignId, { type: 'character', characterId });
      void notify(ctx, campaignId, sceneId);
      if (!result.secret) void notifyCampaign(ctx, campaignId, { type: 'float', characterId, text: 'спрятался', tone: 'info' });
      return { hidden: true, total: result.total, roll: result.roll };
    },
  );

  app.post<{ Params: SceneParams; Body: { characterId: string } }>(
    '/campaigns/:campaignId/scenes/:sceneId/unhide',
    { schema: { params: sceneParams, body: objectSchema({ characterId: uuid }) } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { characterId } = request.body;
      const left = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const scene = await getScene(q, campaignId, sceneId);
        const placements = await loadPlacements(q, campaignId, scene.id);
        const self = placements.find(placement => placement.character_id === characterId);
        if (!self) reject(400, 'Этого существа нет на сцене.');
        if (!(await canManage(q, member, userId)) && !(await canManageCharacter(q, member, userId, self.owner_user_id, self.character_id))) {
          reject(403, 'Выйти из тени может тот, чьё это существо, или мастер.');
        }
        const was = await revealHidden(q, campaignId, characterId);
        if (was) await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        return was;
      });
      if (left) announceRevealed(ctx, campaignId, characterId, sceneId);
      return { hidden: false };
    },
  );

  app.post<{ Params: SceneParams; Body: { characterId: string; using?: 'action' | 'bonus' } }>(
    '/campaigns/:campaignId/scenes/:sceneId/search',
    { schema: { params: sceneParams, body: stealthBody } },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { characterId, using } = request.body;

      const result = await db.transaction(async q => {
        const member = await membership(q, campaignId, userId, true);
        const scene = await getScene(q, campaignId, sceneId);
        const { self, placements, manager } = await stealthActor(q, member, userId, campaignId, scene, characterId);
        await actionEconomy.spend(q, campaignId, characterId, using ?? 'action', { kind: 'other' }, { enforce: await actionEconomy.enforceFor(q, campaignId, manager), sceneId });
        const reasons = await obscuredSight(q, campaignId, sceneId, characterId);
        const rolled = await rollCheckFor(ctx, q, campaignId, userId, characterId, 'skill', 'perception', `Поиск: ${self.name}`, false, true, null, reasons);
        const found = await detectAround(q, campaignId, scene, characterId, rolled.total);
        const hiddenMap = await hiddenStealth(q, campaignId, placements.filter(placement => placement.kind !== 'object').map(placement => placement.character_id));
        if (hiddenMap.size) {
          const sight = await sceneSight(q, campaignId, scene, placements);
          for (const placement of placements) {
            const total = hiddenMap.get(placement.character_id);
            if (total === undefined || placement.id === self.id || !opposed(self, placement)) continue;
            if (await spots(q, campaignId, sight, self, placement, total, new Map(), rolled.total)) {
              await revealHidden(q, campaignId, placement.character_id);
              found.push(`«${placement.name}»`);
            }
          }
        }
        if (found.length) await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        return { name: self.name, total: rolled.total, roll: rolled.roll, found };
      });

      void notifyCampaign(ctx, campaignId, { type: 'rolls' });
      void notifyCampaign(ctx, campaignId, { type: 'initiative', sceneId });
      announceFound(ctx, campaignId, result.name, result.found);
      return { total: result.total, roll: result.roll, found: result.found };
    },
  );
}
