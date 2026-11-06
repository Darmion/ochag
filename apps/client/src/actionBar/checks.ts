import { ref, computed, watch, type Ref, type ComputedRef } from 'vue';
import type { ActionBarProps, Weapon, FeatureView, SmiteOffer, StunOffer, ManeuverOffer, QuiveringOffer, HurlOffer, ActionBarEmit } from './types';
import type { AdvantageId } from './constants';

export type ChecksDeps = {
  props: ActionBarProps;
  emit: ActionBarEmit;
  advantage: Ref<AdvantageId>;
  weapons: Ref<Weapon[]>;
  usePower: Ref<boolean>;
  useInspiration: Ref<boolean>;
  targetId: Ref<string>;
  features: Ref<FeatureView[]>;
  smiteOffer: Ref<SmiteOffer | null>;
  stunOffer: Ref<StunOffer | null>;
  maneuverOffer: Ref<ManeuverOffer | null>;
  quiveringOffer: Ref<QuiveringOffer | null>;
  hurlOffer: Ref<HurlOffer | null>;
  knowsFeat: (id: string) => boolean;
  powerFeat: ComputedRef<string>;
  knowsManeuver: (id: string) => boolean;
  perform: (action: () => Promise<unknown>, keepOpen?: boolean) => Promise<void>;
  sendFriendly: <T>(send: (warn: boolean) => Promise<T>) => Promise<T>;
  attackUsing: Ref<"bonus" | "action" | "reaction">;
  twoHanded: Ref<boolean>;
  loadAttackOptions: () => Promise<void>;
};

export function useChecks({ props, emit, advantage, weapons, usePower, useInspiration, targetId, features, smiteOffer, stunOffer, maneuverOffer, quiveringOffer, hurlOffer, knowsFeat, powerFeat, knowsManeuver, perform, sendFriendly, attackUsing, twoHanded, loadAttackOptions }: ChecksDeps) {
  const sense = ref<'' | 'sight' | 'hearing'>('');

  const useBardic = ref(false);
  const hasBardic = computed(() => Boolean(props.actor?.conditions.includes('bardic_inspiration')));
  const usePrecision = ref(false);
  const useLucky = ref(false);
  const useStroke = ref(false);
  const strokeReady = computed(() => Boolean(features.value.find(feature => feature.id === 'stroke-of-luck')?.available));
  const useLuckyCheck = ref(false);
  const useStrokeCheck = ref(false);
  const usePeerless = ref(false);
  const peerlessFeature = computed(() => features.value.find(feature => feature.id === 'peerless-skill') ?? null);
  watch(hasBardic, value => { if (!value) useBardic.value = false; });

  function check(kind: 'attack' | 'skill' | 'save' | 'ability', key: string, options: { hidden?: boolean } = {}) {
    const actor = props.actor;
    if (!actor) return;
    const spend = useInspiration.value && actor.inspired;
    const bardic = useBardic.value && hasBardic.value;
    return perform(async () => {
      const result = await sendFriendly(warn => props.request(`/campaigns/${props.campaignId}/rolls/check`, 'POST', {
        ...(kind === 'attack' && targetId.value && warn ? { warnFriendly: true } : {}),
        characterId: actor.characterId, kind, key, advantage: advantage.value,
        ...(options.hidden && props.canHide ? { hidden: true } : {}),
        ...((kind === 'skill' || kind === 'ability') && sense.value ? { sense: sense.value } : {}),
        ...(spend ? { inspiration: true } : {}),
        ...(bardic ? { bardic: true } : {}),
        ...(kind === 'attack' && usePrecision.value && knowsManeuver('precision') ? { precision: true } : {}),
        ...(kind === 'attack' && usePower.value && powerFeat.value ? { power: true } : {}),
        ...(kind === 'attack' && useLucky.value && knowsFeat('lucky') ? { lucky: true } : {}),
        ...(kind === 'attack' && useStroke.value && strokeReady.value ? { strokeOfLuck: true } : {}),
        ...(kind !== 'attack' && useLuckyCheck.value && knowsFeat('lucky') ? { lucky: true } : {}),
        ...((kind === 'skill' || kind === 'ability') && useStrokeCheck.value && strokeReady.value ? { strokeOfLuck: true } : {}),
        ...((kind === 'skill' || kind === 'ability') && usePeerless.value && peerlessFeature.value?.available ? { peerless: true } : {}),
        ...(kind === 'attack' && props.economy && attackUsing.value !== 'action' ? { using: attackUsing.value } : {}),
        ...(kind === 'attack' && twoHanded.value && weapons.value.find(weapon => weapon.id === key)?.versatile_formula ? { twoHanded: true } : {}),
        ...(kind === 'attack' && targetId.value ? { targetCharacterId: targetId.value, ...(props.sceneId ? { sceneId: props.sceneId } : {}) } : {}),
      }));
      if (spend) useInspiration.value = false;
      if (kind !== 'attack') {
        useLuckyCheck.value = false;
        useStrokeCheck.value = false;
        usePeerless.value = false;
      }
      if (bardic) {
        useBardic.value = false;
        const rider = (result?.outcome?.riders ?? []).find((entry: any) => String(entry.label).startsWith('вдохновение барда'));
        if (rider) emit('acted', `${actor.name}: кость вдохновения ${rider.die.replace('+', '')} — +${rider.value}.`);
      }
      if (kind === 'attack') {
        void loadAttackOptions();
        smiteOffer.value = result?.smite ? { characterId: actor.characterId, ...result.smite } : null;
        stunOffer.value = result?.stun ? { characterId: actor.characterId, ...result.stun } : null;
        maneuverOffer.value = result?.maneuver ? { characterId: actor.characterId, ...result.maneuver } : null;
        quiveringOffer.value = result?.quivering ? { characterId: actor.characterId, ...result.quivering } : null;
        hurlOffer.value = result?.hurl ? { characterId: actor.characterId, ...result.hurl } : null;
        if (result?.retaliation) emit('acted', `${result.retaliation.name}: «Ответный удар» — ${result.retaliation.hit ? `попадание${result.retaliation.damage !== null ? `, ${result.retaliation.damage} урона` : ''}` : 'промах'}.`);
        if (result?.tide) emit('acted', `${result.tide.name}: «Против течения» — удар ушёл в «${result.tide.victim}»: ${result.tide.hit ? 'попадание' : 'промах'}.`);
        const sneak = result?.outcome?.sneakAttack;
        if (sneak) emit('acted', `${actor.name}: скрытая атака, +${sneak.dice} (${sneak.reason}).`);
        if (result?.damageMissing) emit('acted', `${actor.name}: попадание, но урона нет — у «${result.damageMissing}» не задана формула урона (лист → «Снаряжение», например 1d8+@mod).`);
      }
    });
  }

  return { sense, useBardic, hasBardic, usePrecision, useLucky, useStroke, strokeReady, useLuckyCheck, useStrokeCheck, usePeerless, peerlessFeature, check };
}
