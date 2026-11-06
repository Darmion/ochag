import type { LightMyRequestResponse } from 'fastify';
import type { TableContext } from '../../context.ts';
import type { npcFeatures } from '../npc.ts';
import type { AUTO_PACES, AutoPace } from '../planner.ts';
import type { planTurn } from '../plan/turn.ts';

export type TurnPlan = Awaited<ReturnType<typeof planTurn>>;

export type TurnRun = {
  ctx: TableContext;
  campaignId: string;
  sceneId: string;
  headers: Record<string, string>;
  pace: (typeof AUTO_PACES)[AutoPace];
  plan: TurnPlan;
  parts: string[];
  attackError: string | null;
  acted: boolean;
  beat: () => Promise<void>;
};

export type NpcClass = Awaited<ReturnType<typeof npcFeatures>>;

export type FeatureCall = (id: string, body?: Record<string, unknown>) => Promise<LightMyRequestResponse>;
