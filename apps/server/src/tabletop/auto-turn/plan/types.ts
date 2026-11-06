import type { ConditionState } from '../../../../../../packages/domain/combat/conditions.ts';
import type { Opportunity } from '../../combat/opportunity.ts';
import type { Notice } from '../../scene/scene-triggers.ts';
import type { Placement } from '../../shared.ts';
import type { autoOpening, autoWildShape } from '../npc.ts';
import type { AutoOption, AutoTarget } from '../planner.ts';

export type TurnInput = {
  campaignId: string;
  sceneId: string;
  userId: string;
  targetMode: AutoTarget;
  shapedNow: Awaited<ReturnType<typeof autoWildShape>>;
  opening: Awaited<ReturnType<typeof autoOpening>>;
};

export type TurnLog = { notices: Notice[]; provoked: Opportunity[]; entryId: string };

export type TurnBoard = {
  scene: any;
  placements: Placement[];
  npc: Placement;
  npcState: ConditionState;
  alive: Placement[];
  fallen: Set<string>;
  holding: boolean;
  options: AutoOption[];
  strikes: AutoOption[];
  reach: number;
};

export type PostMovePosition = { position: { x: number; z: number }; here: Placement; sees: (other: Placement) => boolean };
