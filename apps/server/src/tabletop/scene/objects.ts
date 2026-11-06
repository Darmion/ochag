import type { TableContext } from '../context.ts';
import { registerPlaceObjectRoute } from './objects/place.ts';
import { registerMoveObjectRoute } from './objects/move.ts';
import { registerUnplaceObjectRoute } from './objects/unplace.ts';
import { registerRemoveObjectRoute } from './objects/remove.ts';
import { registerFlightRoute } from './objects/flight.ts';
import { registerSharedObjectRoute } from './objects/shared-flag.ts';
import { registerReachRoute } from './objects/reach.ts';

export function registerObjectRoutes(ctx: TableContext) {
  registerPlaceObjectRoute(ctx);
  registerMoveObjectRoute(ctx);
  registerUnplaceObjectRoute(ctx);
  registerRemoveObjectRoute(ctx);
  registerFlightRoute(ctx);
  registerSharedObjectRoute(ctx);
  registerReachRoute(ctx);
}
