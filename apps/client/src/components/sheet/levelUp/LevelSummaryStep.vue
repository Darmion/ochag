<script setup lang="ts">
import { computed } from 'vue';
import type { LevelUp } from '../../../levelUp/useLevelUp';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{ level: LevelUp }>();

const steps = computed(() => props.level.STEPS.filter(entry => entry.id !== 'summary'));
const serverProblems = computed(() => (props.level.missing.length ? [] : props.level.preview?.problems ?? []));
</script>

<template>
  <template v-if="level.plan">
    <h3>Итог</h3>
    <div class="sub-choice">
      <span class="label">Хиты</span>
      <div class="segmented" role="radiogroup" aria-label="Хиты">
        <button type="button" role="radio" :aria-checked="level.form.hp === 'average'" :class="{ active: level.form.hp === 'average' }" @click="level.form.hp = 'average'">
          Средние <small>+{{ level.plan.averageHp }} — без риска</small>
        </button>
        <button type="button" role="radio" :aria-checked="level.form.hp === 'roll'" :class="{ active: level.form.hp === 'roll' }" @click="level.form.hp = 'roll'">
          Бросить к{{ level.plan.hitDie }}
          <small v-if="level.plan.hpBonus">+ Телосложение + {{ level.plan.hpBonus }}, не меньше 1 — бросок увидят все</small>
          <small v-else>+ Телосложение, не меньше 1 — бросок увидят все</small>
        </button>
      </div>
    </div>

    <ul class="recap">
      <li v-for="entry in steps" :key="entry.id">
        <GameIcon class="inline-icon" :name="entry.icon" :size="16" />
        <strong>{{ entry.label }}:</strong>
        <span v-if="level.todo[entry.id].length" class="missing">осталось: {{ level.todo[entry.id].join(', ') }}</span>
        <span v-else>{{ level.stepValue[entry.id] || 'без выбора' }}</span>
        <button type="button" class="link-button" @click="level.current = entry.id">Изменить</button>
      </li>
    </ul>

    <p v-if="serverProblems.length" class="error" role="alert">{{ serverProblems.join(' ') }}</p>
    <template v-if="level.preview?.features.length">
      <span class="label">Запишется в лист, в «Умения по уровням»:</span>
      <ul class="traits"><li v-for="line in level.preview.features" :key="line">{{ line }}</li></ul>
    </template>
  </template>
</template>

<style scoped src="../../characters/wizard/wizardKit.css"></style>

<style scoped>
.recap{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.recap li{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:4px 8px;border:1px solid var(--brass-light,#0003);border-radius:6px}
.recap .missing{color:#a8742c;font-weight:600}
.recap .link-button{margin-left:auto}
.error{color:#c0392b}
</style>
