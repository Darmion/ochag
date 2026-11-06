<script setup lang="ts">
import RestControls, { type HitDiceView } from '../../sheet/RestControls.vue';
import type { ActionActor, ActionBarProps } from '../../../actionBar/types';
import GameIcon from '../GameIcon.vue';

defineProps<{
  canRoll: boolean;
  actor: ActionActor | null;
  campaignId: string;
  request: ActionBarProps['request'];
  hitDice: HitDiceView | null;
  working: boolean;
  canStartCombat: boolean;
}>();
const emit = defineEmits<{ rested: []; 'rest-party': [kind: 'short' | 'long']; 'begin-rest': [kind: 'short' | 'long']; 'award-party': [xp: number] }>();
const partyXp = defineModel<number>('partyXp', { required: true });
</script>

<template>
  <h4>Отдых</h4>
  <RestControls
    v-if="canRoll && actor"
    :campaign-id="campaignId"
    :character-id="actor.characterId"
    :request="request"
    :hit-dice="hitDice"
    :disabled="working"
    @rested="emit('rested')"
  />
  <template v-if="canStartCombat">
    <h4>Отряд на сцене</h4>
    <div class="cast-buttons">
      <button type="button" :disabled="working" title="Персонажи игроков и союзники тратят кости хитов, сколько нужно" @click="emit('rest-party', 'short')"><GameIcon class="ui-icon" name="cup" :size="20" />Короткий</button>
      <button type="button" :disabled="working" title="Все хиты, половина костей хитов, ячейки, ресурсы, истощение −1" @click="emit('rest-party', 'long')"><GameIcon class="ui-icon" name="moon" :size="20" />Долгий</button>
    </div>
    <div class="cast-buttons">
      <button type="button" :disabled="working" title="Привал на час: бой его срывает — польза только по «Завершить»" @click="emit('begin-rest', 'short')"><GameIcon class="ui-icon" name="hourglass" :size="20" />Привал: короткий</button>
      <button type="button" :disabled="working" title="Привал на 8 часов: срывает час напряжённого — польза по «Завершить»" @click="emit('begin-rest', 'long')"><GameIcon class="ui-icon" name="hourglass" :size="20" />Привал: долгий</button>
    </div>
    <div class="cast-buttons xp-row">
      <input v-model.number="partyXp" type="number" min="1" max="1000000" aria-label="Опыт отряду" :disabled="working" />
      <button type="button" :disabled="working || !(partyXp > 0)" title="Опыт поровну персонажам игроков на сцене" @click="emit('award-party', Math.round(partyXp))"><GameIcon class="ui-icon" name="star" :size="20" />Опыт поровну</button>
    </div>
  </template>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.xp-row{margin-top:6px}
.xp-row input{width:90px;min-height:32px;padding:2px 6px}
</style>
