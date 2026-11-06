<script setup lang="ts">
import { signed } from '../../../characterWizard/catalog';
import type { HeroBuilder } from '../../../characterWizard/heroBuilder';
import GameIcon from '../../game/GameIcon.vue';

defineProps<{
  wizard: HeroBuilder;
}>();
</script>

<template>
  <h3>Как зовут героя?</h3>
  <div class="name-row">
    <input v-model="wizard.choice.name" maxlength="200" placeholder="Имя героя" aria-label="Имя героя" />
    <button type="button" @click="wizard.randomName"><GameIcon class="inline-icon" name="d20" :size="16" /> Случайное имя</button>
  </div>
  <ul v-if="wizard.preview?.problems.length" class="problems" role="alert">
    <li v-for="problem in wizard.preview.problems" :key="problem">{{ problem }}</li>
  </ul>
  <template v-if="wizard.preview?.summary">
    <p><strong>Навыки:</strong> {{ wizard.preview.skills.map(skill => wizard.skillName(skill.skill_index) + (skill.expertise ? ' ×2' : '')).join(', ') }}</p>
    <p><strong>Оружие:</strong> {{ wizard.preview.weapons.map(w => `${w.name} (${w.toHit === null ? '' : `${signed(w.toHit)} к попаданию, `}${w.damage ?? 'без урона'})`).join(', ') }}</p>
    <p v-if="wizard.preview.resources.length"><strong>Особые силы:</strong> {{ wizard.preview.resources.map(r => `${r.name} ${r.max}`).join(', ') }}</p>
    <p v-if="wizard.preview.spells.length"><strong>Заклинания:</strong> {{ wizard.preview.spells.map(index => wizard.spellNames.get(index) ?? index).join(', ') }}</p>
    <p><strong>Снаряжение:</strong> {{ wizard.preview.items.join(', ') }}</p>
  </template>
  <p v-if="Object.entries(wizard.todo).some(([id, list]) => id !== 'summary' && list.length)" class="notice warning">
    Ещё не выбрано: {{ Object.entries(wizard.todo).filter(([id, list]) => id !== 'summary' && list.length).map(([id, list]) => `${wizard.STEPS.find(entry => entry.id === id)?.label ?? id} — ${list.join(', ')}`).join('; ') }}.
  </p>
</template>

<style scoped src="./wizardKit.css"></style>

<style scoped>
.name-row{display:flex;gap:8px;flex-wrap:wrap}
.name-row input{flex:1 1 240px;font-size:18px;min-height:40px}
.problems{margin:0;padding-left:18px;color:#c0392b}
</style>
