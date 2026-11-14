import { alternateSections, type AlternateMode } from '../../../../../packages/domain/map/wall-alternate.ts';
import { wallSteps } from '../../../../../packages/domain/map/walls.ts';

import type { TableContext } from '../context.ts';
import { notify } from '../live/notify.ts';
import { objectSchema, reject, sceneParams, type SceneParams, uuid, WALL_COLUMNS } from '../shared.ts';
import { WALL_STYLES, wallManager, type WallRow, type WallStyle } from './walls.ts';

const PLAIN_STYLES = WALL_STYLES.filter(style => style !== 'image');

export function registerWallAlternateRoute(ctx: TableContext) {
  const { app, auth, db } = ctx;

  app.post<{
    Params: SceneParams;
    Body: { ids: string[]; styles: WallStyle[]; mode: AlternateMode; length?: number };
  }>(
    '/campaigns/:campaignId/scenes/:sceneId/walls/alternate',
    {
      schema: {
        params: sceneParams,
        body: objectSchema({
          ids: { type: 'array', minItems: 1, maxItems: 2000, items: uuid },
          styles: { type: 'array', minItems: 2, maxItems: PLAIN_STYLES.length, uniqueItems: true, items: { type: 'string', enum: PLAIN_STYLES } },
          mode: { type: 'string', enum: ['cycle', 'mix'] },
          length: { type: 'integer', minimum: 1, maximum: 20 },
        }, ['ids', 'styles', 'mode']),
      },
    },
    async request => {
      const userId = await auth(request);
      const { campaignId, sceneId } = request.params;
      const { ids, styles, mode, length = 1 } = request.body;

      const result = await db.transaction(async q => {
        await wallManager(ctx, q, campaignId, sceneId, userId, 'менять');
        const walls = (
          await q.query(`SELECT ${WALL_COLUMNS} FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 AND id = ANY($3::uuid[]) FOR UPDATE`, [campaignId, sceneId, ids])
        ).rows as WallRow[];
        if (!walls.length) reject(404, 'Выделенные стены не найдены — обновите сцену.');
        const plan = alternateSections(walls, styles, mode, length);
        const kept: string[] = [];
        const created: string[] = [];
        for (const wall of walls) {
          const sections = plan.get(wall.id) ?? [];
          if (sections.length <= 1 || (wall.kind ?? 'wall') !== 'wall') {
            await q.query('UPDATE scene_walls SET style=$4, texture_asset_id=NULL WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, wall.id, sections[0]?.style ?? styles[0]]);
            kept.push(wall.id);
            continue;
          }
          const steps = wallSteps(wall);
          const at = (k: number) => ({ x: wall.x1 + ((wall.x2 - wall.x1) * k) / steps, z: wall.z1 + ((wall.z2 - wall.z1) * k) / steps });
          await q.query('DELETE FROM scene_walls WHERE campaign_id=$1 AND scene_id=$2 AND id=$3', [campaignId, sceneId, wall.id]);
          for (const section of sections) {
            const a = at(section.from), b = at(section.to);
            const row = (
              await q.query(
                `INSERT INTO scene_walls (campaign_id, scene_id, x1, z1, x2, z2, style, texture_asset_id, created_by, kind, open, locked, hp, hp_max, broken)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
                [campaignId, sceneId, a.x, a.z, b.x, b.z, section.style, userId, wall.kind, wall.open, wall.locked, wall.hp, wall.hp_max, wall.broken],
              )
            ).rows[0] as { id: string };
            created.push(row.id);
          }
        }
        await q.query('UPDATE scenes SET revision=revision+1 WHERE id=$1', [sceneId]);
        return { ids: [...kept, ...created], split: walls.length - kept.length };
      });

      void notify(ctx, campaignId, sceneId);
      return result;
    },
  );
}
