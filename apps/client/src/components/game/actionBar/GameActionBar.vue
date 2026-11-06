<script setup lang="ts">

import { AUTO_TARGETS, type AutoTarget } from '../../../tabletop/autoTarget';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { ensureSrdSkills, type SrdSkill } from '../../../rules/srd';
import { conditionInfo } from '../../../rules/conditions';
import { spellNeedsTargets } from '../../../spells/spellMechanics';
import GameIcon from '../GameIcon.vue';
import type { GameIconName } from '../../../ui/gameIcons';
import type { HitDiceView } from '../../sheet/RestControls.vue';
import LootPanel from '../../tabletop/LootPanel.vue';
import DiceTrayPanel from './DiceTrayPanel.vue';
import SpellCatalogPanel from './SpellCatalogPanel.vue';
import SpellCastPanel from './SpellCastPanel.vue';
import ChecksPanel from './ChecksPanel.vue';
import AttackSettings from './AttackSettings.vue';
import WeaponButton from './WeaponButton.vue';
import ActionsPanel from './ActionsPanel.vue';
import HitOffers from './HitOffers.vue';
import WildShapeRow from './WildShapeRow.vue';
import AutoTurnPanel from './AutoTurnPanel.vue';
import RestPanel from './RestPanel.vue';
import ActorCard from './ActorCard.vue';
import TurnColumn from './TurnColumn.vue';
import BardicInspirationRow from './BardicInspirationRow.vue';
import BreathWeaponRow from './BreathWeaponRow.vue';
import InfernalLegacyRow from './InfernalLegacyRow.vue';
import CleansingTouchRow from './CleansingTouchRow.vue';
import LayOnHandsRow from './LayOnHandsRow.vue';
import QuiveringPalmRow from './QuiveringPalmRow.vue';
import FiendishResilienceRow from './FiendishResilienceRow.vue';
import RecklessAttackRow from './RecklessAttackRow.vue';
import FrenzyRow from './FrenzyRow.vue';
import OpenHandTechniqueRow from './OpenHandTechniqueRow.vue';
import FeatureActionsRow from './FeatureActionsRow.vue';
import FlexibleCastingRow from './FlexibleCastingRow.vue';
import PreserveLifeRow from './PreserveLifeRow.vue';
import SlotRecoveryRow from './SlotRecoveryRow.vue';
import FeatureButton from './FeatureButton.vue';
import ChipsRow from './ChipsRow.vue';
import ChoiceListRow from './ChoiceListRow.vue';
import FeaturePassiveCard from './FeaturePassiveCard.vue';
import FeatureToggle from './FeatureToggle.vue';
import type { Weapon, SpellEntry, ActionBarProps, ActionBarEvents, Popover, PactSlots, SpellSlot } from '../../../actionBar/types';
import { weaponCard, weaponLimit } from '../../../actionBar/weapons';
import { ACTION_ROWS, FEATURE_BUTTONS, FEATURE_TOGGLES, featureButton, featureToggle, type RowCall } from '../../../actionBar/featureCards';
import { ADVANTAGE, type AdvantageId } from '../../../actionBar/constants';
import { useCellLayout } from '../../../actionBar/cellLayout';
import { useDiceTray } from '../../../actionBar/diceTray';
import { useFriendlyFire } from '../../../actionBar/friendlyFire';
import { useAttackOptions } from '../../../actionBar/attackOptions';
import { fitOnScreen } from '../../../actionBar/fitOnScreen';
import { useCombatActions } from '../../../actionBar/combatActions';
import { useChecks } from '../../../actionBar/checks';
import { useSummonChoices } from '../../../actionBar/summonChoices';
import { useSpellTargets } from '../../../actionBar/spellTargets';
import { useCastView } from '../../../actionBar/castView';
import { useSpellSlots } from '../../../actionBar/spellSlots';
import { useSpellCatalog } from '../../../actionBar/spellCatalog';
import { useSpellCast } from '../../../actionBar/spellCast';
import { useMapAim } from '../../../actionBar/mapAim';
import { useFeatures } from '../../../actionBar/features';
import { useFeatureResources } from '../../../actionBar/featureResources';
import { useHitOffers } from '../../../actionBar/hitOffers';
import { useFeatureAim } from '../../../actionBar/featureAim';
import { useFeatureCalls } from '../../../actionBar/featureCalls';
import { useLegacyTraits } from '../../../actionBar/legacyTraits';
import { useFeatureChoices } from '../../../actionBar/featureChoices';
import { useCastOptions } from '../../../actionBar/castOptions';

const props = defineProps<ActionBarProps>();

const emit = defineEmits<ActionBarEvents>();
const catRow = ref<HTMLElement | null>(null);
const { compactCats, measureCats } = useCellLayout({ catRow });

const popover = ref<Popover>(null);
const commandTitles: Record<Exclude<Popover, null>, [string, GameIconName]> = {
  attack: ['Атака', 'sword'], spell: ['Магия', 'spellbook'], actions: ['Действия', 'run'],
  features: ['Умения', 'flame'], skill: ['Навыки', 'star'], save: ['Спасброски', 'shield'],
  ability: ['Характеристики', 'd20'], rest: ['Отдых', 'moon'], loot: ['Добыча', 'chest'],
  trade: ['Торговля', 'bag'], auto: ['Тактика', 'target'], checks: ['Проверки', 'd20'],
  dice: ['Кубики', 'dice'],
};
const commandTitle = computed(() => commandTitles[popover.value ?? 'attack']);
const spellQuery = ref('');
const spellCircle = ref<number | null>(null);
watch(() => props.actor?.characterId, () => { spellQuery.value = ''; spellCircle.value = null; });

// Shifted left by the overflow: at a large UI scale the popover went past the right edge.
const popoverEl = ref<HTMLElement | null>(null);
const popoverShift = ref(0);

const advantage = ref<AdvantageId>('none');
const working = ref(false);
const actionError = ref('');
const weapons = ref<Weapon[]>([]);
const spells = ref<SpellEntry[]>([]);
const skills = ref<SrdSkill[]>([]);
const hitDice = ref<HitDiceView | null>(null);
const pactSlots = ref<PactSlots | null>(null);
const usePact = ref(false);
const useRacial = ref(true);
const useRitual = ref(false);
const useFree = ref(true);
const slotList = ref<SpellSlot[]>([]);
const castSlot = ref(0);
const partyXp = ref(100);
const loadedFor = ref('');
const usePower = ref(false);
const useInspiration = ref(false);
watch(() => props.actor?.inspired, value => { if (!value) useInspiration.value = false; });
const castingEntry = ref<SpellEntry | null>(null);

const creature = computed(() => props.actor && props.actor.kind !== 'object');
const canRoll = computed(() => Boolean(props.actor?.canAct && creature.value));

const INCAPACITATING = ['dead', 'unconscious', 'paralyzed', 'petrified', 'stunned', 'incapacitated'];
const blockedAct = computed(() => !canRoll.value || Boolean(incapacitated.value));
const checkTab = ref<'skill' | 'save' | 'ability'>('skill');
const incapacitated = computed(() => {
  const code = INCAPACITATING.find(entry => props.actor?.conditions.includes(entry));
  return code ? conditionInfo(code).label.toLowerCase() : props.actor?.conditions.includes('exhaustion_6') ? 'мёртв' : null;
});
const dying = computed(() => Boolean(props.actor?.canAct && props.actor.hp?.current === 0 &&
  props.actor.conditions.includes('unconscious') && !props.actor.conditions.includes('stable') && !props.actor.conditions.includes('dead')));
const prone = computed(() => Boolean(props.actor?.canAct && props.actor.conditions.includes('prone') && !incapacitated.value));

const targetId = ref('');
watch(() => props.targets, list => {
  if (list.some(target => target.characterId === targetId.value)) return;
  targetId.value = list.find(target => target.side === 'hostile')?.characterId ?? '';
}, { immediate: true });
const advantageInfo = computed(() => ADVANTAGE.find(entry => entry.id === advantage.value)!);

let actorDataRequest = 0;
async function ensureActorData() {
  const actor = props.actor;
  if (!actor || loadedFor.value === actor.characterId) return;
  const request = ++actorDataRequest;
  const stale = () => request !== actorDataRequest || props.actor?.characterId !== actor.characterId;
  loadedFor.value = actor.characterId;
  weapons.value = [];
  spells.value = [];
  try {
    const [sheet, known, srdSkills] = await Promise.all([
      props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}`),
      props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/spells`).catch(() => ({ spells: [] })),
      ensureSrdSkills(props.request),
    ]);
    const slotData = await props.request(`/campaigns/${props.campaignId}/characters/${actor.characterId}/spell-slots`).catch(() => ({ slots: [] }));
    if (stale()) return;
    slotList.value = Array.isArray(slotData.slots) ? slotData.slots : [];
    weapons.value = Array.isArray(sheet.weapons) ? sheet.weapons : [];
    hitDice.value = sheet.hit_dice ?? null;
    pactSlots.value = sheet.pact_slots_max ? { current: sheet.pact_slots_current, max: sheet.pact_slots_max, slotLevel: sheet.pact_slot_level } : null;
    actorLevel.value = typeof sheet.level === 'number' ? sheet.level : null;
    usePact.value = false;
    spells.value = Array.isArray(known.spells) ? known.spells : [];
    skills.value = srdSkills;
  } catch (cause) {
    if (stale()) return;
    loadedFor.value = '';
    actionError.value = cause instanceof Error ? cause.message : 'Не удалось прочитать лист. Попробуйте ещё раз.';
  }
}

const { warnFriendly, sendFriendly, perform } = useFriendlyFire({ popover, working, actionError });

const {
  features, featureClass, smiteOffer, stunOffer, maneuverOffer, quiveringOffer, hurlOffer, subclasses,
  loadFeatures, hasCunningAction, featureTitle,
} = useFeatures({
  props, popover, actionError, loadedFor,
});

watch(popover, () => fitOnScreen(popoverEl, popoverShift));

const autoTargetLabel = computed(() => AUTO_TARGETS.find(entry => entry.id === (props.autoTarget ?? 'nearest'))?.label.toLowerCase() ?? 'ближайшего');

function pickAutoTarget(mode: AutoTarget) {
  popover.value = null;
  emit('autoTarget', mode);
  emit('autoTurn');
}

async function toggle(name: Exclude<Popover, null>) {
  actionError.value = '';
  popover.value = popover.value === name ? null : name;
  if (popover.value) await ensureActorData();
  if (popover.value === 'features' || popover.value === 'actions') await loadFeatures();
}

async function openPopover(name: Exclude<Popover, null>) {
  actionError.value = '';
  popover.value = name;
  await ensureActorData();
  if (name === 'features' || name === 'actions') await loadFeatures();
}

const {
  slotPicks, bardicTarget, quiveringTarget, handsTarget, cleanseTarget, cleanseSpell, cleanseSpells,
  handsAmount, handsCure, beast, rageFrenzy, flurryTechnique, useFeature,
} = useFeatureCalls({
  props, emit, loadedFor, targetId, perform, features, quiveringOffer, loadFeatures,
});

const {
  flexLevel, legacyOf, addLegacySpell, inspiringSpeech, setAncestry, breathe, toggleProtection, toggleReady,
} = useLegacyTraits({
  props, emit, loadedFor, targetId, ensureActorData, perform, features, loadFeatures,
});

const {
  CHOICE_PATH, CHIP_CHOICES, freeOf, knowsFeat, powerFeat,
  pickSingle, knowsManeuver, setChoice, setSubclass,
} = useFeatureChoices({
  props, perform, features, loadFeatures,
});

const {
  preservePick, preserveSum, preserveSpread, preserveLife, useManeuver, slotSum, recoverSlots,
} = useFeatureResources({
  props, emit, perform, maneuverOffer, slotPicks, useFeature,
});

const {
  castMetamagic, castEmpowered, castOverchannel, overchannelFeature, overchannelReady, castHeightened,
  metamagicFeature, metamagicKnown,
} = useCastOptions({
  castSlot, features,
});

const {
  stunningStrike, quiveringPalm, hurlThroughHell, smite,
} = useHitOffers({
  props, emit, perform, stunOffer, quiveringOffer, loadFeatures, hurlOffer, smiteOffer,
});

const {
  attackUsing, loadAttackOptions, bonusAllowed, usingView, weaponBlocked, weaponOption, twoHanded,
  hasVersatile, previewText,
} = useAttackOptions({
  props, popover, advantage, weapons, targetId, powerFeat, usePower,
});
const {
  sense, useBardic, hasBardic, usePrecision, useLucky, useStroke, strokeReady, useLuckyCheck,
  useStrokeCheck, usePeerless, peerlessFeature, check,
} = useChecks({
  props, emit, advantage, weapons, usePower, useInspiration, targetId, features, smiteOffer, stunOffer,
  maneuverOffer, quiveringOffer, hurlOffer, knowsFeat, powerFeat, knowsManeuver, perform, sendFriendly,
  attackUsing, twoHanded, loadAttackOptions,
});

const {
  hasteAction, attacksLeftText, standardAction, helpAlly, helpFoe, actorGrappled, canAttackAction,
  targetName, readyTrigger, combatAction, actorHidden, stealthAction, markEconomy, inspire, deathSave,
  stand, onRested, restParty,
} = useCombatActions({
  props, emit, popover, loadedFor, useInspiration, targetId, perform, bonusAllowed, attackUsing,
});

const { slotChoices, pactCastable, castSlotLevel } = useSpellSlots({ pactSlots, usePact, slotList, castSlot });

const {
  castBeast, castElement, castMode, conjureOption, beastLabel, conjureCountOf,
  beastChoices, chosenBeast,
} = useSummonChoices({
  castingEntry, castSlotLevel,
});

const {
  castTargets, castArea, actorLevel, shotsPer, projectileTotal, shotsAssigned,
  changeShots,
} = useSpellTargets({
  usePact, castSlot, castingEntry, castMetamagic, castSlotLevel,
});

const { spellName, favoriteSpell, sortedSpells, spellCircles, visibleSpells } = useSpellCatalog({ props, spellQuery, spellCircle, spells });

const {
  cast,
} = useSpellCast({
  props, emit, pactSlots, usePact, useRacial, useRitual, useFree, slotList, castSlot, useInspiration,
  castingEntry, hurlOffer, legacyOf, freeOf, castMetamagic, castEmpowered, castOverchannel,
  overchannelReady, castHeightened, perform, sendFriendly, pactCastable, slotChoices, castBeast,
  castElement, castMode, castTargets, castArea, shotsPer, spellName,
});

const {
  mapAiming, armedWeapon, aimArt, aimName, aimFeature, meleeReach, rangedReach, areaHover,
  setAreaHover, targetingCursor, armWeapon, targetingActive, aimState, setMapArea, setMapPlace,
  strikeWall, setMapTarget, aimHint,
} = useMapAim({
  props, popover, working, actionError, weapons, castingEntry, targetId, castMetamagic, perform,
  weaponBlocked, check, chosenBeast, conjureCountOf, conjureOption, castBeast, castTargets, castArea,
  spellName, cast, spellRangeFeet,
});

const {
  aimTargeted, aimBreath, aimBardic, aimHands, cleanseName, aimCleanse, aimQuivering, pressFeature,
} = useFeatureAim({
  props, targetId, bardicTarget, quiveringTarget, handsTarget, cleanseTarget, cleanseSpell, handsAmount,
  handsCure, useFeature, breathe, aimFeature, meleeReach, rageFrenzy, flurryTechnique,
});

const { castView } = useCastView({
  props, castingEntry, castTargets, castArea, shotsPer, shotsAssigned, pactSlots, beastChoices, metamagicKnown, metamagicFeature,
  overchannelFeature, slotChoices, castSlotLevel, conjureCountOf, beastLabel, projectileTotal, freeOf, legacyOf, pactCastable, overchannelReady,
});

function chooseSpell(entry: SpellEntry) {
  castSlot.value = 0;
  useFree.value = true;
  castMetamagic.value = '';
  castEmpowered.value = false;
  castOverchannel.value = false;
  castHeightened.value = '';
  const needsTargets = spellNeedsTargets(entry.spell?.mechanics) || Boolean(entry.spell?.riders?.length) || Boolean(entry.spell?.needsTarget);
  castingEntry.value = entry;
  castTargets.value = [];
  if (entry.spell?.element?.length && !entry.spell.element.includes(castElement.value)) castElement.value = entry.spell.element[0]!;
  castMode.value = entry.spell?.modes?.[0]?.id ?? '';
  castArea.value = '';
  conjureOption.value = 0;
  mapAiming.value = (needsTargets && !entry.spell?.summon && !entry.spell?.shape) || Boolean(entry.spell?.teleport);
}

const {
  trayCounts, trayModifier, trayAdvantage, trayHidden, recentFormulas, trayAdd, trayClear, rollTray,
} = useDiceTray({
  props, emit, popover,
});

function cancelStep(): boolean {
  if (mapAiming.value) { mapAiming.value = false; armedWeapon.value = null; actionError.value = ''; return true; }
  if (smiteOffer.value || stunOffer.value || maneuverOffer.value || quiveringOffer.value || hurlOffer.value) {
    smiteOffer.value = null;
    stunOffer.value = null;
    maneuverOffer.value = null;
    quiveringOffer.value = null;
    hurlOffer.value = null;
    return true;
  }
  if (popover.value === 'spell' && castingEntry.value) {
    castingEntry.value = null;
    castTargets.value = [];
    return true;
  }
  if (popover.value) {
    popover.value = null;
    return true;
  }
  return false;
}

function openAttackOn(characterId: string) {
  if (props.targets.some(target => target.characterId === characterId)) targetId.value = characterId;
  void openPopover('attack');
}

function openSpellOn(characterId: string) {
  if (props.targets.some(target => target.characterId === characterId)) targetId.value = characterId;
  castingEntry.value = null;
  void openPopover('spell');
}

defineExpose({ targetingActive, targetingCursor, aimState, setMapTarget, setMapArea, setMapPlace, setAreaHover, strikeWall, openPopover, openAttackOn, openSpellOn, cancelStep });

function onDocumentPointer(event: PointerEvent) {
  // While picking a target on the map, that very click must not close the popover.
  if (targetingActive.value) return;
  if (!(event.target as HTMLElement).closest('.game-actions')) popover.value = null;
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointer));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer));
watch(() => [features.value.length, props.inCombat, props.lootTargets.length, props.tradeTargets.length, props.actor?.characterId], () => void nextTick(measureCats));

const hoverWeapon = ref<Weapon | null>(null);

function spellRangeFeet(entry: SpellEntry | null): number | null {
  const text = entry?.spell?.range ?? '';
  if (/^(touch|касание)/i.test(text)) return 5;
  const feet = /(\d+)\s*(?:feet|foot|фут)/i.exec(text);
  return feet && !/^self/i.test(text) ? Number(feet[1]) : null;
}

const aimedRange = computed<number | null>(() => {
  if (popover.value === 'attack') {
    if (armedWeapon.value && mapAiming.value) return weaponLimit(armedWeapon.value);
    if (hoverWeapon.value) return weaponLimit(hoverWeapon.value);
    return weapons.value.length ? Math.max(...weapons.value.map(weaponLimit)) : null;
  }
  if (popover.value === 'spell' && castingEntry.value) return spellRangeFeet(castingEntry.value);
  return null;
});
watch(aimedRange, feet => emit('range', feet), { immediate: true });
onBeforeUnmount(() => emit('range', null));

const selectedTarget = computed(() => props.targets.find(target => target.characterId === targetId.value));
const weaponCards = computed(() => weapons.value.map(weapon => weaponCard(weapon, {
  distance: selectedTarget.value?.distanceFeet ?? null, option: weaponOption(weapon.id), blocked: weaponBlocked(weapon.id),
  preview: previewText(weapon.id), bonus: attackUsing.value === 'bonus',
})));

function runRowAction(call: RowCall) {
  if (call.kind === 'feature') return useFeature(call.id, { mode: call.mode });
  if (call.kind === 'standard') return standardAction(call.action, call.using);
  return stealthAction(call.action, call.using);
}
</script>

<template>
  <section class="game-actions" aria-label="Действия">
    <ActorCard
      :actor="actor" :movement-left="movementLeft" :economy="economy" :working="working" :error="popover ? '' : actionError"
      @open-sheet="emit('openSheet')" @focus="emit('focus')" @deselect="emit('deselect')" @economy="markEconomy" @dismiss="actionError = ''"
    />

    <div class="action-slots" role="toolbar" aria-label="Действия персонажа">
      <div ref="catRow" class="cat-row" :class="{ compact: compactCats }">
        <button v-if="dying" type="button" class="cat death" :disabled="working || busy || Boolean(deathSaveNote)" :title="deathSaveNote ?? 'Спасбросок от смерти'" @click="deathSave"><GameIcon name="heart" :size="24" /><span>Не умереть</span></button>
        <button v-if="prone" type="button" class="cat" :disabled="working || busy" title="Встать: в бою — половина скорости" @click="stand"><GameIcon name="run" :size="24" /><span>Встать</span></button>
        <button type="button" class="cat" :disabled="blockedAct" :aria-pressed="popover === 'attack'" :title="incapacitated ? `Не может атаковать: ${incapacitated}` : 'Атака оружием'" @click="toggle('attack')"><GameIcon name="sword" :size="24" /><span>Атака</span></button>
        <button type="button" class="cat" :disabled="blockedAct" :aria-pressed="popover === 'spell'" title="Заклинания" @click="toggle('spell')"><GameIcon name="sparkle" :size="24" /><span>Магия</span></button>
        <button v-if="features.length && canRoll" type="button" class="cat features-slot" :class="{ raging: actor?.conditions.includes('raging') }" :aria-pressed="popover === 'features'" title="Умения класса" @click="toggle('features')"><GameIcon name="bolt" :size="24" /><span>Умения</span></button>
        <button type="button" class="cat" :disabled="!canRoll" :aria-pressed="popover === 'checks'" title="Навык, спасбросок или проверка характеристики" @click="toggle('checks')"><GameIcon name="target" :size="24" /><span>Проверки</span></button>
        <button
          v-if="(inCombat && economy) || (!inCombat && actor && actor.canAct && actor.kind !== 'object' && sceneId)" type="button" class="cat"
          :disabled="busy || (inCombat && !isActorTurn) || Boolean(incapacitated)" :aria-pressed="popover === 'actions'" title="Рывок, Отход, Уклонение, Спрятаться, Искать" @click="toggle('actions')"
        ><GameIcon name="run" :size="24" /><span>Действия</span></button>
        <button v-if="!inCombat && (canRoll || canStartCombat)" type="button" class="cat" :disabled="busy" :aria-pressed="popover === 'rest'" title="Короткий или долгий отдых" @click="toggle('rest')"><GameIcon name="moon" :size="24" /><span>Отдых</span></button>
        <button v-if="lootTargets.length && canRoll" type="button" class="cat loot-slot" :disabled="busy || Boolean(incapacitated)" :aria-pressed="popover === 'loot'" @click="toggle('loot')"><GameIcon name="chest" :size="24" /><span>Обыскать</span></button>
        <button v-if="tradeTargets.length && canRoll && !inCombat" type="button" class="cat trade-slot" :disabled="busy" :aria-pressed="popover === 'trade'" @click="tradeTargets.length === 1 ? emit('trade', tradeTargets[0]!) : toggle('trade')"><GameIcon name="bag" :size="24" /><span>Торговать</span></button>
        <button v-if="actor?.inspired && canRoll" type="button" class="cat inspiration" :aria-pressed="useInspiration" title="Потратить вдохновение на следующий бросок" @click="useInspiration = !useInspiration"><GameIcon name="sparkle" :size="24" /><span>{{ useInspiration ? 'Тратим' : 'Вдохн.' }}</span></button>
        <button v-else-if="canInspire && actor?.kind === 'character' && !actor.inspired" type="button" class="cat" :disabled="working" title="Даровать вдохновение" @click="inspire"><GameIcon name="sparkle" :size="24" /><span>Даровать</span></button>
        <button v-if="hasBardic && canRoll" type="button" class="cat inspiration" :aria-pressed="useBardic" title="Кость вдохновения барда — к следующему броску" @click="useBardic = !useBardic"><GameIcon name="sparkle" :size="24" /><span>{{ useBardic ? 'С костью' : 'Кость' }}</span></button>
      </div>

      <TurnColumn
        v-model:advantage="advantage" :can-roll="canRoll" :advantage-info="advantageInfo" :busy="busy"
        :in-combat="inCombat" :is-actor-turn="isActorTurn" :movement-left="movementLeft" :can-start-combat="canStartCombat" :can-join="canJoin"
        :can-leave="canLeave" :can-auto-turn="canAutoTurn" :auto-target-label="autoTargetLabel" :auto-open="popover === 'auto'" :can-advance="canAdvance"
        @start-combat="emit('startCombat')" @join="emit('join')" @leave="emit('leave')" @dash="emit('dash')" @auto-turn="emit('autoTurn')"
        @toggle-auto="toggle('auto')" @advance="emit('advance')"
      />

      <div v-if="popover" ref="popoverEl" class="action-popover g-frame" :class="{ aiming: mapAiming }" :data-command="popover" role="dialog" :aria-label="commandTitle[0]" :style="popoverShift ? { left: `${popoverShift}px` } : undefined">
        <header class="command-header">
          <span class="command-seal" aria-hidden="true"><GameIcon :name="commandTitle[1]" :size="26" /></span>
          <div><small>{{ actor?.name ?? 'Игровой стол' }}</small><h3>{{ commandTitle[0] }}</h3></div>
          <button type="button" class="command-close" aria-label="Закрыть меню команд" @click="popover = null"><GameIcon name="close" :size="18" /></button>
        </header>
        <div v-if="economy && ['attack', 'actions', 'spell', 'features'].includes(popover)" class="command-budget" aria-label="Ресурсы хода">
          <span :class="{ spent: !economy.action }"><i />Действие{{ economy.action ? '' : ' · потрачено' }}</span>
          <span :class="{ spent: !economy.bonus }"><i />Бонусное{{ economy.bonus ? '' : ' · потрачено' }}</span>
          <span :class="{ spent: !economy.reaction }"><i />Реакция{{ economy.reaction ? '' : ' · потрачена' }}</span>
          <span v-if="hasteAction" title="Одна атака оружием, Рывок, Отход или Засада"><i />«Ускорение»: ещё действие</span>
        </div>
        <section v-if="mapAiming" class="aim-panel" aria-live="polite">
          <div class="aim-action"><img :src="aimArt" alt="" /><div><small>{{ working ? 'Выполняется…' : 'Выберите цель на карте' }}</small><strong>{{ aimName }}</strong></div></div>
          <p>{{ aimHint }}</p>
          <p v-if="popover === 'spell' && castingEntry?.spell?.area" class="aim-area-note" :class="{ off: areaHover && !areaHover.inRange }">
            {{ areaHover ? (areaHover.inRange ? (areaHover.names.length ? `Задето: ${areaHover.names.length} — ${areaHover.names.slice(0, 5).join(', ')}${areaHover.names.length > 5 ? '…' : ''}` : 'Пока никого не задевает') : 'Слишком далеко — подведите ближе') : 'Наведите курсор на карту' }}
          </p>
          <p v-if="actionError" class="popover-error" role="alert">{{ actionError }}</p>
          <div v-if="castTargets.length && popover === 'spell'" class="aim-targets"><span v-for="id in castTargets" :key="id">{{ targets.find(t => t.characterId === id)?.name ?? actor?.name }}</span></div>
          <div class="aim-controls">
            <button v-if="popover === 'spell' && castingEntry && castTargets.length" type="button" class="primary" :disabled="working || ((spellNeedsTargets(castingEntry.spell?.mechanics) || Boolean(castingEntry.spell?.riders?.length)) && !castTargets.length && !castArea)" @click="cast(castingEntry)">Сотворить · {{ castTargets.length }}</button>
            <button v-if="popover !== 'features'" type="button" :disabled="working" @click="mapAiming = false">{{ popover === 'spell' ? 'Параметры заклинания' : 'Другое оружие' }}</button>
            <button type="button" :disabled="working" @click="cancelStep">Отмена · Esc</button>
          </div>
        </section>
        <div v-show="!mapAiming" class="command-body" :key="`${popover}:${castingEntry?.id ?? ''}`">
        <p v-if="actionError" class="popover-error" role="alert">
          <span>{{ actionError }}</span>
          <button type="button" aria-label="Закрыть сообщение" @click="actionError = ''"><GameIcon class="inline-icon" name="close" :size="16" /></button>
        </p>
        <template v-if="popover === 'attack'">
          <h4 class="command-section-title">Выберите цель и оружие</h4>
          <p class="map-instruction">Выберите оружие, затем нажмите на цель на карте.</p>
          <AttackSettings
            v-model:warn-friendly="warnFriendly" v-model:attack-using="attackUsing" v-model:two-handed="twoHanded"
            v-model:use-power="usePower" v-model:use-stroke="useStroke" v-model:use-lucky="useLucky" v-model:use-precision="usePrecision"
            :working="working" :has-target="Boolean(targetId)" :using="usingView" :attacks-left="attacksLeftText" :versatile="hasVersatile"
            :power-feat="powerFeat" :stroke-ready="strokeReady" :lucky="knowsFeat('lucky')" :precision="knowsManeuver('precision')"
          />
          <WeaponButton
            v-for="card in weaponCards" :key="card.weapon.id" :card="card" :working="working"
            @arm="armWeapon(card.weapon)" @hover="hoverWeapon = $event"
          />
          <p v-if="!weapons.length" class="muted">Оружия в листе нет — добавьте его на вкладке «Снаряжение».</p>
        </template>
        <template v-else-if="popover === 'spell'">
          <SpellCastPanel
            v-if="castingEntry && castView"
            v-model:cast-mode="castMode" v-model:cast-element="castElement" v-model:conjure-option="conjureOption" v-model:cast-beast="castBeast"
            v-model:warn-friendly="warnFriendly" v-model:cast-slot="castSlot" v-model:cast-metamagic="castMetamagic"
            v-model:cast-heightened="castHeightened" v-model:cast-empowered="castEmpowered" v-model:use-ritual="useRitual"
            v-model:cast-overchannel="castOverchannel" v-model:use-free="useFree" v-model:use-racial="useRacial" v-model:use-pact="usePact"
            :entry="castingEntry" :view="castView" :working="working" :in-combat="inCombat"
            @aim="mapAiming = true" @cast="cast(castingEntry)" @back="castingEntry = null" @shots="changeShots"
          />
          <SpellCatalogPanel
            v-else
            v-model:query="spellQuery" v-model:circle="spellCircle"
            :spells="visibleSpells" :known="sortedSpells.length" :circles="spellCircles" :slots="slotList" :pact="pactSlots"
            :working="working" :campaign-id="campaignId" :request="request" :favorite="favoriteSpell" @choose="chooseSpell"
          />
        </template>
        <ActionsPanel
          v-else-if="popover === 'actions'"
          v-model:ready-trigger="readyTrigger" v-model:help-ally="helpAlly" v-model:help-foe="helpFoe"
          :working="working" :economy="economy" :haste-action="hasteAction" :can-attack-action="canAttackAction"
          :target-id="targetId" :target-name="targetName" :targets="targets" :actor-hidden="actorHidden"
          :actor-grappled="actorGrappled" :has-cunning-action="hasCunningAction"
          :expeditious="Boolean(actor?.conditions.includes('expeditious'))" :vanish="features.some(feature => feature.id === 'vanish')"
          :shield-master="knowsFeat('shield-master')" @standard="standardAction" @stealth="stealthAction" @combat="combatAction"
        />
        <AutoTurnPanel v-else-if="popover === 'auto'" :auto-target="autoTarget" :busy="busy" @pick="pickAutoTarget" />
        <template v-else-if="popover === 'features'">
          <h4 class="command-section-title">{{ featureClass || 'Таланты персонажа' }}</h4>
          <label v-for="item in subclasses" :key="item.classId" class="target-select feature-row" title="Какой подкласс считает автоматика: умения подкласса SRD — Чемпион, Домен Жизни, Охотник">
            Подкласс «{{ item.className }}»
            <select :value="item.value" :disabled="working" @change="setSubclass(item.classId, ($event.target as HTMLSelectElement).value)">
              <option v-for="option in item.options" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <template v-for="feature in features" :key="feature.id">
            <FeatureButton
              v-if="FEATURE_BUTTONS.has(feature.id)"
              :card="featureButton(feature, rageFrenzy)" :working="working" :title="featureTitle(feature)" @activate="pressFeature(feature)"
            />
            <BardicInspirationRow
              v-else-if="feature.id === 'bardic-inspiration'" :feature="feature" :working="working"
              :title="featureTitle(feature)" @aim="aimBardic(feature)"
            />
            <FeatureActionsRow
              v-else-if="ACTION_ROWS.has(feature.id)" :feature="feature" :working="working" :title="featureTitle(feature)" @act="runRowAction"
            />
            <BreathWeaponRow
              v-else-if="feature.id === 'breath-weapon'" :feature="feature" :working="working"
              :scene-id="sceneId" :title="featureTitle(feature)" @ancestry="setAncestry" @aim="aimBreath(feature)"
            />
            <InfernalLegacyRow
              v-else-if="feature.id === 'infernal-legacy'" :feature="feature" :working="working"
              :title="feature.text" @add="addLegacySpell"
            />
            <CleansingTouchRow
              v-else-if="feature.id === 'cleansing-touch'" :feature="feature" :working="working"
              v-model:cleanse-spell="cleanseSpell" :cleanse-spells="cleanseSpells" :cleanse-name="cleanseName" :title="featureTitle(feature)" @aim="aimCleanse(feature)"
            />
            <LayOnHandsRow
              v-else-if="feature.id === 'lay-on-hands'" :feature="feature" :working="working"
              v-model:hands-amount="handsAmount" v-model:hands-cure="handsCure" :title="featureTitle(feature)" @aim="aimHands(feature)"
            />
            <WildShapeRow
              v-else-if="feature.id === 'wild-shape'" v-model:beast="beast" :feature="feature" :working="working"
              :title="featureTitle(feature)" @use="useFeature"
            />
            <FeatureToggle
              v-else-if="FEATURE_TOGGLES.has(feature.id)"
              :card="featureToggle(feature)" :working="working" :title="feature.text" @toggle="toggleReady(feature)"
            />
            <FlexibleCastingRow
              v-else-if="feature.id === 'flexible-casting'" v-model:level="flexLevel" :feature="feature" :working="working"
              :title="featureTitle(feature)" @convert="mode => useFeature('flexible-casting', { mode, slotLevel: flexLevel })"
            />
            <QuiveringPalmRow
              v-else-if="feature.id === 'quivering-palm'" :feature="feature" :working="working"
              :title="featureTitle(feature)" @aim="aimQuivering(feature)"
            />
            <FiendishResilienceRow
              v-else-if="feature.id === 'fiendish-resilience'" :feature="feature" :working="working"
              :title="feature.text" @pick="event => pickSingle(feature, event)"
            />
            <ChipsRow
              v-else-if="CHIP_CHOICES.has(feature.id)" :feature="feature" :working="working" :can-speak="Boolean(sceneId)"
              :title="feature.text" @choose="(value, on) => setChoice(feature, value, on)"
              @ready="(key, on) => toggleProtection(on, key)" @speech="inspiringSpeech()"
            />
            <ChoiceListRow
              v-else-if="CHOICE_PATH[feature.id]" :feature="feature" :working="working" :title="feature.text"
              @choose="(value, on) => setChoice(feature, value, on)" @ready="(key, on) => toggleProtection(on, key)"
              @multiattack="kind => kind === 'volley' ? aimTargeted(feature, 'volley', rangedReach, 'ui/symbols/target') : useFeature(kind)"
            />
            <PreserveLifeRow
              v-else-if="feature.id === 'preserve-life'" v-model:pick="preservePick" :feature="feature" :working="working"
              :sum="preserveSum" :title="featureTitle(feature)" @spread="preserveSpread(feature)" @preserve="preserveLife"
            />
            <RecklessAttackRow
              v-else-if="feature.id === 'reckless-attack'" :feature="feature" :working="working"
              :title="featureTitle(feature)" @use="useFeature('reckless-attack')"
            />
            <FrenzyRow
              v-else-if="feature.id === 'frenzy'" :feature="feature" :working="working"
              v-model:rage-frenzy="rageFrenzy" :target-id="targetId" :title="featureTitle(feature)" @aim="aimTargeted(feature, 'frenzy-attack', meleeReach, 'ui/symbols/sword')"
            />
            <OpenHandTechniqueRow
              v-else-if="feature.id === 'open-hand-technique'" :feature="feature" :working="working"
              v-model:flurry-technique="flurryTechnique" :title="feature.text"
            />
            <SlotRecoveryRow
              v-else-if="feature.id === 'arcane-recovery' || feature.id === 'natural-recovery'" v-model:pick="slotPicks[feature.id]"
              :feature="feature" :working="working" :sum="slotSum(feature.id)" :title="featureTitle(feature)"
              @recover="recoverSlots(feature.id)"
            />
            <FeaturePassiveCard v-else :feature="feature" />
          </template>
        </template>
        <template v-else-if="popover === 'trade'">
          <h4>Торговать с</h4>
          <button v-for="target in tradeTargets" :key="target.characterId" type="button" @click="popover = null; emit('trade', target)">{{ target.name }}</button>
        </template>
        <template v-else-if="popover === 'loot' && actor">
          <h4>Добыча</h4>
          <LootPanel
            v-for="target in lootTargets" :key="target.characterId"
            :campaign-id="campaignId" :scene-id="sceneId"
            :corpse="{ characterId: target.characterId, name: target.name }"
            :looter="{ characterId: actor.characterId, name: actor.name }"
            :request="request"
          />
        </template>
        <RestPanel
          v-else-if="popover === 'rest'" v-model:party-xp="partyXp" :can-roll="canRoll" :actor="actor" :campaign-id="campaignId"
          :request="request" :hit-dice="hitDice" :working="working" :can-start-combat="canStartCombat"
          @rested="onRested" @rest-party="restParty" @begin-rest="kind => { popover = null; emit('beginRest', kind); }"
          @award-party="xp => { popover = null; emit('awardParty', xp); }"
        />
        <DiceTrayPanel
          v-else-if="popover === 'dice'"
          v-model:modifier="trayModifier" v-model:advantage="trayAdvantage" v-model:hidden="trayHidden"
          :counts="trayCounts" :recent="recentFormulas" :can-hide="canHide" :busy="busy" @add="trayAdd" @clear="trayClear" @roll="rollTray"
        />
        <ChecksPanel
          v-else
          v-model:sense="sense" v-model:check-tab="checkTab" v-model:use-peerless="usePeerless"
          v-model:use-lucky-check="useLuckyCheck" v-model:use-stroke-check="useStrokeCheck"
          :popover="popover" :skills="skills" :working="working" :lucky="knowsFeat('lucky')"
          :stroke-ready="strokeReady" :peerless="peerlessFeature" @check="check"
        />
        </div>
        <small class="command-footer" v-if="popover !== 'rest' && popover !== 'loot' && popover !== 'trade' && popover !== 'features' && popover !== 'dice'">{{ advantageInfo.label }} · бросок увидят все в журнале</small>
      </div>
      <HitOffers
        v-model:smite-offer="smiteOffer" v-model:stun-offer="stunOffer" v-model:quivering-offer="quiveringOffer"
        v-model:hurl-offer="hurlOffer" v-model:maneuver-offer="maneuverOffer"
        :actor-id="actor?.characterId" :popover-open="Boolean(popover)" :working="working"
        @smite="smite" @stun="stunningStrike" @quivering="quiveringPalm" @hurl="hurlThroughHell" @maneuver="useManeuver"
      />
    </div>

    <div v-if="eyes" class="eyes-wrap">
      <button
        type="button"
        class="eyes-toggle"
        :aria-pressed="eyes.on"
        :title="eyes.on ? 'Глазами выбранного включено — карта с его туманом. Нажмите, чтобы выключить' : 'Глазами выбранного: карта с туманом того, кого вы выбрали на карте'"
        @click="emit('eyes', !eyes.on)"
      >
        <GameIcon name="eye" :size="22" /><span>Глазами</span>
        <small v-if="eyes.on && eyes.name" translate="no">{{ eyes.name }}</small>
        <small v-else>выбранного</small>
      </button>
    </div>
    <div class="dice-open-wrap">
      <button type="button" class="dice-open" :aria-pressed="popover === 'dice'" title="Лоток кубиков" @click="toggle('dice')">
        <GameIcon name="dice" :size="22" /><span>Кубики</span>
      </button>
    </div>

  </section>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.game-actions{position:relative;display:flex;align-items:center;gap:12px;min-width:0;height:100%;padding:0 4px}
.popover-error button{flex:none;width:22px;height:22px;min-height:0;padding:0;border-radius:50%;font-size:11px;line-height:1}
.popover-error{position:sticky;top:-14px;z-index:2;display:flex;align-items:flex-start;gap:8px;margin:-14px -4px 4px -14px;padding:8px 6px 8px 14px;font-size:13px;line-height:1.35;color:#ffd9d2;background:#3a1410;box-shadow:inset 0 -1px 0 #a8453b}
.action-slots{position:relative;display:flex;align-items:center;flex:1 1 0;min-width:0;container-type:inline-size;container-name:slots}
.loot-slot,.trade-slot{color:#f1d27a}
.features-slot{color:#ffd9a0}
.features-slot.raging{box-shadow:0 0 0 2px #e0522f,0 0 14px #e0522f}
.out-of-range{opacity:.55}
/* vw/vh are divided by --ui-zoom: inside CSS zoom they would be multiplied again. */
.action-popover{position:absolute;left:0;bottom:calc(100% + 18px);z-index:5;width:min(440px,calc(70vw / var(--ui-zoom, 1)));max-height:min(calc(52vh / var(--ui-zoom, 1)),460px);overflow-y:auto;overflow-x:hidden;padding:14px;display:flex;flex-direction:column;gap:6px}
.action-popover > *{flex-shrink:0}
/* Thresholds use the bar's own width (@container), not @media: under UI zoom @media sees the unzoomed window. */
.game-actions{container-type:inline-size;container-name:actions}
.dice-open-wrap{position:relative}
.cat-row{display:flex;align-items:center;align-content:center;justify-content:center;flex-wrap:wrap;gap:6px 8px;flex:1 1 auto;min-width:0;max-height:calc(var(--game-bottom,154px) - 30px);overflow-y:auto;scrollbar-width:none}
.cat-row::-webkit-scrollbar{display:none}
.cat-row.compact{gap:4px;scrollbar-width:thin;scrollbar-color:var(--g-gold-lo,#6b5233) transparent}
.cat-row.compact .cat{flex:0 0 44px;width:44px;height:44px;padding:2px}
.cat-row.compact .cat > span{display:none}
.cat{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;flex:0 0 76px;width:76px;height:76px;min-height:0;padding:4px 2px;font:600 13px var(--g-title-font);position:relative}
.cat.death{color:#fff2cf;background:linear-gradient(180deg,#ffffff22,#0000 50%),linear-gradient(180deg,#7a1b16,#3a0907)}
.cat.inspiration{color:#ffe9a0}
.cat.inspiration[aria-pressed="true"]{box-shadow:0 0 0 2px #ffcf4a,0 0 14px #ffcf4a}
@container slots (max-width: 820px){.cat{flex-basis:62px;width:62px;height:54px;gap:2px;font:600 12px var(--g-body-font)}.cat :deep(svg){width:18px;height:18px}}
.dice-open-wrap{display:flex;align-items:center;gap:8px;margin-left:auto}
.dice-open{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;width:66px;height:62px;min-height:0;padding:2px;font-size:12px}
.eyes-wrap{position:relative;display:flex;align-items:center;margin-left:auto}
.eyes-wrap + *{margin-left:8px}
.eyes-toggle{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:66px;height:62px;min-height:0;padding:2px;font-size:12px;line-height:1.1}
.eyes-toggle small{max-width:60px;font:600 11px var(--g-body-font);opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.eyes-toggle[aria-pressed="true"]{color:var(--g-gold-hi);box-shadow:inset 0 0 0 1px var(--g-gold-hi),0 0 12px var(--g-glow,#f0c86a66)}
@media (max-width:1100px){.game-actions{gap:8px}}

.game-actions .action-popover{box-sizing:border-box;width:min(430px,calc(92vw / var(--ui-zoom,1)));max-height:min(calc(60vh / var(--ui-zoom,1)),580px);padding:0;gap:0;overflow:hidden;border:1px solid var(--g-gold-lo,var(--brass));border-radius:8px;background:var(--parchment-background);color:var(--ink);box-shadow:var(--g-ring),var(--g-shadow)}
.game-actions .action-popover::before,.game-actions .action-popover::after{display:none}
.command-header{display:flex;align-items:center;flex-wrap:nowrap;gap:12px;margin:0;padding:14px 16px;border-bottom:3px double var(--brass-light);background:linear-gradient(100deg,color-mix(in srgb,var(--brass) 20%,transparent),transparent);flex:none}
.command-header>div{min-width:0;flex:1}
.command-header small{display:block;font:11px/1.4 var(--g-body-font,Georgia);letter-spacing:.04em;color:var(--muted-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.command-header h3{margin:3px 0 0;font:24px/1.1 var(--heading-font);color:var(--g-gold,var(--ink))}
.command-seal{display:grid;place-items:center;width:42px;height:46px;flex:none;border:1px solid var(--brass);border-radius:22px 22px 6px 6px;color:var(--g-gold,var(--ink));background:var(--surface-inset);box-shadow:inset 0 0 0 3px color-mix(in srgb,var(--brass) 14%,transparent)}
.action-popover .command-close{display:grid;place-items:center;width:28px;height:28px;min-height:28px;padding:0;flex:none;border:1px solid var(--brass-light);background:var(--surface-inset);border-radius:50%;color:var(--ink);box-shadow:none}
.command-budget{display:flex;flex-wrap:wrap;gap:6px 12px;padding:8px 16px;background:var(--surface-inset);border-bottom:1px solid var(--brass-light);font:11px/1.4 var(--g-body-font,Georgia);color:var(--ink)}
.command-budget span{display:flex;align-items:center;gap:6px}.command-budget i{width:6px;height:6px;transform:rotate(45deg);background:var(--g-gold,var(--brass))}.command-budget .spent{color:var(--muted-ink)}.command-budget .spent i{background:transparent;border:1px solid var(--muted-ink);box-sizing:border-box}
.action-popover .command-body{min-height:0;flex:1 1 auto;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px;scrollbar-width:thin;overscroll-behavior:contain}
.action-popover .command-footer{display:block;flex:none;padding:8px 16px;border-top:1px solid var(--brass-light);background:var(--surface-inset);color:var(--muted-ink);font:11px/1.4 var(--g-body-font,Georgia)}
.action-popover .popover-error{border:1px solid var(--g-bad,var(--brass));border-radius:4px;background:color-mix(in srgb,var(--g-bad,var(--brass)) 14%,transparent);color:var(--ink);font:13px/1.5 var(--g-body-font,Georgia);padding:10px;margin:0}
.aim-panel{padding:16px;overflow:auto;min-height:0;flex:1 1 auto!important;display:flex;flex-direction:column;gap:12px;background:radial-gradient(ellipse at 0 0,color-mix(in srgb,var(--brass) 18%,transparent),transparent 70%)}
.game-actions .action-popover.aiming{width:min(360px,calc(92vw / var(--ui-zoom,1)))}
.action-popover.aiming .command-header{padding:7px 12px;gap:8px}.action-popover.aiming .command-header h3{font-size:16px}.action-popover.aiming .command-seal{width:30px;height:34px}
.action-popover.aiming .command-footer,.action-popover.aiming .command-header,.action-popover.aiming .command-budget{display:none}.action-popover.aiming .aim-panel{padding:8px 10px;gap:6px}
.action-popover.aiming .aim-panel>p:not(.popover-error):not(.aim-area-note){font-size:12px;color:var(--muted-ink)}
.action-popover.aiming .aim-action img{width:40px;height:40px}.action-popover.aiming .aim-action strong{font-size:16px}
.aim-action{display:flex;align-items:center;gap:14px}.aim-action img{width:56px;height:56px;object-fit:contain;filter:drop-shadow(0 3px 4px #0008)}.aim-action div{min-width:0}.aim-action small{display:block;font-size:12px;color:var(--muted-ink)}.aim-action strong{display:block;font:18px/1.4 var(--g-title-font,Georgia);color:var(--ink)}
.aim-panel p{margin:0;font:13px/1.5 var(--g-body-font,Georgia)}.aim-panel .aim-area-note{padding:6px 9px;border-left:3px solid var(--brass);background:var(--surface-inset);font-weight:600}.aim-panel .aim-area-note.off{border-left-color:#e0574c;color:#f0a49c}.aim-controls{display:flex;gap:8px;flex-wrap:wrap}.action-popover .aim-controls button{font-size:12px;min-height:32px;padding:6px 10px}.aim-targets{display:flex;flex-wrap:wrap;gap:5px}.aim-targets span{padding:4px 8px;border:1px solid var(--brass);background:var(--surface-inset);font-size:12px}
</style>
