import type { Cover } from '../../../../../packages/domain/combat/targeting.ts';
import { getScene, sceneWalls } from '../scene/board.ts';
import { reject, type CastSpellParams } from '../shared.ts';
import { areaOf as templateArea, touches as templateTouches } from '../scene/scene-templates.ts';
import { spellCylinderFeet, projectileCount, distributeShots } from '../../../../../packages/domain/spells/spell-riders.ts';
import { loadPlacements, blockingPlacements } from '../scene/placements.ts';
import { nearSideOfObstruction } from '../../../../../packages/domain/map/blockers.ts';
import { areaCovers } from '../combat/cover.ts';
import { guardFriendlyFire } from '../../campaign/factions.ts';
import { spellRangeFeet } from '../../../../../packages/domain/spells/spell-mechanics.ts';
import { attackSituation } from '../combat/attack.ts';
import { rollSaveAgainst } from '../rolls/checks.ts';
import type { TableContext } from '../context.ts';
import type { Queryable } from '../../db.ts';
import type { CastBody } from './cast.ts';
import type { CastSetup } from './prepare.ts';
import type { CastDice } from './cast-dice.ts';

export async function aimCast(ctx: TableContext, q: Queryable, userId: string, params: CastSpellParams, body: CastBody, setup: CastSetup, dice: CastDice) {
  const { campaignId, characterId } = params;
  const { targetIds, templateId, sceneId, hidden } = body;
  const { damageFormula, spellRange, spellName, character, castPlan, mechanics, spellText, riders, metamagic, projectiles, effectiveLevel } = setup;
  const { resolvedDamage } = dice;

  const targets: Array<{ id: string; name: string; kind: string; armor_class: number }> = [];
  const wanted = new Set(targetIds ?? []);
  let zoneTemplate: any = null;
  let areaCover = new Map<string, Cover>();
  let areaBlocked: { x: number; z: number } | null = null;
  if (templateId && sceneId) {
    const scene = await getScene(q, campaignId, sceneId);
    const template = (await q.query('SELECT * FROM scene_templates WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, templateId])).rows[0];
    if (!template) reject(404, 'Области нет.');
    zoneTemplate = template;
    const area = templateArea(template, scene.feet_per_unit);
    const cylinder = castPlan ? castPlan.cylinderFeet : spellCylinderFeet(spellText.desc);
    if (cylinder !== null && area.shape === 'circle') area.height = cylinder / scene.feet_per_unit;
    const placements = await loadPlacements(q, campaignId, sceneId);
    const caster = placements.find(entry => entry.character_id === characterId && !entry.parent_object_id);
    if (caster) {
      const obstacles = [...await sceneWalls(q, campaignId, sceneId, 'move'), ...(await blockingPlacements(q, campaignId, scene, placements, 'move')).flatMap(blocker => blocker.edges)];
      const near = nearSideOfObstruction({ x: caster.world_x, z: caster.world_z }, { x: area.x, z: area.z }, obstacles);
      if (near) {
        area.x = near.x;
        area.z = near.z;
        areaBlocked = near;
        template.x = near.x;
        template.z = near.z;
        await q.query('UPDATE scene_templates SET x=$4, z=$5 WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, templateId, near.x, near.z]);
      }
    }
    areaCover = await areaCovers(q, campaignId, scene, { x: area.x, z: area.z }, placements);
    for (const placement of placements) {
      if (placement.kind !== 'object' && templateTouches(area, scene, placement) && areaCover.get(placement.character_id) !== 'total') {
        wanted.add(placement.character_id);
      }
    }
  }
  for (const targetId of wanted) {
    const row = (await q.query('SELECT id, name, kind, armor_class FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, targetId])).rows[0] as any;
    if (!row) reject(404, 'Цель не найдена.');
    if (row.kind !== 'object' || resolvedDamage || riders.some(rider => rider.kind === 'light' || rider.kind === 'darkness')) targets.push(row);
  }
  if (body.warnFriendly) {
    await guardFriendlyFire(q, campaignId, characterId, [...(targetIds ?? []), ...(body.shots ?? [])], Boolean(mechanics.attack || mechanics.save || damageFormula));
  }
  const baseRange = spellRangeFeet(spellRange);
  const rangeFeet = metamagic === 'distant' && baseRange !== null ? (/^(touch|касани)/i.test((spellRange ?? '').trim()) ? 30 : baseRange * 2) : baseRange;
  if (sceneId && rangeFeet !== null && !mechanics.attack) {
    for (const targetId of targetIds ?? []) {
      if (targetId !== characterId) {
        await attackSituation(q, campaignId, sceneId, characterId, targetId, { kind: 'spell', name: spellName, ranged: false, rangeFeet, rangeOnly: true });
      }
    }
  }

  const harmful = Boolean(mechanics.attack || mechanics.save || damageFormula);
  const wardedOff: Array<{ id: string; name: string }> = [];
  if (harmful) {
    for (const target of [...targets]) {
      if (!(targetIds ?? []).includes(target.id) || target.id === characterId) continue;
      const ward = (
        await q.query(`SELECT parameters FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='sanctuary' AND active LIMIT 1`, [campaignId, target.id])
      ).rows[0] as { parameters: any } | undefined;
      if (!ward || ward.parameters?.sourceCharacterId === characterId) continue;
      const save = await rollSaveAgainst(ctx, q, campaignId, userId, characterId, 'wisdom', Number(ward.parameters?.dc ?? 13), `Спасбросок МДР против «Убежища» — ${character.name}`.slice(0, 100), hidden ?? false, null, [], { magic: true });
      if (save.success) continue;
      targets.splice(targets.indexOf(target), 1);
      wardedOff.push({ id: target.id, name: target.name });
    }
    await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND effect_code='sanctuary' AND active`, [campaignId, characterId]);
  }
  const shotCount = projectiles ? projectileCount(projectiles, effectiveLevel, character.level ?? null) : 1;
  const shotIds = projectiles ? distributeShots(shotCount, targets.map(target => target.id), body.shots) : null;
  if (shotIds && !Array.isArray(shotIds)) reject(400, shotIds.error);
  const volley = Array.isArray(shotIds) ? shotIds.map(id => targets.find(target => target.id === id)!) : targets;

  return {
    targets, zoneTemplate, areaCover, areaBlocked, rangeFeet, wardedOff, volley,
  };
}

export type CastAim = Awaited<ReturnType<typeof aimCast>>;
