import type { Queryable } from '../../../db.ts';
import type { ClassLevel } from '../../../../../../packages/domain/character/classes.ts';
import type { ConditionState } from '../../../../../../packages/domain/combat/conditions.ts';
import type { ClassFeatureContext, HpResult } from '../../class-features.ts';
import type { loadEffects } from '../../conditions.ts';
import type { entryOf, resourceOf } from '../helpers.ts';
import type { unarmoredDefense, ClassFeature } from '../../../../../../packages/domain/character/class-features.ts';

export type FeatureUseBody = {
  sceneId?: string; targetId?: string; mode?: 'dash' | 'disengage' | 'to-points' | 'to-slot' | 'fear' | 'charm'; amount?: number; cure?: boolean; beast?: string; slots?: number[];
  slotLevel?: number;
  heals?: Array<{ targetId: string; amount: number }>;
  frenzy?: boolean; technique?: 'prone' | 'push' | 'no-reactions'; weaponId?: string;
  spell?: string;
};

export type FeatureAfter = {
  floatOn: string | null;
  flurry: { targetId: string; die: number; sceneId: string | null; openHand: { id: string; name: string; current: boolean; dc: number } | null } | null;
  frenzyStrike: { targetId: string; weaponId: string | null; sceneId: string | null } | null;
  volley: { targets: Array<{ id: string; name: string }>; weaponId: string | null; sceneId: string } | null;
};

export type FeatureUse = {
  ctx: ClassFeatureContext;
  q: Queryable;
  userId: string;
  campaignId: string;
  characterId: string;
  feature: string;
  request: { body?: FeatureUseBody };
  sceneId: string | null;
  targetId: string | null;
  member: any;
  row: any;
  classes: ClassLevel[];
  enforce: boolean;
  state: ConditionState;
  changed: Array<{ characterId: string; change: HpResult }>;
  healed: Array<{ characterId: string; change: HpResult }>;
  after: FeatureAfter;
};

export type FeatureResult = { message: string; float: string | null; economyScene: string | null; heal: HpResult | null };

export type FeatureAction = (use: FeatureUse) => Promise<FeatureResult>;

export type FeatureLook = {
  ctx: ClassFeatureContext;
  q: Queryable;
  campaignId: string;
  characterId: string;
  request: { query: { sceneId?: string } };
  row: any;
  classes: ClassLevel[];
  state: ConditionState;
  rage: Awaited<ReturnType<typeof loadEffects>>[number] | undefined;
  wildShape: Awaited<ReturnType<typeof loadEffects>>[number] | undefined;
  effects: Awaited<ReturnType<typeof loadEffects>>;
  entry: Awaited<ReturnType<typeof entryOf>>;
  unable: string | null;
  bonusReason: string | null;
  actionReason: string | null;
  unarmored: ReturnType<typeof unarmoredDefense>;
  feature: ClassFeature;
  resource: Awaited<ReturnType<typeof resourceOf>> | null;
  empty: string | null;
};

export type FeatureChoice = { value: string; label: string; active?: boolean; count?: number; hint?: string };

export type FeatureView = { detail?: string; reason?: string | null; active?: boolean; choices?: FeatureChoice[] | null; limit?: number | null };

export type FeatureViewFn = (look: FeatureLook) => FeatureView | Promise<FeatureView>;
