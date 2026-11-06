<script setup lang="ts">
import { computed, ref } from 'vue';
import StatusBadge from '../rpg/StatusBadge.vue';
import VisibilityControl, { type VisibilitySetting } from '../common/VisibilityControl.vue';
import type { CampaignMember } from '../../campaign/members';
import { conditionInfo } from '../../rules/conditions';
import type { SheetEffects } from '../../characterSheet/effects';
import type { CharacterDTO, SheetRequest } from '../../characterSheet/types';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  character: CharacterDTO;
  effects: SheetEffects;
  readOnly: boolean;
  busy: boolean;
  campaignId: string;
  characterId: string;
  request: SheetRequest;
  campaignMembers: CampaignMember[];
  visibilityFor: (fieldKey: string) => VisibilitySetting;
}>();
const emit = defineEmits<{ visibility: [fieldKey: string, setting: VisibilitySetting] }>();
const onVisibilityChange = (fieldKey: string, setting: VisibilitySetting) => emit('visibility', fieldKey, setting);

const recordEffects = computed(() => (props.character.effects ?? []).filter(effect => effect.active));
const effectsOpen = ref(false);
</script>

<template>
  <div class="sheet-conditions">
    <span v-for="effect in recordEffects" :key="effect.id" class="effect-badge" :title="conditionInfo(effect.effect_code).rule">
      <GameIcon class="inline-icon" :name="conditionInfo(effect.effect_code).icon" :size="16" />
      {{ effects.effectLabel(effect.effect_code) }}
      <button v-if="!readOnly" type="button" class="effect-x" :aria-label="`Снять: ${effects.effectLabel(effect.effect_code)}`" :disabled="busy" @click="effects.removeEffect(effect.id)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
    </span>
    <small v-if="!recordEffects.length" class="muted">без состояний</small>
    <span v-if="!readOnly" class="effects-wrap">
      <button type="button" class="effect-add" :aria-expanded="effectsOpen" :disabled="busy" @click="effectsOpen = !effectsOpen">＋ Состояние ▾</button>
      <div v-if="effectsOpen" class="effects-popup" role="dialog" aria-label="Состояния">
        <section class="conditions-block" aria-label="Все состояния">
          <p class="muted block-help">Нажмите на состояние — выключить или включить; крестик — удалить.</p>
          <div v-if="character.effects.length" class="status-badge-grid">
            <StatusBadge
              v-for="effect in character.effects"
              :key="effect.id"
              :label="effects.effectLabel(effect.effect_code)"
              :icon="conditionInfo(effect.effect_code).icon"
              :active="effect.active"
              :read-only="busy || readOnly"
              @toggle="effects.toggleEffect(effect)"
            >
              <template v-if="!readOnly" #default>
                <button type="button" class="badge-remove" :aria-label="`Удалить эффект: ${effects.effectLabel(effect.effect_code)}`" :disabled="busy" @click="effects.removeEffect(effect.id)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
                <VisibilityControl
                  :field-key="`effect:${effect.id}`"
                  :campaign-id="campaignId"
                  :character-id="characterId"
                  :request="request"
                  :setting="visibilityFor(`effect:${effect.id}`)"
                  :members="campaignMembers"
                  @change="s => onVisibilityChange(`effect:${effect.id}`, s)"
                />
              </template>
            </StatusBadge>
          </div>
          <p v-else class="muted">Активных эффектов нет.</p>

          <div v-if="!readOnly" class="effect-quick">
            <small class="effect-quick-title">Наложить</small>
            <div class="effect-chips">
              <button
                v-for="effect in effects.CONDITION_EFFECTS" :key="effect.code" type="button" class="effect-chip"
                :disabled="busy || effects.activeEffectCodes.has(effect.code)" :title="effects.activeEffectCodes.has(effect.code) ? 'Уже наложено' : ''"
                @click="effects.addEffect(effect.code)"
              >{{ effect.label }}</button>
              <span class="effect-levels" role="group" aria-label="Истощение">
                Истощение
                <button
                  v-for="level in 6" :key="level" type="button" class="effect-chip level"
                  :disabled="busy || effects.activeEffectCodes.has(`exhaustion_${level}`)" :aria-label="`Истощение ${level}`"
                  @click="effects.addEffect(`exhaustion_${level}`)"
                >{{ level }}</button>
              </span>
            </div>
            <form class="effect-custom" @submit.prevent="effects.addEffect(effects.customEffectText)">
              <input v-model="effects.customEffectText" maxlength="50" placeholder="Свой эффект — например, «Благословлён»" aria-label="Свой эффект (домашнее правило)" :disabled="busy" />
              <button type="submit" :disabled="busy || !effects.customEffectText.trim()">Добавить свой</button>
            </form>
          </div>
        </section>

      </div>
    </span>
  </div>
</template>

<style scoped src="./sheetKit.css"></style>
<style scoped>
.effect-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:12px;font:600 12px var(--g-title-font);color:#ffd9c9;background:#4a1612;box-shadow:0 0 0 1px #b7372b;cursor:help}
.muted{font-size:13px}
.status-badge-grid{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.badge-remove{min-height:auto;width:20px;height:20px;padding:0;font-size:11px;background:transparent;border:1px solid var(--input-border);box-shadow:none;border-radius:50%}
.effects-popup :deep(.status-badge){border-radius:6px;padding:4px}
.sheet-conditions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:6px 0 0}
.sheet-conditions .effect-x{min-height:0;width:18px;height:18px;margin-left:2px;padding:0;border-radius:50%;font-size:10px;line-height:1}
.effects-wrap{position:relative}
.effect-add{min-height:26px;padding:1px 10px;font-size:12px;border-radius:13px}
.effects-popup{position:absolute;top:calc(100% + 6px);left:0;z-index:30;width:min(440px,80vw);max-height:60vh;overflow-y:auto;padding:12px;border:1px solid var(--brass);border-radius:6px;background:var(--parchment-background);box-shadow:0 12px 28px #0008}
.effect-quick{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--brass-light)}
.effect-quick-title{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-ink)}
.effect-chips{display:flex;flex-wrap:wrap;gap:5px}
.effect-chip{min-height:28px;padding:2px 10px;border-radius:14px;font-size:13px}
.effect-levels{display:inline-flex;align-items:center;gap:3px;padding-left:4px;font-size:13px;color:var(--muted-ink)}
.effect-chip.level{width:28px;padding:0}
.effect-custom{display:flex;gap:6px;margin:4px 0 0}
.effect-custom button{flex:none;white-space:nowrap}
.effect-custom input{flex:1 1 auto;min-width:0}
</style>
