import type { Queryable } from '../../db.ts';
import { loadStates, isBlocking } from './object-states.ts';
import { footprintEdges } from '../../../../../packages/domain/map/blockers.ts';
import { teamControlledIds, attachRelations, relationsOf, teamControls } from '../../campaign/factions.ts';
import { abilityModifier } from '../../../../../packages/domain/dice/dice.ts';
import type { FormulaContext } from '../../../../../packages/domain/dice/formula.ts';
import { footprintCells, occupiedCells } from '../../../../../packages/domain/map/footprint.ts';

import type { TableContext } from '../context.ts';
import { canManage, type Placement, reject, type Rights } from '../shared.ts';

export async function blockingPlacements(q: Queryable, campaignId: string, scene: any, placements: Placement[], mode: 'sight' | 'move') {
  const candidates = placements.filter(placement => placement.kind === 'object');
  const states = await loadStates(q, campaignId, candidates.map(placement => placement.character_id));
  return candidates
    .filter(placement => isBlocking(states.get(placement.character_id), mode))
    .map(placement => {
      const n = footprintCells(placement.size);
      return {
        id: placement.id,
        edges: footprintEdges(placement.world_x, placement.world_z, n),
        cells: occupiedCells(scene, placement.world_x, placement.world_z, n),
        placement,
        n,
      };
    });
}

export async function rightsOf(q: Queryable, member: any, userId: string): Promise<Rights> {
  const sceneManager = await canManage(q, member, userId);
  const characterManager =
    member.owner_user_id === userId ||
    member.is_full_gm === true ||
    (
      await q.query(
        `SELECT 1 FROM member_permissions
           WHERE campaign_id=$1 AND user_id=$2 AND permission='characters.manage'`,
        [member.campaign_id, userId],
      )
    ).rows.length > 0;

  const editGrants = new Set(
    (
      await q.query(
        `SELECT character_id FROM character_access_grants
           WHERE campaign_id=$1 AND user_id=$2 AND level='edit'`,
        [member.campaign_id, userId],
      )
    ).rows.map(row => row.character_id as string),
  );
  for (const id of await teamControlledIds(q, member.campaign_id, userId)) editGrants.add(id);

  return { sceneManager, characterManager, editGrants };
}

export function controls(rights: Rights, userId: string, characterId: string, ownerUserId: string | null) {
  return rights.sceneManager ||
    rights.characterManager ||
    ownerUserId === userId ||
    rights.editGrants.has(characterId);
}

export async function loadPlacements(q: Queryable, campaignId: string, sceneId: string): Promise<Placement[]> {
  const rows = (
    await q.query(
      `SELECT p.id, p.character_id, p.parent_object_id, p.x, p.y, p.z,
                p.rotation_y::float8 AS rotation_y, p.scale::float8 AS scale,
                p.snap_to_grid, p.animation_name, p.hidden, p.revision,
                c.name, c.kind, c.disposition, c.factions_explicit, c.size, c.owner_user_id, c.shared,
                c.model_asset_id, c.image_asset_id, c.image_crop, c.merchant,
                GREATEST(COALESCE((c.sheet_extra->>'darkvisionFeet')::float8, 0), CASE WHEN EXISTS (
                  SELECT 1 FROM character_effects dv WHERE dv.campaign_id=c.campaign_id AND dv.character_id=c.id AND dv.active AND dv.effect_code='darkvision_spell'
                ) THEN 60 ELSE 0 END, COALESCE((
                  SELECT MAX((sm.parameters->'values'->>'feet')::float8) FROM character_effects sm
                  WHERE sm.campaign_id=c.campaign_id AND sm.character_id=c.id AND sm.active AND sm.effect_code='spell_mod'
                    AND sm.parameters->>'kind'='senses' AND sm.parameters->'values'->>'sense'='darkvision'
                ), 0)) AS darkvision_feet,
                COALESCE((
                  SELECT MAX(COALESCE((e.parameters->>'height')::float8, 0)) FROM character_effects e
                  WHERE e.campaign_id=p.campaign_id AND e.character_id=p.character_id AND e.active AND e.effect_code IN ('flying', 'dragon_wings')
                ), 0)::float8 AS altitude_feet
         FROM scene_objects p
         JOIN characters c
           ON c.campaign_id=p.campaign_id AND c.id=p.character_id
         WHERE p.campaign_id=$1 AND p.scene_id=$2
           AND NOT COALESCE((c.sheet_extra->'summon'->>'gone')::boolean, false)
         ORDER BY p.created_at, p.id`,
      [campaignId, sceneId],
    )
  ).rows as Placement[];

  resolveWorldPositions(rows);
  attachRelations(rows, await relationsOf(q, campaignId, rows.map(row => ({
    id: row.character_id, kind: row.kind, disposition: row.disposition, factions_explicit: row.factions_explicit,
  }))));
  return rows;
}

export async function hitPointsFor(
  q: Queryable,
  campaignId: string,
  placements: Placement[],
  userId: string,
  isControlled: (placement: Placement) => boolean,
  seesHp: (placement: Placement) => boolean = placement => placement.kind === 'character',
): Promise<Map<string, { current: number; max: number; temp: number }>> {
  const characterIds = [...new Set(placements.map(placement => placement.character_id))];
  const result = new Map<string, { current: number; max: number; temp: number }>();
  if (!characterIds.length) return result;

  const hp = new Map(
    (
      await q.query(
        `SELECT id, hp_current, hp_max, hp_temp FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])`,
        [campaignId, characterIds],
      )
    ).rows.map(row => [row.id as string, row]),
  );

  const hidden = new Set(
    (
      await q.query(
        `SELECT v.character_id FROM character_field_visibility v
           WHERE v.campaign_id=$1 AND v.character_id = ANY($2::uuid[])
             AND v.field_key IN ('hp_current', 'hp_max')
             AND (v.mode = 'hidden' OR NOT EXISTS (
               SELECT 1 FROM character_field_visibility_grants g
               WHERE g.campaign_id = v.campaign_id AND g.character_id = v.character_id
                 AND g.field_key = v.field_key AND g.user_id = $3
             ))`,
        [campaignId, characterIds, userId],
      )
    ).rows.map(row => row.character_id as string),
  );

  for (const placement of placements) {
    const row = hp.get(placement.character_id);
    if (!row) continue;

    const visible = isControlled(placement) || (placement.kind !== 'object' && !hidden.has(placement.character_id) && seesHp(placement));
    if (visible) result.set(placement.id, { current: row.hp_current, max: row.hp_max, temp: row.hp_temp });
  }

  return result;
}

export async function conditionsFor(
  q: Queryable,
  campaignId: string,
  placements: Placement[],
  userId: string,
  isControlled: (placement: Placement) => boolean,
): Promise<Map<string, string[]>> {
  const creatures = placements.filter(placement => placement.kind !== 'object');
  const result = new Map<string, string[]>();
  if (!creatures.length) return result;
  const controlled = new Set(creatures.filter(isControlled).map(placement => placement.character_id));

  const rows = (
    await q.query(
      `SELECT e.character_id, e.effect_code,
                EXISTS (
                  SELECT 1 FROM character_field_visibility v
                  WHERE v.campaign_id = e.campaign_id AND v.character_id = e.character_id
                    AND v.field_key = 'effect:' || e.id::text
                    AND (v.mode = 'hidden' OR NOT EXISTS (
                      SELECT 1 FROM character_field_visibility_grants g
                      WHERE g.campaign_id = v.campaign_id AND g.character_id = v.character_id
                        AND g.field_key = v.field_key AND g.user_id = $3
                    ))
                ) AS hidden
         FROM character_effects e
         WHERE e.campaign_id=$1 AND e.character_id = ANY($2::uuid[]) AND e.active
         ORDER BY e.effect_code`,
      [campaignId, [...new Set(creatures.map(placement => placement.character_id))], userId],
    )
  ).rows as Array<{ character_id: string; effect_code: string; hidden: boolean }>;

  for (const row of rows) {
    if (row.hidden && !controlled.has(row.character_id)) continue;
    const list = result.get(row.character_id) ?? [];
    if (!list.includes(row.effect_code)) list.push(row.effect_code);
    result.set(row.character_id, list);
  }
  return result;
}

export async function detachChildren(q: Queryable, campaignId: string, removed: Array<{ id: string; scene_id: string }>) {
  for (const sceneId of new Set(removed.map(entry => entry.scene_id))) {
    const removedIds = new Set(removed.filter(entry => entry.scene_id === sceneId).map(entry => entry.id));
    const placements = await loadPlacements(q, campaignId, sceneId);

    for (const child of placements) {
      if (!child.parent_object_id || !removedIds.has(child.parent_object_id) || removedIds.has(child.id)) continue;

      await q.query(
        `UPDATE scene_objects SET parent_object_id=NULL, x=$1, y=$2, z=$3, revision=revision+1
           WHERE id=$4`,
        [child.world_x, child.world_y, child.world_z, child.id],
      );
    }
  }
}

// Resolves every object, hidden ancestors included; visibility is filtered afterwards.
export function resolveWorldPositions(objects: any[]) {
  const byId = new Map(objects.map(o => [o.id, o]));
  const resolved = new Map<string, { x: number; y: number; z: number }>();

  function resolve(current: any, depth: number): { x: number; y: number; z: number } {
    const cached = resolved.get(current.id);
    if (cached) return cached;

    const parent = depth < 8 && current.parent_object_id
      ? byId.get(current.parent_object_id)
      : undefined;

    const base = parent ? resolve(parent, depth + 1) : { x: 0, y: 0, z: 0 };

    const position = {
      x: base.x + current.x,
      y: base.y + current.y,
      z: base.z + current.z,
    };

    resolved.set(current.id, position);
    return position;
  }

  for (const object of objects) {
    const position = resolve(object, 0);
    object.world_x = position.x;
    object.world_y = position.y;
    object.world_z = position.z;
  }
}

// You may attach only to what you control.
export async function assertValidParent(
  q: Queryable,
  campaignId: string,
  sceneId: string,
  parentId: string,
  member: any,
  userId: string,
) {
  const parent = (
    await q.query(
      `SELECT p.id, p.parent_object_id, p.character_id, c.owner_user_id
         FROM scene_objects p
         JOIN characters c ON c.campaign_id=p.campaign_id AND c.id=p.character_id
         WHERE p.campaign_id=$1 AND p.scene_id=$2 AND p.id=$3`,
      [campaignId, sceneId, parentId],
    )
  ).rows[0];

  if (!parent) reject(400, 'Объект, к которому идёт крепление, не найден на этой сцене.');

  if (!controls(await rightsOf(q, member, userId), userId, parent.character_id, parent.owner_user_id)) {
    reject(403, 'Нет прав на объект, к которому идёт крепление.');
  }

  // Recursion instead of a while-loop reassigning its parameter: the TypeScript 7 preview falsely reports that loop as circular.
  async function checkDepth(current: any, depth: number): Promise<void> {
    if (!current.parent_object_id) return;
    if (depth > 8) reject(400, 'Слишком длинная цепочка прикреплений.');

    const next = (
      await q.query(
        `SELECT id, parent_object_id FROM scene_objects WHERE campaign_id=$1 AND id=$2`,
        [campaignId, current.parent_object_id],
      )
    ).rows[0];

    if (!next) return;

    await checkDepth(next, depth + 1);
  }

  await checkDepth(parent, 0);
}

export async function wouldCreateCycle(
  q: Queryable,
  campaignId: string,
  objectId: string,
  candidateParentId: string,
): Promise<boolean> {
  async function step(current: string, depth: number): Promise<boolean> {
    if (current === objectId) return true;
    if (depth > 20) return true;

    const row = (
      await q.query<{ parent_object_id: string | null }>(
        `SELECT parent_object_id FROM scene_objects
           WHERE campaign_id=$1 AND id=$2`,
        [campaignId, current],
      )
    ).rows[0];

    const nextId = row?.parent_object_id ?? null;

    if (nextId === null) return false;

    return step(nextId, depth + 1);
  }

  return step(candidateParentId, 0);
}

export function sheetContext(character: any, proficiencyBonus: number | null): FormulaContext {
  return {
    str: abilityModifier(character.strength),
    dex: abilityModifier(character.dexterity),
    con: abilityModifier(character.constitution),
    int: abilityModifier(character.intelligence),
    wis: abilityModifier(character.wisdom),
    cha: abilityModifier(character.charisma),
    ...(proficiencyBonus !== null ? { prof: proficiencyBonus } : {}),
  };
}

export async function canManageCharacter(
  q: Queryable,
  member: any,
  userId: string,
  targetOwnerUserId: string | null,
  characterId?: string | null,
): Promise<boolean> {
  if (targetOwnerUserId === userId) return true;
  if (member.owner_user_id === userId || member.is_full_gm) return true;

  const { rows } = await q.query(
    `SELECT 1 FROM member_permissions
       WHERE campaign_id=$1 AND user_id=$2 AND permission='characters.manage'`,
    [member.campaign_id, userId],
  );
  if (rows.length > 0) return true;

  return Boolean(characterId) && (await teamControls(q, member.campaign_id, userId, characterId!));
}

export async function campaignManagerIds(ctx: TableContext, campaignId: string): Promise<string[]> {
  const { db } = ctx;
  return (await db.query(
    `SELECT m.user_id FROM campaign_members m JOIN campaigns c ON c.id = m.campaign_id
       WHERE m.campaign_id=$1 AND (c.owner_user_id = m.user_id OR m.is_full_gm OR EXISTS (
         SELECT 1 FROM member_permissions p WHERE p.campaign_id = m.campaign_id AND p.user_id = m.user_id AND p.permission = 'characters.manage'))`,
    [campaignId],
  )).rows.map(row => row.user_id as string);
}
