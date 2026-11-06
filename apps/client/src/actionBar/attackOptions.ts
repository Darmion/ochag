import { ref, watch, computed, type Ref, type ComputedRef } from 'vue';
import type { AttackOptions, AttackPreview, ActionBarProps, Popover, Weapon } from './types';
import type { AdvantageId } from './constants';
import { attackUsingView, type AttackUsing } from './attackView';

export type AttackOptionsDeps = {
  props: ActionBarProps;
  popover: Ref<Popover>;
  advantage: Ref<AdvantageId>;
  weapons: Ref<Weapon[]>;
  targetId: Ref<string>;
  powerFeat: ComputedRef<string>;
  usePower: Ref<boolean>;
};

export function useAttackOptions({ props, popover, advantage, weapons, targetId, powerFeat, usePower }: AttackOptionsDeps) {
  const attackUsing = ref<AttackUsing>('action');
  const attackOptions = ref<AttackOptions | null>(null);
  let attackOptionsSeq = 0;
  async function loadAttackOptions() {
    const actor = props.actor;
    if (!actor || !props.economy) {
      attackOptions.value = null;
      return;
    }
    const seq = ++attackOptionsSeq;
    try {
      const result = await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/attack-options${props.sceneId ? `?sceneId=${props.sceneId}` : ''}`);
      if (seq === attackOptionsSeq) attackOptions.value = result;
    } catch {
      if (seq === attackOptionsSeq) attackOptions.value = null;
    }
  }
  watch(
    () => [popover.value, props.actor?.characterId, props.economy?.action, props.economy?.bonus, props.economy?.reaction, props.economy?.attacksMade, props.isActorTurn] as const,
    () => { if (popover.value === 'attack') void loadAttackOptions(); },
  );
  const bonusWeaponIds = computed(() => new Set((attackOptions.value?.weapons ?? []).filter(weapon => weapon.bonus).map(weapon => weapon.id)));
  const bonusAllowed = computed(() => !attackOptions.value?.enforced || bonusWeaponIds.value.size > 0);
  const reactionAllowed = computed(() => !attackOptions.value?.enforced || Boolean(attackOptions.value?.readied));
  const bonusHint = computed(() => [...new Set((attackOptions.value?.weapons ?? []).map(weapon => weapon.bonusLabel).filter(Boolean))].join(', '));
  const usingView = computed(() => props.economy ? attackUsingView({
    economy: props.economy, isActorTurn: props.isActorTurn, options: attackOptions.value,
    bonusAllowed: bonusAllowed.value, reactionAllowed: reactionAllowed.value, bonusHint: bonusHint.value,
  }) : null);
  function weaponBlocked(weaponId: string) {
    return attackUsing.value === 'bonus' && Boolean(attackOptions.value?.enforced) && !bonusWeaponIds.value.has(weaponId);
  }
  function weaponOption(weaponId: string) {
    return attackOptions.value?.weapons.find(weapon => weapon.id === weaponId) ?? null;
  }
  const twoHanded = ref(false);
  const hasVersatile = computed(() => weapons.value.some(weapon => weapon.versatile_formula));

  const attackPreviews = ref<Record<string, AttackPreview>>({});
  let previewSeq = 0;
  async function loadAttackPreviews() {
    const actor = props.actor;
    if (!actor || popover.value !== 'attack' || !targetId.value || !weapons.value.length) {
      attackPreviews.value = {};
      return;
    }
    const seq = ++previewSeq;
    const results: Record<string, AttackPreview> = {};
    await Promise.all(weapons.value.map(async weapon => {
      // Keep this parameter order: the desktop route allowlist (apps/desktop/main/api-routes.cjs) matches the query as written.
      const qs = new URLSearchParams();
      qs.set('characterId', actor.characterId);
      qs.set('key', weapon.id);
      if (targetId.value) qs.set('targetCharacterId', targetId.value);
      if (props.sceneId) qs.set('sceneId', props.sceneId);
      qs.set('advantage', advantage.value);
      if (twoHanded.value && weapon.versatile_formula) qs.set('twoHanded', 'true');
      if (usePower.value && powerFeat.value) qs.set('power', 'true');
      try {
        results[weapon.id] = await props.request(`/campaigns/${props.campaignId}/rolls/attack-preview?${qs}`);
      } catch {
        results[weapon.id] = { hitChance: null, averageDamage: null, tooFar: null };
      }
    }));
    if (seq === previewSeq) attackPreviews.value = results;
  }
  watch([targetId, weapons, twoHanded, advantage, usePower, () => popover.value], loadAttackPreviews);

  function previewText(weaponId: string): string {
    const preview = attackPreviews.value[weaponId];
    if (!preview) return '';
    if (preview.tooFar) return preview.tooFar.includes('укрытием') ? 'полное укрытие' : 'слишком далеко';
    if (preview.hitChance === null) return '';
    const chance = `≈${Math.round(preview.hitChance * 100)} %`;
    return preview.averageDamage !== null ? `${chance} · ~${preview.averageDamage} урона` : chance;
  }

  return { attackUsing, attackOptions, loadAttackOptions, bonusAllowed, reactionAllowed, bonusHint, usingView, weaponBlocked, weaponOption, twoHanded, hasVersatile, previewText };
}
