<script setup lang="ts">
import { CHECK_SKILL_NAMES } from '../../../../../packages/domain/minigames/skill-checks';
// The GM's choice of a hero check when preparing a game: the skill (or none) and its DC.
defineProps<{ skills: readonly string[]; disabled: boolean; purpose: string }>();
const skill = defineModel<string>('skill', { required: true });
const dc = defineModel<number>('dc', { required: true });
</script>

<template>
  <div class="check-setup">
    <label>Проверка навыка
      <select v-model="skill" :disabled="disabled">
        <option value="">Без проверки</option>
        <option v-for="id in skills" :key="id" :value="id">{{ CHECK_SKILL_NAMES[id] }}</option>
      </select>
    </label>
    <label v-if="skill">СЛ<input v-model.number="dc" type="number" min="5" max="30" required :disabled="disabled" /></label>
    <small>{{ purpose }}</small>
  </div>
</template>

<style scoped>
.check-setup{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 12px;align-items:end}
.check-setup label{display:grid;gap:6px;font-size:13px}
.check-setup input{width:90px}
.check-setup small{grid-column:1/-1;line-height:1.5;color:var(--muted-ink);font-size:12px}
</style>
