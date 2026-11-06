import { OUTCOMES } from './internal.ts';
import { EFFECT_CATALOG } from './effect-catalog.ts';
import type { Action, Check, Effect, Outcome, SpellTemplate } from './types.ts';

export type ActionPath = { action: Action; scope: string };

export function allActions(t: SpellTemplate): ActionPath[] {
  const found: ActionPath[] = [];
  const walk = (actions: Action[], scope: string) => {
    for (const action of actions) {
      found.push({ action, scope });
      for (const effects of Object.values(action.outcomes)) {
        for (const effect of effects ?? []) if (effect.actions.length) walk(effect.actions, `${scope} → ${action.name} → ${EFFECT_CATALOG[effect.kind].label}`);
      }
    }
  };
  walk(t.actions, 'Действия');
  for (const mode of t.options.modes) walk(mode.actions, `Режим «${mode.name}»`);
  walk(t.ending.onEnd, 'При окончании');
  return found;
}

export function allEffects(t: SpellTemplate): Array<{ effect: Effect; action: Action; outcome: Outcome }> {
  const found: Array<{ effect: Effect; action: Action; outcome: Outcome }> = [];
  for (const { action } of allActions(t)) {
    for (const outcome of OUTCOMES) for (const effect of action.outcomes[outcome] ?? []) found.push({ effect, action, outcome });
  }
  return found;
}

export function outcomesFor(check: Check['kind']): Outcome[] {
  if (check === 'attack') return ['hit', 'miss', 'crit'];
  if (check === 'save' || check === 'ability' || check === 'contest') return ['fail', 'success'];
  if (check === 'caster-d20' || check === 'hp-threshold') return ['met', 'unmet'];
  return ['always'];
}
