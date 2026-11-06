import { reactive, ref, type Ref } from 'vue';
import type { ActionBarProps, Popover, ActionBarEmit } from './types';
import { QUICK_DICE, type TrayAdvantage } from './diceFormula';

export type DiceTrayDeps = {
  props: ActionBarProps;
  emit: ActionBarEmit;
  popover: Ref<Popover>;
};

export function useDiceTray({ props, emit, popover }: DiceTrayDeps) {
  const trayCounts = reactive<Record<number, number>>({});
  const trayModifier = ref(0);
  const trayAdvantage = ref<TrayAdvantage>('none');
  const trayHidden = ref(false);
  const RECENT_KEY = 'ttrpg.diceRecent';
  function loadRecent(): string[] {
    try {
      const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
      return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 5) : [];
    } catch {
      return [];
    }
  }
  const recentFormulas = ref<string[]>(loadRecent());

  function trayAdd(sides: number, delta: number) {
    trayCounts[sides] = Math.max(0, Math.min(20, (trayCounts[sides] ?? 0) + delta));
  }
  function trayClear() {
    for (const sides of QUICK_DICE) trayCounts[sides] = 0;
    trayModifier.value = 0;
    trayAdvantage.value = 'none';
  }
  function rollTray(formula: string) {
    if (!formula) return;
    emit('roll', formula, trayHidden.value && props.canHide);
    recentFormulas.value = [formula, ...recentFormulas.value.filter(item => item !== formula)].slice(0, 5);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentFormulas.value));
    } catch {
    }
    popover.value = null;
  }

  return { trayCounts, trayModifier, trayAdvantage, trayHidden, recentFormulas, trayAdd, trayClear, rollTray };
}
