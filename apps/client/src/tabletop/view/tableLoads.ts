import type { Ref } from 'vue';
import { DIAGONAL_RULE_KEY, type DiagonalRule } from '../grid';
import { playSfx } from '../sfx';
import type { RollEntry, TabletopProps, InitiativeEntry } from './types';
import type { TableToast } from '../toasts';

export type TableLoadsDeps = {
  props: TabletopProps;
  viewOnly: boolean;
  sceneId: Ref<string>;
  rolls: Ref<RollEntry[]>;
  initiativeEntries: Ref<InitiativeEntry[]>;
  combatRound: Ref<number>;
  disposed: () => boolean;
  diagonalRule: Ref<DiagonalRule>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  takeFreshRolls: (list: RollEntry[]) => RollEntry[];
  rollToast: (roll: RollEntry) => Omit<TableToast, "id">;
  announceTurn: (entries: InitiativeEntry[], round: number) => void;
  initiativePath: () => string;
};

export function useTableLoads({ props, viewOnly, sceneId, rolls, initiativeEntries, combatRound, disposed, diagonalRule, pushToast, takeFreshRolls, rollToast, announceTurn, initiativePath }: TableLoadsDeps) {
  async function loadRolls() {
    const result = await props.request(`/campaigns/${props.campaignId}/rolls`);
    if (disposed()) return;

    const list: RollEntry[] = viewOnly ? result.rolls.filter((roll: RollEntry) => !roll.hidden) : result.rolls;
    const fresh = takeFreshRolls(list);

    rolls.value = list;

    const initiative = fresh.filter(roll => roll.label?.startsWith('Инициатива:'));
    const single = initiative.length > 1 ? fresh.filter(roll => !initiative.includes(roll)) : fresh;
    if (initiative.length > 1) {
      pushToast({
        tone: 'roll',
        title: 'Инициатива',
        detail: [...initiative].sort((a, b) => b.total - a.total).map(roll => `${roll.label!.slice('Инициатива:'.length).trim()} ${roll.total}`).join(' · '),
      });
    }
    for (const roll of [...single].reverse()) pushToast(rollToast(roll));
    if (fresh.length) playSfx('dice');
  }

  async function loadInitiative() {
    if (!sceneId.value) return;

    const requestedScene = sceneId.value;
    const result = await props.request(initiativePath());

    if (disposed() || requestedScene !== sceneId.value) return;

    announceTurn(result.entries, result.combatRound);
    initiativeEntries.value = result.entries;
    combatRound.value = result.combatRound;
  }

  async function loadTableRules() {
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/rules`);
      if (disposed()) return;

      const variant = (result.rules as Array<{ key: string; kind: string; value: unknown }>)
        .some(rule => rule.key === DIAGONAL_RULE_KEY && rule.kind === 'flag' && rule.value === true);
      diagonalRule.value = variant ? '5-10-5' : 'phb';
    } catch {
    }
  }

  return { loadRolls, loadInitiative, loadTableRules };
}
