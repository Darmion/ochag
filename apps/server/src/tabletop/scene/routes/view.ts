import { loadDrawings } from '../scene-drawings.ts';
import { loadPins } from '../scene-pins.ts';
import { loadStates, stateView } from '../object-states.ts';
import { deadCreatures } from '../../combat/loot-routes.ts';
import { viewerRights, placementRelations, placementFactions } from '../../../campaign/factions.ts';
import { purgeGoneSummons } from '../../../rules/summons.ts';
import { loadCounters } from '../scene-counters.ts';
import { areaOf, loadTemplates } from '../scene-templates.ts';
import { inAreaAt } from '../../../../../../packages/domain/map/areas.ts';
import { loadTriggers } from '../scene-triggers.ts';
import type { WallSegment } from '../../../../../../packages/domain/map/los.ts';
import { type WallKind, blocksSight } from '../../../../../../packages/domain/map/walls.ts';
import type { SeenLight } from '../../../../../../packages/domain/map/light.ts';
import { weatherRules } from '../../../../../../packages/domain/world/clock.ts';
import { characterClassText, classOf } from '../../../../../../packages/domain/character/classes.ts';
import { stealthHiddenIds } from '../../combat/stealth.ts';
import type { TableContext } from '../../context.ts';
import { getScene, packCell, unpackCell } from '../board.ts';
import { flySpeedFrom } from '../movement.ts';
import { blockingPlacements, conditionsFor, controls, hitPointsFor, loadPlacements, rightsOf } from '../placements.ts';
import { computeVisibleIndexSet, illuminationOf, partyVisionOn, visiblePlacementIds, visionSources, wallSeen } from '../vision.ts';
import { wallForPlayer } from '../walls.ts';
import { canManage, type Placement, reject, sceneParams, type SceneParams, uuid, WALL_COLUMNS } from '../../shared.ts';

export function registerSceneViewRoute(ctx: TableContext) {
  const { app, auth, db, membership } = ctx;

  app.get<{ Params: SceneParams; Querystring: { viewAs?: string; fogAs?: 'party'; fogOf?: string } }>(
    '/campaigns/:campaignId/scenes/:sceneId',
    {
      schema: {
        params: sceneParams,
        querystring: { type: 'object', additionalProperties: false, properties: { viewAs: uuid, fogAs: { type: 'string', enum: ['party'] }, fogOf: uuid } },
      },
    },
    async request => {
      const requesterId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const viewAs = request.query.viewAs;
      const fogAs = request.query.fogAs;
      const fogOf = request.query.fogOf;

      return db.transaction(async q => {
        await purgeGoneSummons(q, campaignId);
        let userId = requesterId;
        let member = await membership(
          q, campaignId, requesterId, true,
        );

        if (viewAs && viewAs !== requesterId) {
          if (!(await canManage(q, member, requesterId))) {
            reject(403, 'Смотреть сцену глазами другого участника может мастер сцен.');
          }

          const viewer = (
            await q.query('SELECT 1 FROM campaign_members WHERE campaign_id=$1 AND user_id=$2', [campaignId, viewAs])
          ).rows[0];
          if (!viewer) reject(400, 'Этот участник не состоит в кампании.');

          member = await membership(q, campaignId, viewAs);
          userId = viewAs;
        }

        const scene = await getScene(q, campaignId, sceneId);
        const manager = await canManage(q, member, userId);

        const campaign = (
          await q.query(
            `SELECT fog_enabled, house_rules FROM campaigns WHERE id=$1`,
            [campaignId],
          )
        ).rows[0];

        const walls = (
          await q.query<WallSegment & { id: string; kind: WallKind; open: boolean; broken: boolean }>(
            `SELECT ${WALL_COLUMNS} FROM scene_walls
             WHERE campaign_id=$1 AND scene_id=$2
             ORDER BY created_at, id`,
            [campaignId, sceneId],
          )
        ).rows;
        const sightOnly = walls.filter(blocksSight);

        const rights = await rightsOf(q, member, userId);
        const placements = await loadPlacements(q, campaignId, sceneId);
        const bypass = manager || !campaign.fog_enabled || member.fog_disabled_by_gm;

        let fog: {
          visibleCells: Array<{ x: number; z: number; light: SeenLight }>;
          exploredCells: Array<{ x: number; z: number }>;
        } | null = null;
        let exploredIndexSet: Set<number> | null = null;
        let visibleIndexSet: Map<number, SeenLight> | null = null;
        const visibleList = (cells: Map<number, SeenLight>) =>
          [...cells].map(([index, light]) => ({ ...unpackCell(scene, index), light }));

        if (!bypass) {
          visibleIndexSet = await computeVisibleIndexSet(q, campaignId, scene, campaign, member, userId, sightOnly, placements);

          const state = (
            await q.query(
              `SELECT explored_cells FROM scene_fog_state
               WHERE campaign_id=$1 AND scene_id=$2 AND user_id=$3
               FOR UPDATE`,
              [campaignId, sceneId, userId],
            )
          ).rows[0];

          exploredIndexSet = new Set<number>(state?.explored_cells ?? []);
          for (const index of visibleIndexSet.keys()) exploredIndexSet.add(index);

          await q.query(
            `INSERT INTO scene_fog_state (campaign_id, scene_id, user_id, explored_cells, updated_at)
             VALUES ($1,$2,$3,$4::jsonb, now())
             ON CONFLICT (campaign_id, scene_id, user_id)
             DO UPDATE SET explored_cells=$4::jsonb, updated_at=now()`,
            [campaignId, sceneId, userId, JSON.stringify([...exploredIndexSet])],
          );

          fog = {
            visibleCells: visibleList(visibleIndexSet),
            exploredCells: [...exploredIndexSet].map(index => unpackCell(scene, index)),
          };
        }

        let illumination: string | null = null;
        let fogPreview: { visibleCells: Array<{ x: number; z: number; light: SeenLight }> } | null = null;
        const darkened = scene.effective_lighting === 'bright' && !weatherRules(scene.weather).obscured && Boolean((await q.query(
          `SELECT 1 FROM character_effects WHERE campaign_id=$1 AND effect_code='spell_darkness' AND active AND character_id = ANY($2::uuid[]) LIMIT 1`,
          [campaignId, placements.map(placement => placement.character_id)],
        )).rows[0]);
        if (bypass && (scene.effective_lighting !== 'bright' || weatherRules(scene.weather).obscured || darkened)) {
          const sightWalls = [...sightOnly, ...(await blockingPlacements(q, campaignId, scene, placements, 'sight')).flatMap(blocker => blocker.edges)];
          illumination = Array.from(await illuminationOf(q, campaignId, scene, placements, sightWalls)).join('');
        }
        let previewSet: Map<number, SeenLight> | null = null;
        let previewEyes = new Set<string>();
        if (manager && (fogAs === 'party' || fogOf)) {
          const eyes = fogOf ? { characterId: fogOf } : true;
          previewSet = await computeVisibleIndexSet(q, campaignId, scene, campaign, member, userId, sightOnly, placements, eyes);
          previewEyes = new Set((await visionSources(q, campaignId, member, userId, placements, eyes)).map(placement => placement.character_id));
          fogPreview = { visibleCells: visibleList(previewSet) };
        }

        const isControlled = (placement: Placement) =>
          controls(rights, userId, placement.character_id, placement.owner_user_id);
        const visibleIds = visiblePlacementIds(scene, placements, isControlled, visibleIndexSet);
        if (previewSet) {
          const seenByEyes = visiblePlacementIds(scene, placements, placement => previewEyes.has(placement.character_id), previewSet);
          for (const id of [...visibleIds]) if (!seenByEyes.has(id)) visibleIds.delete(id);
        }
        if (!manager) for (const id of await stealthHiddenIds(q, campaignId, scene, placements, member, userId, isControlled)) visibleIds.delete(id);

        const visiblePlacements = placements.filter(placement => visibleIds.has(placement.id));
        const viewer = await viewerRights(q, campaignId, userId, visiblePlacements.filter(placement => placement.kind !== 'object')
          .map(placement => ({ id: placement.character_id, kind: placement.kind, disposition: placement.disposition, factions_explicit: placement.factions_explicit })));
        const hitPoints = await hitPointsFor(q, campaignId, visiblePlacements, userId, isControlled, placement => viewer.shares(placement.character_id, 'see-hp'));
        const states = await loadStates(q, campaignId, visiblePlacements.map(placement => placement.character_id));
        const conditions = await conditionsFor(q, campaignId, visiblePlacements, userId, isControlled);
        const inspired = new Set(
          (
            await q.query(
              'SELECT id FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) AND inspiration',
              [campaignId, visiblePlacements.map(placement => placement.character_id)],
            )
          ).rows.map(row => row.id as string),
        );
        const npcIds = visiblePlacements.filter(placement => placement.kind === 'npc').map(placement => placement.character_id);
        const fallen = [...(await deadCreatures(q, campaignId, npcIds))];
        const lootCounts = new Map(
          fallen.length
            ? (
                await q.query(
                  `SELECT c.id,
                          (SELECT count(*)::int FROM characters item
                           WHERE item.campaign_id=c.campaign_id AND item.container_id=c.id AND item.kind='object')
                          + CASE WHEN c.cp > 0 OR c.sp > 0 OR c.ep > 0 OR c.gp > 0 OR c.pp > 0 THEN 1 ELSE 0 END AS count
                   FROM characters c WHERE c.campaign_id=$1 AND c.id = ANY($2::uuid[])`,
                  [campaignId, fallen],
                )
              ).rows.map(row => [row.id as string, row.count as number])
            : [],
        );

        const creatureRows = (await q.query(
          `SELECT id, class_name, sheet_extra FROM characters WHERE campaign_id=$1 AND id = ANY($2::uuid[]) AND kind <> 'object'`,
          [campaignId, visiblePlacements.map(placement => placement.character_id)],
        )).rows;
        const flyers = new Set(creatureRows.filter(row => flySpeedFrom(row.sheet_extra) > 0).map(row => row.id as string));
        const classes = new Map(creatureRows.map(row => [row.id as string, classOf(characterClassText(row))]));
        const heights = new Map(
          (await q.query(
            `SELECT character_id, MAX(COALESCE((parameters->>'height')::int, 0)) AS height FROM character_effects
             WHERE campaign_id=$1 AND active AND effect_code IN ('flying', 'dragon_wings') AND character_id = ANY($2::uuid[]) GROUP BY character_id`,
            [campaignId, visiblePlacements.map(placement => placement.character_id)],
          )).rows.map(row => [row.character_id as string, Number(row.height)]),
        );
        const objects = visiblePlacements
          .map(placement => {
            const canEdit = isControlled(placement);
            const { factions_explicit: _explicit, ...shown } = placement;
            return {
              ...shown,
              side: placement.kind === 'object' ? null
                : manager ? placementRelations(placement)?.withParty(placement.character_id) ?? 'neutral'
                : viewer.relation(placement.character_id),
              ...(manager && placement.kind !== 'object' ? { factions: placementFactions(placement) } : {}),
              hp: hitPoints.get(placement.id) ?? null,
              ...(flyers.has(placement.character_id) ? { canFly: true } : {}),
              ...(heights.has(placement.character_id) ? { flightHeight: heights.get(placement.character_id) } : {}),
              ...(classes.get(placement.character_id) && (placement.kind === 'character' || canEdit) ? { classId: classes.get(placement.character_id) } : {}),
              state: stateView(states.get(placement.character_id), canEdit),
              conditions: conditions.get(placement.character_id) ?? [],
              loot: lootCounts.get(placement.character_id) ?? 0,
              inspired: inspired.has(placement.character_id),
              canEdit,
              canMove: canEdit || placement.shared === true,
              canShare: placement.owner_user_id === userId || manager || rights.characterManager,
            };
          });

        const templateCells = previewSet ?? visibleIndexSet;
        const seenCells = templateCells ? [...templateCells.keys()].map(index => unpackCell(scene, index)) : [];
        const templates = (await loadTemplates(q, campaignId, sceneId)).filter(template => {
          if (!templateCells || (!previewSet && template.created_by === userId)) return true;
          if (templateCells.has(packCell(scene, Number(template.x), Number(template.z)))) return true;
          const area = areaOf(template, Number(scene.feet_per_unit || 5));
          return seenCells.some(cell => inAreaAt(area, cell.x, cell.z, 0));
        });

        const visibleWalls = bypass
          ? walls
          : walls.filter(wall => wallSeen(scene, exploredIndexSet!, wall));

        return {
          scene: { ...scene, canManage: manager },
          objects,
          walls: manager ? visibleWalls : visibleWalls.map(wall => wallForPlayer(wall)),
          drawings: await loadDrawings(q, campaignId, sceneId, manager),
          pins: await loadPins(q, campaignId, sceneId, member, userId),
          counters: await loadCounters(q, campaignId, sceneId, userId, manager),
          templates,
          triggers: manager
            ? await loadTriggers(q, campaignId, sceneId)
            : (await loadTriggers(q, campaignId, sceneId))
                .filter(trigger => trigger.kind === 'enter' && trigger.detected)
                .map(trigger => ({ id: trigger.id, kind: trigger.kind, shape: trigger.shape, x: trigger.x, z: trigger.z, direction: trigger.direction, size_feet: trigger.size_feet, name: trigger.name, detected: true, enabled: trigger.enabled })),
          fog,
          illumination,
          fogPreview,
          vision: {
            fogEnabled: campaign.fog_enabled === true,
            partyVision: await partyVisionOn(q, campaignId),
            alliedChoice: member.may_choose_allied_vision ? member.selected_vision : null,
          },
        };
      });
    },
  );
}
