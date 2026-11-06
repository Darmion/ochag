<script setup lang="ts">
import type { CounterPrompt, InitiativeEntry, LegendaryOption, OpportunityPrompt, RebukePrompt, SlotChoice } from '../../tabletop/view/types';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  busy: boolean;
  counterPrompts: CounterPrompt[];
  rebukePrompts: RebukePrompt[];
  opportunityPrompts: OpportunityPrompt[];
  legendaryBosses: Array<{ entry: InitiativeEntry; max: number; left: number }>;
  bossOptions: Record<string, LegendaryOption[]>;
  secondsLeft: (deadline: number) => number;
  counterHint: (prompt: CounterPrompt, choice: SlotChoice) => string;
}>();
const legendaryOpen = defineModel<boolean>('legendaryOpen', { required: true });
const emit = defineEmits<{
  counterspell: [prompt: CounterPrompt];
  'skip-counterspell': [prompt: CounterPrompt];
  rebuke: [prompt: RebukePrompt];
  'skip-rebuke': [prompt: RebukePrompt];
  'take-opportunity': [prompt: OpportunityPrompt];
  'dismiss-opportunity': [prompt: OpportunityPrompt];
  'use-legendary': [entryId: string, index: number];
}>();
</script>

<template>
  <div
    v-if="opportunityPrompts.length || counterPrompts.length || rebukePrompts.length || (legendaryOpen && legendaryBosses.length)"
    class="opportunity-prompts" role="alertdialog" aria-label="Реакции и легендарные действия"
  >
    <div v-for="prompt in counterPrompts" :key="prompt.key" class="opportunity counter-prompt g-frame">
      <span>
        <GameIcon class="inline-icon" name="hand" :size="16" /> «{{ prompt.casterName }}» творит «{{ prompt.spellName }}»{{ prompt.spellLevel ? ` (${prompt.spellLevel} ур.)` : ' (заговор)' }} —
        «{{ prompt.reactorName }}»: «Контрзаклинание» (реакция)?
        <small class="prompt-timer">{{ secondsLeft(prompt.deadline) }} с</small>
      </span>
      <select v-model="prompt.choice" :disabled="busy" aria-label="Ячейка для «Контрзаклинания»">
        <option v-for="choice in prompt.choices" :key="choice.value" :value="choice.value">{{ choice.label }} — {{ counterHint(prompt, choice) }}</option>
      </select>
      <button type="button" class="primary" :disabled="busy" @click="emit('counterspell', prompt)">Прервать</button>
      <button type="button" :disabled="busy" @click="emit('skip-counterspell', prompt)">Пропустить</button>
    </div>
    <div v-for="prompt in rebukePrompts" :key="prompt.key" class="opportunity rebuke-prompt g-frame">
      <span><GameIcon class="inline-icon" name="flame" :size="16" /> «{{ prompt.triggerName }}» ранил «{{ prompt.reactorName }}» — «Адское возмездие» (реакция)?</span>
      <select v-if="prompt.choices.length > 1" v-model="prompt.choice" :disabled="busy" aria-label="Ячейка для «Адского возмездия»">
        <option v-for="choice in prompt.choices" :key="choice.value" :value="choice.value">{{ choice.label }}</option>
      </select>
      <button type="button" class="primary" :disabled="busy" @click="emit('rebuke', prompt)">Возмездие</button>
      <button type="button" :disabled="busy" @click="emit('skip-rebuke', prompt)">Пропустить</button>
    </div>
    <div v-for="prompt in opportunityPrompts" :key="prompt.key" class="opportunity g-frame">
      <span v-if="prompt.reason === 'sentinel'"><GameIcon class="inline-icon" name="swords" :size="16" /> «{{ prompt.moverName }}» бьёт другого рядом с «{{ prompt.reactorName }}» — «Часовой»: атака реакцией</span>
      <span v-else-if="prompt.reason === 'mage-slayer'"><GameIcon class="inline-icon" name="sparkle" :size="16" /> «{{ prompt.moverName }}» колдует рядом с «{{ prompt.reactorName }}» — «Убийца магов»: атака реакцией</span>
      <span v-else><GameIcon class="inline-icon" name="swords" :size="16" /> «{{ prompt.moverName }}» уходит от «{{ prompt.reactorName }}» — атака при уходе (реакция)</span>
      <button type="button" class="primary" :disabled="busy" @click="emit('take-opportunity', prompt)">Атаковать</button>
      <button type="button" :disabled="busy" @click="emit('dismiss-opportunity', prompt)">Пропустить</button>
    </div>
    <template v-if="legendaryOpen">
      <div v-for="boss in legendaryBosses" :key="boss.entry.id" class="opportunity legendary-prompt g-frame">
        <span><GameIcon class="inline-icon" name="crown" :size="16" /> «{{ boss.entry.name }}»: легендарные действия — осталось {{ boss.left }} из {{ boss.max }}</span>
        <button
          v-for="(option, index) in bossOptions[boss.entry.character_id!] ?? []" :key="index" type="button"
          :disabled="busy || option.cost > boss.left" :title="option.text || option.name" @click="emit('use-legendary', boss.entry.id, index)"
        >{{ option.name }}{{ option.cost > 1 ? ` (${option.cost})` : '' }}</button>
        <button type="button" :disabled="busy" title="До следующего хода" @click="legendaryOpen = false">Пропустить</button>
        <small v-if="!(bossOptions[boss.entry.character_id!] ?? []).length" class="muted">Варианты — в листе босса: «Босс».</small>
      </div>
    </template>
  </div>
</template>

<style scoped>
.opportunity-prompts{position:fixed;left:50%;top:calc(var(--game-top,54px) + 130px);translate:-50% 0;z-index:2300;display:grid;gap:6px;max-width:min(680px,92vw)}
.opportunity{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:#1d140cf2;color:#f1e4c5;border:1px solid #b5575d;border-radius:6px;box-shadow:0 6px 18px #000a}
.opportunity span{flex:1 1 260px;font-weight:600}
.legendary-prompt{border-color:#c9a24a}
.counter-prompt{border-color:#6f8fd8}
.rebuke-prompt{border-color:#d8742f}
.opportunity select{min-height:30px;font-size:13px;max-width:260px}
.prompt-timer{margin-left:6px;font-weight:700;color:#f1d27a}
.opportunity button{min-height:30px;padding:2px 12px;font-size:13px}
.muted{font-size:13px}
</style>
