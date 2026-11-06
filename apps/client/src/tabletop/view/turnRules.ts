import { ref, computed, watch, type Ref } from 'vue';
import { type CampaignRule, loadRules, updateRule, createRule } from '../../campaign/campaignRules';
import type { TabletopProps, SceneDetail } from './types';
import type { TableToast } from '../toasts';

export type TurnRulesDeps = {
  props: TabletopProps;
  sceneDetail: Ref<SceneDetail | null>;
  pushToast: (toast: Omit<TableToast, "id">, durationMs?: number) => void;
  run: (action: () => Promise<void>) => Promise<void>;
};

export function useTurnRules({ props, sceneDetail, pushToast, run }: TurnRulesDeps) {
  const gmFreeRule = ref<CampaignRule | null>(null);
  const groupTurnsRule = ref<CampaignRule | null>(null);
  async function loadGmFree() {
    if (!sceneDetail.value?.canManage) return;
    try {
      const { rules } = await loadRules(props.request, props.campaignId);
      gmFreeRule.value = rules.find(rule => rule.key === 'gm_free_move') ?? null;
      groupTurnsRule.value = rules.find(rule => rule.key === 'group_turns') ?? null;
    } catch {
      gmFreeRule.value = null;
      groupTurnsRule.value = null;
    }
  }
  const groupTurns = computed(() => groupTurnsRule.value?.value !== false);
  function setGroupTurns(value: boolean) {
    if (value === groupTurns.value) return;
    return run(async () => {
      const rule = groupTurnsRule.value;
      groupTurnsRule.value = rule
        ? await updateRule(props.request, props.campaignId, rule.id, { label: rule.label, description: rule.description, value, revision: rule.revision })
        : await createRule(props.request, props.campaignId, { key: 'group_turns', kind: 'flag', label: 'Групповой ход', value });
      pushToast({ tone: 'info', title: value ? 'Союзники подряд — вместе' : 'По одному', detail: value
        ? 'Со следующего хода союзники, идущие в очереди подряд, ходят одновременно (и враги подряд — тоже).'
        : 'Со следующего хода каждый ходит в свою очередь, по одному.' });
    });
  }
  const gmFree = computed(() => gmFreeRule.value?.value === true);
  function toggleGmFree() {
    return run(async () => {
      const rule = gmFreeRule.value;
      gmFreeRule.value = rule
        ? await updateRule(props.request, props.campaignId, rule.id, { label: rule.label, description: rule.description, value: !gmFree.value, revision: rule.revision })
        : await createRule(props.request, props.campaignId, { key: 'gm_free_move', kind: 'flag', label: 'Мастер действует свободно', value: true });
      pushToast({ tone: 'info', title: gmFree.value ? 'Свободно' : 'По правилам', detail: gmFree.value ? 'В бою вы двигаете фигуры и действуете ими вне очереди и сверх действий хода.' : 'В бою вы тоже двигаете и действуете только тем, чей ход: одно действие, бонусное и реакция.' });
    });
  }
  watch(() => [props.campaignId, sceneDetail.value?.canManage], () => void loadGmFree(), { immediate: true });

  return { groupTurns, setGroupTurns, gmFree, toggleGmFree };
}
