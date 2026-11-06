import { ENERGY_TYPES, type SPELL_EFFECTS } from './rules.ts';
import { reject } from '../shared.ts';
import { enchantedWeapon } from '../combat/attack.ts';
import { addCondition, loadConditionState, removeCondition } from '../../rules/conditions.ts';
import { CHECK_ABILITY_LABELS_RU, type CheckAbility, initiativeRoll } from '../rolls/modifiers.ts';
import { findMonster } from '../../../../../packages/domain/world/bestiary.ts';
import { summonProblem, conjureCount, shapeProblem, type SpellSummon, type SpellShape } from '../../../../../packages/domain/spells/summons.ts';
import { getScene } from '../scene/board.ts';
import { loadPlacements } from '../scene/placements.ts';
import { spellRangeFeet } from '../../../../../packages/domain/spells/spell-mechanics.ts';
import { footprintCells, occupiedCells } from '../../../../../packages/domain/map/footprint.ts';
import { vanishSummonsOf } from '../../rules/summons.ts';
import { startOf, freeSpotsAround, insertPlacement } from '../../campaign/encounter-routes.ts';
import { copyNames, createFromSnapshot } from '../scene/object-copies.ts';
import { monsterSnapshot } from '../../campaign/bestiary-routes.ts';
import { insertRoll } from '../rolls/dice.ts';
import { relationsFor } from '../../campaign/factions.ts';
import { ownBody, takeBeastBody } from '../../rules/shape-forms.ts';
import { parseExpression, hasTokens } from '../../../../../packages/domain/dice/expression.ts';
import { spellCylinderFeet } from '../../../../../packages/domain/spells/spell-riders.ts';
import type { Queryable } from '../../db.ts';
import type { CastBody } from './cast.ts';
import type { CastSetup } from './prepare.ts';

export type CastTarget = { id: string; name: string; kind: string; armor_class: number };
export type CastOutcome = {
  userId: string;
  campaignId: string;
  characterId: string;
  sceneId: string | undefined;
  body: CastBody;
  setup: CastSetup;
  targets: CastTarget[];
  results: Array<Record<string, unknown>>;
  held: { concentrationOf?: string };
  castingAbility: string;
  zoneTemplate: any;
  dc: any;
};

export async function castSpellEffect(q: Queryable, cast: CastOutcome, effect: NonNullable<(typeof SPELL_EFFECTS)[string]>) {
  const { body, targets, characterId, campaignId, held, castingAbility, results } = cast;
  const { known, spellName, character, effectiveLevel, lasting } = cast.setup;
  const index = known.srd_index as string;
  if (index === 'protection-from-energy' && !(ENERGY_TYPES as readonly string[]).includes(body.element ?? '')) {
    reject(400, `«${spellName}»: выберите стихию — кислота, холод, огонь, электричество или звук.`);
  }
  const aimed = targets.find(target => target.id !== characterId && target.kind !== 'object');
  if (index === 'true-strike' && !aimed) reject(400, `«${spellName}»: выберите цель — по ней будет преимущество.`);
  const who = effect.self || !targets.length ? [{ id: characterId, name: character.name as string }] : targets.filter(target => target.kind !== 'object');
  if (index === 'warding-bond' && who.some(target => target.id === characterId)) reject(400, `«${spellName}»: выберите другое существо — связь не на себя.`);
  for (const target of who) {
    const weapon = index === 'shillelagh' || index === 'magic-weapon' ? await enchantedWeapon(q, campaignId, target.id, index, spellName) : null;
    const bonus = index === 'magic-weapon' ? (effectiveLevel >= 6 ? 3 : effectiveLevel >= 4 ? 2 : 1) : 0;
    await addCondition(q, campaignId, target.id, effect.code, {
      source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellName, spellLevel: effectiveLevel,
      remainingRounds: lasting(effect.rounds), durationRounds: lasting(effect.rounds), ...(effect.parameters ?? {}), ...held,
      ...(index === 'protection-from-energy' ? { damageType: body.element } : {}),
      ...(index === 'true-strike' && aimed ? { targetId: aimed.id, targetName: aimed.name } : {}),
      ...(weapon ? { weaponId: weapon.id, weaponName: weapon.name } : {}),
      ...(index === 'shillelagh' ? { ability: castingAbility } : {}),
      ...(bonus ? { bonus } : {}),
    });
    const existing = results.find(entry => entry.characterId === target.id);
    if (existing) existing.condition = true;
    else results.push({ characterId: target.id, name: target.name, condition: true });
    if (weapon) {
      const entry = results.find(row => row.characterId === target.id)!;
      entry.notes = [...((entry.notes as string[] | undefined) ?? []), bonus ? `«${weapon.name}» +${bonus}` : `«${weapon.name}»: к8, ${CHECK_ABILITY_LABELS_RU[castingAbility as CheckAbility] ?? castingAbility}`];
    }
  }
}

export async function castAid(q: Queryable, cast: CastOutcome, aid: string) {
  const { targets, campaignId, results } = cast;
  const { spellName } = cast.setup;
  for (const target of targets.filter(entry => entry.kind !== 'object')) {
    const state = await loadConditionState(q, campaignId, target.id);
    const row = (await q.query('SELECT hp_current FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, target.id])).rows[0];
    const note = (text: string) => {
      const existing = results.find(entry => entry.characterId === target.id);
      if (existing) existing.notes = [...((existing.notes as string[] | undefined) ?? []), text];
      else results.push({ characterId: target.id, name: target.name, notes: [text] });
    };
    if (aid === 'spare-the-dying') {
      if (state.codes.has('dead') || Number(row?.hp_current ?? 1) > 0) { note('не при смерти'); continue; }
      await addCondition(q, campaignId, target.id, 'stable', { source: 'spell', sourceName: spellName });
      await q.query('UPDATE characters SET death_successes=0, death_failures=0, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id]);
      note('стабилен');
    } else if (aid === 'revivify' || aid === 'raise-dead') {
      if (!state.codes.has('dead')) { note('не мёртв'); continue; }
      for (const code of ['dead', 'unconscious', 'stable']) await removeCondition(q, campaignId, target.id, code);
      await q.query('UPDATE characters SET hp_current=GREATEST(hp_current, 1), death_successes=0, death_failures=0, revision=revision+1 WHERE campaign_id=$1 AND id=$2', [campaignId, target.id]);
      note('снова жив: 1 хит');
    } else {
      if (await removeCondition(q, campaignId, target.id, 'petrified')) note('окаменение снято');
      else if (await removeCondition(q, campaignId, target.id, 'charmed')) note('очарование снято');
      else if (state.exhaustion > 0) {
        await q.query(`DELETE FROM character_effects WHERE campaign_id=$1 AND character_id=$2 AND active AND effect_code LIKE 'exhaustion\\_%'`, [campaignId, target.id]);
        if (state.exhaustion > 1) await addCondition(q, campaignId, target.id, `exhaustion_${state.exhaustion - 1}`, { source: 'spell', sourceName: spellName });
        note(`истощение: ${state.exhaustion} → ${state.exhaustion - 1}`);
      } else note('снимать нечего');
    }
  }
}

export async function castSummon(q: Queryable, cast: CastOutcome, summonRule: SpellSummon) {
  const { sceneId, body, campaignId, characterId, userId, held, results } = cast;
  const { spellName, effectiveLevel, character, spellRange } = cast.setup;
  if (!sceneId || !body.place) reject(400, `«${spellName}»: куда призвать — щелчок по карте.`);
  const beast = findMonster(body.beast ?? '');
  const problem = summonProblem(summonRule, beast, body.conjureOption ?? null);
  if (problem || !beast) reject(400, `«${spellName}»: ${problem ?? 'выберите зверя'}.`);
  const count = summonRule.kind === 'conjure-animals' ? conjureCount(body.conjureOption ?? 0, effectiveLevel) ?? 1 : 1;
  const scene = (await getScene(q, campaignId, sceneId!, true)) as any;
  const scenePlacements = await loadPlacements(q, campaignId, sceneId!);
  const me = scenePlacements.find(entry => entry.character_id === characterId && !entry.parent_object_id);
  if (!me) reject(400, `${character.name} не на этой сцене — призвать некуда.`);
  const reachFeet = spellRangeFeet(spellRange) ?? 30;
  const gap = Math.max(Math.abs(body.place!.x - me!.world_x), Math.abs(body.place!.z - me!.world_z)) * scene.feet_per_unit - footprintCells(me!.size) * scene.feet_per_unit / 2;
  if (gap > reachFeet + 1e-6) reject(400, `«${spellName}»: место дальше ${reachFeet} фт.`);
  if (summonRule.kind !== 'conjure-animals') await vanishSummonsOf(q, campaignId, characterId, summonRule.kind);
  const casterFactions = (await q.query('SELECT factions_explicit FROM characters WHERE campaign_id=$1 AND id=$2', [campaignId, characterId])).rows[0]?.factions_explicit === true
    ? (await q.query('SELECT faction_id FROM faction_members WHERE campaign_id=$1 AND character_id=$2', [campaignId, characterId])).rows.map(row => row.faction_id as string)
    : null;
  const disposition = character.kind === 'character' ? 'friendly' : character.disposition ?? 'hostile';
  const occupied = new Set(scenePlacements.flatMap(entry =>
    occupiedCells(scene, entry.world_x, entry.world_z, footprintCells(entry.size)).map(cell => `${cell.col}:${cell.row}`)));
  const n = footprintCells(beast!.size);
  const origin = startOf(scene, body.place!.x, body.place!.z, n);
  const base = `${beast!.nameRu} (${character.name})`.slice(0, 90);
  const taken = (await q.query('SELECT 1 FROM characters WHERE campaign_id=$1 AND name=$2 LIMIT 1', [campaignId, base])).rows[0];
  const names = count === 1 && !taken ? [base] : await copyNames(q, campaignId, base, count);
  const combat = (await q.query('SELECT 1 FROM initiative_entries WHERE campaign_id=$1 AND scene_id=$2 LIMIT 1', [campaignId, sceneId])).rows[0];
  let groupScore: number | null = null;
  for (const name of names) {
    const snapshot = monsterSnapshot(beast!, beast!.hp, disposition);
    const sheet = snapshot.character as Record<string, any>;
    sheet.owner_user_id = character.owner_user_id ?? null;
    sheet.sheet_extra = {
      ...(sheet.sheet_extra ?? {}),
      summon: { kind: summonRule.kind, casterId: characterId, casterName: character.name, spell: spellName },
      ...(summonRule.kind !== 'conjure-animals' ? { creatureType: 'фея' } : {}),
    };
    if (summonRule.kind === 'steed') sheet.intelligence = Math.max(6, Number(sheet.intelligence ?? 0));
    const id = await createFromSnapshot(q, campaignId, snapshot, name, userId);
    if (summonRule.kind === 'familiar') await q.query('DELETE FROM character_weapons WHERE campaign_id=$1 AND character_id=$2', [campaignId, id]);
    if (casterFactions) {
      await q.query('UPDATE characters SET factions_explicit=true WHERE campaign_id=$1 AND id=$2', [campaignId, id]);
      for (const factionId of casterFactions) {
        await q.query('INSERT INTO faction_members (campaign_id, faction_id, character_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [campaignId, factionId, id]);
      }
    }
    const fits = (col: number, row: number) => {
      for (let r = row; r < row + n; r += 1) for (let c = col; c < col + n; c += 1) {
        if (c < 0 || r < 0 || c >= scene.width_cells || r >= scene.height_cells || occupied.has(`${c}:${r}`)) return false;
      }
      return true;
    };
    const spot = fits(origin.col, origin.row) ? origin : freeSpotsAround(scene, origin, n, occupied, 1)[0];
    if (!spot) reject(400, 'На карте не хватает свободных клеток.');
    for (let r = spot!.row; r < spot!.row + n; r += 1) for (let c = spot!.col; c < spot!.col + n; c += 1) occupied.add(`${c}:${r}`);
    await insertPlacement(q, campaignId, sceneId!, id, {
      x: spot!.col + n / 2 - scene.width_cells / 2, y: 0, z: spot!.row + n / 2 - scene.height_cells / 2, rotationY: 0, scale: 1, snapToGrid: true, hidden: false,
    }, userId);
    await addCondition(q, campaignId, id, 'summoned', {
      source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellName, ...(summonRule.concentration ? held : {}),
    });
    if (combat) {
      const fresh = (await q.query(
        'SELECT id, name, dexterity, owner_user_id, level, class_name, sheet_extra, challenge_rating::float8 AS challenge_rating FROM characters WHERE campaign_id=$1 AND id=$2',
        [campaignId, id],
      )).rows[0];
      if (groupScore === null) {
        const rolled = initiativeRoll(fresh);
        groupScore = rolled.total;
        await insertRoll(q, campaignId, userId, id, `Инициатива: ${name}`.slice(0, 100), rolled.formula, rolled.results, rolled.modifier, rolled.total, false, null, rolled.outcome);
      }
      await q.query(
        'INSERT INTO initiative_entries (campaign_id, scene_id, character_id, name, score, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [campaignId, sceneId, id, name, groupScore, userId],
      );
    }
    results.push({ characterId: id, name, summoned: beast!.nameRu });
  }
  await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
}

export async function castShape(q: Queryable, cast: CastOutcome, shapeRule: SpellShape) {
  const { body, campaignId, characterId, targets, results, held } = cast;
  const { spellName } = cast.setup;
  const beast = findMonster(body.beast ?? '');
  if (!beast) reject(400, `«${spellName}»: выберите облик зверя.`);
  const sides = await relationsFor(q, campaignId, [characterId, ...targets.map(target => target.id)]);
  for (const target of targets) {
    if (target.kind === 'object') continue;
    const entry = (results.find(item => item.characterId === target.id) ?? (() => {
      const fresh: Record<string, unknown> = { characterId: target.id, name: target.name };
      results.push(fresh);
      return fresh;
    })()) as Record<string, any>;
    const own = target.id === characterId || (sides.factionsOf(characterId).length > 0 && sides.allies(characterId, target.id));
    if (shapeRule.kind === 'animal-shapes' && !own) { entry.notes = [...(entry.notes ?? []), 'не согласен — облик не принят']; continue; }
    if (entry.save?.success) continue;
    const row = (await q.query(
      `SELECT id, name, hp_current, hp_max, armor_class, speed_feet, size, level, challenge_rating::float8 AS challenge_rating,
                    strength, dexterity, constitution, intelligence, wisdom, charisma
             FROM characters WHERE campaign_id=$1 AND id=$2`,
      [campaignId, target.id],
    )).rows[0];
    const state = await loadConditionState(q, campaignId, target.id);
    if (!row || row.hp_current <= 0 || state.codes.has('dead')) { entry.notes = [...(entry.notes ?? []), 'при 0 хитов — не действует']; continue; }
    if (state.codes.has('wild_shape')) { entry.notes = [...(entry.notes ?? []), 'уже в зверином облике']; continue; }
    const problem = shapeProblem(shapeRule, beast!, row);
    if (problem) {
      if (targets.length === 1) reject(400, `«${spellName}» на «${target.name}»: ${problem}.`);
      entry.notes = [...(entry.notes ?? []), problem];
      continue;
    }
    const mental = shapeRule.kind === 'polymorph';
    await addCondition(q, campaignId, target.id, 'wild_shape', {
      source: 'spell', sourceCharacterId: characterId, sourceName: spellName, spellName, beast: beast!.index, beastName: beast!.nameRu,
      own: ownBody(row, mental), ...held,
    });
    await takeBeastBody(q, campaignId, target.id, beast!, mental);
    entry.shaped = beast!.nameRu;
  }
}

export async function castZone(q: Queryable, cast: CastOutcome) {
  const { campaignId, sceneId, zoneTemplate, dc, characterId, userId } = cast;
  const { mechanics, spellName, castPlan, spellText } = cast.setup;
  const formulaOk = !mechanics.damageFormula || (() => {
    const parsed = parseExpression(mechanics.damageFormula!);
    return parsed.ok && !hasTokens(parsed.expression);
  })();
  await q.query(
    `INSERT INTO scene_triggers (
             campaign_id, scene_id, kind, shape, x, z, direction, size_feet, name,
             check_kind, check_key, dc, damage_formula, damage_type, half_on_success,
             once, enabled, secret, on_turn, caster_id, created_by, height_feet
           ) VALUES ($1,$2,'enter',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,false,true,false,$15,$16,$17,$18)`,
    [
      campaignId, sceneId, zoneTemplate.shape, zoneTemplate.x, zoneTemplate.z, zoneTemplate.direction, zoneTemplate.size_feet,
      spellName.slice(0, 100),
      mechanics.save ? 'save' : null, mechanics.save, mechanics.save ? dc : null,
      formulaOk ? mechanics.damageFormula : null, mechanics.damageType, mechanics.halfOnSave,
      !mechanics.condition, characterId, userId,
      zoneTemplate.shape === 'circle' ? (castPlan ? castPlan.cylinderFeet : spellCylinderFeet(spellText.desc)) : null,
    ],
  );
}
