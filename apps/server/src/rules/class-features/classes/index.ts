import { barbarianActions, barbarianViews } from './barbarian.ts';
import { bardActions, bardViews } from './bard.ts';
import { clericActions, clericViews } from './cleric.ts';
import { druidActions, druidViews } from './druid.ts';
import { fighterActions, fighterViews } from './fighter.ts';
import { monkActions, monkViews } from './monk.ts';
import { paladinActions, paladinViews } from './paladin.ts';
import { rangerActions, rangerViews } from './ranger.ts';
import { rogueViews } from './rogue.ts';
import { sharedViews } from './shared.ts';
import { sorcererActions, sorcererViews } from './sorcerer.ts';
import { warlockActions, warlockViews } from './warlock.ts';
import { wizardActions, wizardViews } from './wizard.ts';
import type { FeatureAction, FeatureViewFn } from './types.ts';

export const FEATURE_ACTIONS: Record<string, FeatureAction> = {
  ...barbarianActions,
  ...bardActions,
  ...clericActions,
  ...druidActions,
  ...fighterActions,
  ...monkActions,
  ...paladinActions,
  ...rangerActions,
  ...sorcererActions,
  ...warlockActions,
  ...wizardActions,
};

export const FEATURE_VIEWS: Record<string, FeatureViewFn> = {
  ...barbarianViews,
  ...bardViews,
  ...clericViews,
  ...druidViews,
  ...fighterViews,
  ...monkViews,
  ...paladinViews,
  ...rangerViews,
  ...rogueViews,
  ...sharedViews,
  ...sorcererViews,
  ...warlockViews,
  ...wizardViews,
};
