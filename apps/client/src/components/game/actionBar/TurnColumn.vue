<script setup lang="ts">
import { ADVANTAGE, type AdvantageId } from '../../../actionBar/constants';
import type { ActionBarProps } from '../../../actionBar/types';

defineProps<{
  canRoll: boolean;
  advantageInfo: (typeof ADVANTAGE)[number];
  busy: boolean;
  inCombat: boolean;
  isActorTurn: boolean;
  movementLeft: ActionBarProps['movementLeft'];
  canStartCombat: boolean;
  canJoin: boolean;
  canLeave?: boolean;
  canAutoTurn: boolean;
  autoTargetLabel: string;
  autoOpen: boolean;
  canAdvance: boolean;
}>();
const advantage = defineModel<AdvantageId>('advantage', { required: true });
const emit = defineEmits<{ startCombat: []; join: []; leave: []; dash: []; autoTurn: []; toggleAuto: []; advance: [] }>();
</script>

<template>
  <div class="turn-column">
    <select v-model="advantage" class="adv-select" :class="advantage" :disabled="!canRoll" :title="advantageInfo.rule" aria-label="Режим броска">
      <option v-for="entry in ADVANTAGE" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
    </select>
    <div class="turn-buttons">
      <button v-if="canStartCombat" type="button" class="turn-button start-combat" :disabled="busy" title="Начать бой: инициатива всем на сцене" @click="emit('startCombat')">Начать бой</button>
      <button v-if="canJoin" type="button" class="turn-button" :disabled="busy" title="Вступить в бой: бросок инициативы того, кем действуете" @click="emit('join')">Вступить</button>
      <button v-if="canLeave" type="button" class="turn-button leave-combat" :disabled="busy" title="Выйти из боя: убрать своё существо из очереди хода" @click="emit('leave')">Выйти из боя</button>
      <button v-if="inCombat" type="button" class="turn-button" :disabled="busy || !isActorTurn" :title="movementLeft ? `Рывок: осталось ${movementLeft.feet} из ${movementLeft.budget} фут.` : 'Рывок'" @click="emit('dash')">Рывок<span v-if="movementLeft" class="dash-feet"> · {{ movementLeft.feet }}</span></button>
      <span v-if="canAutoTurn" class="auto-split">
        <button type="button" class="turn-button" :disabled="busy" :title="`Авто-ход НПС: цель — ${autoTargetLabel}`" @click="emit('autoTurn')">Авто-ход</button>
        <button type="button" class="turn-button auto-caret-button" :disabled="busy" :aria-pressed="autoOpen" :title="`Кого бить: ${autoTargetLabel}`" @click="emit('toggleAuto')">▾</button>
      </span>
      <button v-if="canAdvance" type="button" class="turn-button end-turn" :disabled="busy" title="Закончить ход" @click="emit('advance')">Конец хода</button>
    </div>
  </div>
</template>

<style scoped>
.auto-caret-button{min-width:0;padding-inline:8px}
.turn-column{display:flex;flex-direction:column;justify-content:center;gap:5px;flex:0 0 184px;width:184px;margin-left:8px;min-width:0;max-height:100%}
.adv-select{min-height:28px;height:28px;padding:0 6px;font-size:12px;width:100%;max-width:none}
.adv-select.adv{color:#9fe0a8}.adv-select.disadv{color:#ff9c8c}
.turn-buttons{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px}
.turn-button{min-width:0;min-height:32px;padding:2px 8px;font:600 13px/1.1 var(--g-title-font);white-space:normal}
.turn-button.end-turn{grid-column:1 / -1;min-height:38px;color:#fff2cf;background:linear-gradient(180deg,#ffffff22,#0000 50%),linear-gradient(180deg,var(--g-accent-hi),var(--g-accent))}
.auto-split{display:flex;min-width:0}
.auto-split > .turn-button:first-child{flex:1 1 auto;border-top-right-radius:0;border-bottom-right-radius:0}
.auto-split > .auto-caret-button{flex:none;padding-inline:5px;margin-left:1px;border-top-left-radius:0;border-bottom-left-radius:0}
.turn-button.start-combat{color:#fff2cf;background:linear-gradient(180deg,#ffffff22,#0000 50%),linear-gradient(180deg,#8a5a12,#3a2405)}
@container actions (max-width:951px){.turn-column{flex-basis:150px;width:150px}.turn-button{padding:2px 5px;font-size:12px}.dash-feet{display:none}}
</style>
