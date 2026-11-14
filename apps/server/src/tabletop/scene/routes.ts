import type { TableContext } from '../context.ts';
import { registerSceneListRoute } from './routes/list.ts';
import { registerSceneCreateRoute } from './routes/create.ts';
import { registerSceneViewRoute } from './routes/view.ts';
import { registerSceneUpdateRoute } from './routes/update.ts';
import { registerCampaignFogRoute } from './routes/fog.ts';
import { registerSceneTerrainRoute } from './routes/terrain.ts';
import { registerSceneManageRoutes } from './routes/manage.ts';
import { registerSceneFileRoutes } from './routes/file.ts';

export function registerSceneRoutes(ctx: TableContext) {
  registerSceneListRoute(ctx);
  registerSceneCreateRoute(ctx);
  registerSceneViewRoute(ctx);
  registerSceneUpdateRoute(ctx);
  registerCampaignFogRoute(ctx);
  registerSceneTerrainRoute(ctx);
  registerSceneManageRoutes(ctx);
  registerSceneFileRoutes(ctx);
}
