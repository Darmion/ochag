import type { Queryable } from '../../db.ts';
import { knownInvocations } from '../../../../../packages/domain/character/class-features.ts';
import { loadStates, lightOf } from './object-states.ts';
import { placementRelations, placementFactions, viewerRights } from '../../campaign/factions.ts';
import { type WallSegment, visibleCells } from '../../../../../packages/domain/map/los.ts';
import { resolveVision } from '../../../../../packages/domain/map/vision.ts';
import { type SeenLight, betterSeen, DEVILS_SIGHT_FEET, seenThrough, type LightLevel, BASE_LIGHT, inLightCone, lightFrom } from '../../../../../packages/domain/map/light.ts';
import { weatherRules } from '../../../../../packages/domain/world/clock.ts';
import { occupiedCells, footprintCells } from '../../../../../packages/domain/map/footprint.ts';

import { type CellSet, packCell } from './board.ts';
import { blockingPlacements } from './placements.ts';
import type { Illumination, Placement } from '../shared.ts';

export function wallSeen(scene: any, explored: CellSet, wall: { x1: number; z1: number; x2: number; z2: number }) {
  const x1 = Number(wall.x1), z1 = Number(wall.z1);
  const dx = Number(wall.x2) - x1, dz = Number(wall.z2) - z1;
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length * 2));
  const nx = length ? (-dz / length) * 0.3 : 0.3;
  const nz = length ? (dx / length) * 0.3 : 0.3;
  for (let step = 0; step <= steps; step++) {
    const x = x1 + (dx * step) / steps;
    const z = z1 + (dz * step) / steps;
    for (const [px, pz] of [[x + nx, z + nz], [x - nx, z - nz]] as const) {
      const col = Math.floor(px + scene.width_cells / 2);
      const row = Math.floor(pz + scene.height_cells / 2);
      if (col < 0 || row < 0 || col >= scene.width_cells || row >= scene.height_cells) continue;
      if (explored.has(row * scene.width_cells + col)) return true;
    }
  }
  return false;
}

export function seenThroughFog(scene: any, fog: CellSet, x: number, z: number, size: string | null | undefined) {
  return occupiedCells(scene, x, z, footprintCells(size)).some(cell => fog.has(cell.row * scene.width_cells + cell.col));
}

export function effectiveRadiusFeet(
  scene: any,
  campaign: any,
  member: any,
  row: any,
): number | null {
  const houseRules = campaign.house_rules ?? {};
  const campaignBlindnessRadiusFeet = Number(houseRules?.blindness?.radiusFeet ?? 5);

  const vision = resolveVision({
    campaignFogEnabled: campaign.fog_enabled,
    playerFogDisabledByGm: member.fog_disabled_by_gm,
    mayChooseAlliedVision: member.may_choose_allied_vision,
    selectedVision: member.selected_vision,
    blinded: row.blinded,
    campaignBlindnessRadiusFeet,
    blindnessRadiusOverrideFeet: row.override_radius,
    allowAlliesWhileBlindByGm: row.override_allies,
  });

  if (vision.blindnessRadiusFeet !== null) return vision.blindnessRadiusFeet;

  const fogLimit = weatherRules(scene.weather).sightFeet;
  const base = scene.default_vision_radius_feet;
  const darkvision = row.darkvision_feet !== null && row.darkvision_feet !== undefined ? Number(row.darkvision_feet) : 0;

  if (base === null) return fogLimit;

  const radius = Math.max(base, darkvision);
  return fogLimit === null ? radius : Math.min(radius, fogLimit);
}

export function isBlindSource(campaign: any, member: any, row: any) {
  const houseRules = campaign.house_rules ?? {};
  return resolveVision({
    campaignFogEnabled: campaign.fog_enabled,
    playerFogDisabledByGm: member.fog_disabled_by_gm,
    mayChooseAlliedVision: member.may_choose_allied_vision,
    selectedVision: member.selected_vision,
    blinded: row.blinded,
    campaignBlindnessRadiusFeet: Number(houseRules?.blindness?.radiusFeet ?? 5),
    blindnessRadiusOverrideFeet: row.override_radius,
    allowAlliesWhileBlindByGm: row.override_allies,
  }).blindnessRadiusFeet !== null;
}

export async function partyVisionOn(q: Queryable, campaignId: string) {
  const flag = (
    await q.query(`SELECT value FROM campaign_rules WHERE campaign_id=$1 AND kind='flag' AND key='party_vision'`, [campaignId])
  ).rows[0];
  return !flag || flag.value === true;
}

export async function visionSources(q: Queryable, campaignId: string, member: any, userId: string, placements: Placement[], party: boolean | { characterId: string } = false) {
  const creatures = placements.filter(placement => placement.kind === 'character' || placement.kind === 'npc');
  if (typeof party === 'object') return creatures.filter(placement => placement.character_id === party.characterId && !placement.parent_object_id);
  if (party) {
    return creatures.filter(placement => {
      const relations = placementRelations(placement);
      const partyId = relations?.matrix.party;
      return Boolean(partyId) && placementFactions(placement).includes(partyId!) && relations!.matrix.factions.get(partyId!)!.rights.includes('shared-vision');
    });
  }
  const alliesSelected = (await partyVisionOn(q, campaignId)) || (member.selected_vision === 'allies' && member.may_choose_allied_vision);
  const rights = alliesSelected
    ? await viewerRights(q, campaignId, userId, creatures.map(placement => ({ id: placement.character_id, kind: placement.kind, disposition: placement.disposition, factions_explicit: placement.factions_explicit })))
    : null;
  return creatures.filter(placement => placement.owner_user_id === userId || Boolean(rights?.shares(placement.character_id, 'shared-vision')));
}

export async function computeVisibleIndexSet(
  q: Queryable,
  campaignId: string,
  scene: any,
  campaign: any,
  member: any,
  userId: string,
  walls: WallSegment[],
  placements: Placement[],
  party: boolean | { characterId: string } = false,
): Promise<Map<number, SeenLight>> {
  const sources = await visionSources(q, campaignId, member, userId, placements, party);

  const visible = new Map<number, SeenLight>();
  if (!sources.length) return visible;
  const see = (index: number, seen: SeenLight) => visible.set(index, betterSeen(visible.get(index), seen));

  const blockers = await blockingPlacements(q, campaignId, scene, placements, 'sight');
  const sightWalls = [...walls, ...blockers.flatMap(blocker => blocker.edges)];

  const senses = new Map(
    (
      await q.query(
        `SELECT c.id,
                  GREATEST(COALESCE((c.sheet_extra->>'darkvisionFeet')::float8, 0), CASE WHEN EXISTS (
                  SELECT 1 FROM character_effects dv WHERE dv.campaign_id=c.campaign_id AND dv.character_id=c.id AND dv.active AND dv.effect_code='darkvision_spell'
                ) THEN 60 ELSE 0 END, COALESCE((
                  SELECT MAX((sm.parameters->'values'->>'feet')::float8) FROM character_effects sm
                  WHERE sm.campaign_id=c.campaign_id AND sm.character_id=c.id AND sm.active AND sm.effect_code='spell_mod'
                    AND sm.parameters->>'kind'='senses' AND sm.parameters->'values'->>'sense'='darkvision'
                ), 0)) AS darkvision_feet,
                  ove.blindness_radius_feet::float8 AS override_radius,
                  ove.allow_allies_while_blind AS override_allies,
                  EXISTS (
                    SELECT 1 FROM character_effects e
                    WHERE e.campaign_id=c.campaign_id
                      AND e.character_id=c.id
                      AND e.effect_code='blinded'
                      AND e.active
                  ) AS blinded
           FROM characters c
           LEFT JOIN character_vision_overrides ove
             ON ove.campaign_id=c.campaign_id AND ove.character_id=c.id
           WHERE c.campaign_id=$1 AND c.id = ANY($2::uuid[])`,
        [campaignId, [...new Set(sources.map(source => source.character_id))]],
      )
    ).rows.map(row => [row.id as string, row]),
  );

  const dims = { widthCells: scene.width_cells, heightCells: scene.height_cells };
  const illumination = await illuminationOf(q, campaignId, scene, placements, sightWalls);
  const shade = (index: number): SeenLight => (illumination[index] === 2 ? 'bright' : illumination[index] === 1 ? 'dim' : 'dark');
  const devilish = await devilsSightIds(q, campaignId, [...new Set(sources.map(source => source.character_id))]);

  for (const source of sources) {
    const row = senses.get(source.character_id) ?? {};
    const radiusFeet = effectiveRadiusFeet(scene, campaign, member, row);
    const darkvisionFeet = row.darkvision_feet ? Number(row.darkvision_feet) : 0;
    const devilsSightFeet = devilish.has(source.character_id) ? DEVILS_SIGHT_FEET : 0;
    const blind = isBlindSource(campaign, member, row);

    for (const cell of visibleCells({ x: source.world_x, z: source.world_z }, radiusFeet, scene.feet_per_unit, dims, sightWalls)) {
      const index = packCell(scene, cell.x, cell.z);
      if (blind) {
        see(index, 'dim');
        continue;
      }
      const feet = Math.hypot(cell.x - source.world_x, cell.z - source.world_z) * scene.feet_per_unit;
      const seen = seenThrough(illumination[index] as LightLevel, feet, darkvisionFeet, { magicalDarkness: illumination.darkness.has(index), devilsSightFeet });
      if (seen) see(index, seen);
    }

    for (const own of occupiedCells(scene, source.world_x, source.world_z, footprintCells(source.size))) {
      const index = own.row * scene.width_cells + own.col;
      see(index, seenThrough(illumination[index] as LightLevel, 0, darkvisionFeet, { magicalDarkness: illumination.darkness.has(index), devilsSightFeet }) ?? 'dark');
    }
  }

  // A blocker is visible from outside: its cell counts as seen when a neighbour is, otherwise doors sat in the fog.
  for (const blocker of blockers) {
    const own = new Set(blocker.cells.map(cell => cell.row * scene.width_cells + cell.col));
    for (const cell of blocker.cells) {
      const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .map(([dc, dr]) => ({ col: cell.col + dc!, row: cell.row + dr! }))
        .filter(next => next.col >= 0 && next.row >= 0 && next.col < scene.width_cells && next.row < scene.height_cells)
        .map(next => next.row * scene.width_cells + next.col)
        .filter(index => !own.has(index));
      if (neighbours.some(index => visible.has(index))) see(cell.row * scene.width_cells + cell.col, shade(cell.row * scene.width_cells + cell.col));
    }
  }

  return visible;
}

export async function illuminationOf(q: Queryable, campaignId: string, scene: any, placements: Placement[], sightWalls: WallSegment[]): Promise<Illumination> {
  const cap = weatherRules(scene.weather).obscured ? 1 : 2;
  const lighting = (scene.effective_lighting ?? scene.lighting) as keyof typeof BASE_LIGHT;
  const base = Math.min(BASE_LIGHT[lighting] ?? 2, cap) as LightLevel;
  const levels = new Uint8Array(scene.width_cells * scene.height_cells).fill(base);
  const withDarkness = async (): Promise<Illumination> => {
    const darkness = await magicalDarknessCells(q, campaignId, scene, placements);
    for (const index of darkness) levels[index] = 0;
    return Object.assign(levels, { darkness });
  };
  if (base === 2) return withDarkness();

  const states = await loadStates(q, campaignId, placements.map(placement => placement.character_id));
  for (const placement of placements) {
    const light = lightOf(states.get(placement.character_id));
    if (!light) continue;

    const origin = { x: placement.world_x, z: placement.world_z };
    const direction = light.cone ? facingOf(placement, placements) : null;
    for (const cell of visibleCells(
      origin,
      light.bright + light.dim,
      scene.feet_per_unit,
      { widthCells: scene.width_cells, heightCells: scene.height_cells },
      sightWalls,
    )) {
      if (direction !== null && !inLightCone(cell.x - origin.x, cell.z - origin.z, direction)) continue;
      const index = packCell(scene, cell.x, cell.z);
      const level = lightFrom(Math.hypot(cell.x - origin.x, cell.z - origin.z) * scene.feet_per_unit, light);
      if (level !== null && Math.min(level, cap) > levels[index]!) levels[index] = Math.min(level, cap);
    }
  }
  const glows = new Map<string, { bright: number; dim: number }>();
  for (const row of (await q.query(
    `SELECT character_id, effect_code, parameters FROM character_effects WHERE campaign_id=$1 AND effect_code IN ('holy_nimbus', 'spell_light') AND active AND character_id = ANY($2::uuid[])`,
    [campaignId, placements.map(placement => placement.character_id)],
  )).rows as Array<{ character_id: string; effect_code: string; parameters: any }>) {
    const glow = row.effect_code === 'holy_nimbus' ? { bright: 30, dim: 30 } : { bright: Number(row.parameters?.bright ?? 0), dim: Number(row.parameters?.dim ?? 0) };
    const before = glows.get(row.character_id);
    if (!before || glow.bright + glow.dim > before.bright + before.dim) glows.set(row.character_id, glow);
  }
  for (const placement of placements) {
    const glow = glows.get(placement.character_id);
    if (!glow || glow.bright + glow.dim <= 0) continue;
    const origin = { x: placement.world_x, z: placement.world_z };
    const shine = { ...glow, cone: false };
    for (const cell of visibleCells(origin, glow.bright + glow.dim, scene.feet_per_unit, { widthCells: scene.width_cells, heightCells: scene.height_cells }, sightWalls)) {
      const index = packCell(scene, cell.x, cell.z);
      const level = lightFrom(Math.hypot(cell.x - origin.x, cell.z - origin.z) * scene.feet_per_unit, shine);
      if (level !== null && Math.min(level, cap) > levels[index]!) levels[index] = Math.min(level, cap);
    }
  }

  return withDarkness();
}

export async function magicalDarknessCells(q: Queryable, campaignId: string, scene: any, placements: Placement[]): Promise<Set<number>> {
  const cells = new Set<number>();
  if (!placements.length) return cells;
  const rows = (await q.query(
    `SELECT character_id, parameters FROM character_effects WHERE campaign_id=$1 AND effect_code='spell_darkness' AND active AND character_id = ANY($2::uuid[])`,
    [campaignId, placements.map(placement => placement.character_id)],
  )).rows as Array<{ character_id: string; parameters: any }>;
  for (const row of rows) {
    const radius = Number(row.parameters?.radius ?? 0) / scene.feet_per_unit;
    if (!(radius > 0)) continue;
    for (const holder of placements.filter(placement => placement.character_id === row.character_id)) {
      for (let rowIndex = 0; rowIndex < scene.height_cells; rowIndex += 1) {
        const z = rowIndex - scene.height_cells / 2 + 0.5;
        if (Math.abs(z - holder.world_z) > radius + 0.5) continue;
        for (let col = 0; col < scene.width_cells; col += 1) {
          const x = col - scene.width_cells / 2 + 0.5;
          if (Math.hypot(x - holder.world_x, z - holder.world_z) <= radius + 1e-9) cells.add(rowIndex * scene.width_cells + col);
        }
      }
    }
  }
  return cells;
}

export async function devilsSightIds(q: Queryable, campaignId: string, characterIds: string[]): Promise<Set<string>> {
  if (!characterIds.length) return new Set();
  const rows = (await q.query('SELECT id, sheet_extra FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[])', [campaignId, characterIds])).rows;
  return new Set(rows.filter(row => knownInvocations(row.sheet_extra).includes('devils-sight')).map(row => row.id as string));
}

export function facingOf(placement: Placement, placements: Placement[]) {
  let total = Number(placement.rotation_y ?? 0);
  let parentId = placement.parent_object_id;
  for (let guard = 0; parentId && guard < 10; guard += 1) {
    const parent = placements.find(entry => entry.id === parentId);
    if (!parent) break;
    total += Number(parent.rotation_y ?? 0);
    parentId = parent.parent_object_id;
  }
  return ((total % 360) + 360) % 360;
}

// Whatever is attached to an invisible object is invisible too, otherwise a goblin's torch would give it away through the fog.
export function visiblePlacementIds(
  scene: any,
  placements: Placement[],
  isControlled: (placement: Placement) => boolean,
  fog: CellSet | null,
): Set<string> {
  const byId = new Map(placements.map(placement => [placement.id, placement]));
  const memo = new Map<string, boolean>();

  function visible(placement: Placement, depth: number): boolean {
    const cached = memo.get(placement.id);
    if (cached !== undefined) return cached;

    let result: boolean;

    if (isControlled(placement)) result = true;
    else if (placement.hidden) result = false;
    else if (placement.shared) result = true;
    else if (fog && !seenThroughFog(scene, fog, placement.world_x, placement.world_z, placement.size)) result = false;
    else {
      const parent = placement.parent_object_id ? byId.get(placement.parent_object_id) : undefined;
      result = !parent || depth > 8 || visible(parent, depth + 1);
    }

    memo.set(placement.id, result);
    return result;
  }

  return new Set(placements.filter(placement => visible(placement, 0)).map(placement => placement.id));
}
