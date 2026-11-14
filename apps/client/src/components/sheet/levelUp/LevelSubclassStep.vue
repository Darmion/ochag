<script setup lang="ts">
import { computed } from 'vue';
import { CLASS_OPTIONS } from '../../../rules/classOptions';
import type { LevelUp } from '../../../levelUp/useLevelUp';
import GameIcon from '../../game/GameIcon.vue';

const props = defineProps<{ level: LevelUp }>();

const groups = computed(() => {
  const options = props.level.plan?.subclass?.options ?? [];
  const automated = new Set(CLASS_OPTIONS.find(entry => entry.label === props.level.plan?.className)?.subclasses ?? []);
  return [
    ...options.filter(option => automated.has(option.label)).map(option => ({ ...option, automated: true })),
    ...options.filter(option => !automated.has(option.label)).map(option => ({ ...option, automated: false })),
  ];
});
const chosen = computed(() => groups.value.find(option => option.value === props.level.form.subclass) ?? null);
const srdChosen = computed(() => props.level.plan?.subclass?.srd === props.level.form.subclass);
const featureText = (title: string) => props.level.info?.featureTexts?.[title]?.text ?? null;
</script>

<template>
  <template v-if="level.plan?.subclass">
    <h3>Подкласс — {{ level.plan.className }} {{ level.plan.classLevel }}</h3>
    <div class="pick-layout">
      <div class="pick-list" role="listbox" aria-label="Подкласс">
        <button
          v-for="option in groups" :key="option.value" type="button" role="option"
          :aria-selected="level.form.subclass === option.value" :class="{ active: level.form.subclass === option.value }" @click="level.form.subclass = option.value"
        >
          <span class="pick-icon"><GameIcon :name="option.automated ? 'crown' : 'quill'" :size="22" /></span>
          <span><strong>{{ option.label }}</strong><small>{{ option.automated ? 'умения считает игра' : option.value === 'other' ? 'свой, по договорённости с мастером' : 'умения — в листе вручную' }}</small></span>
        </button>
      </div>
      <div v-if="chosen" class="pick-detail">
        <h4><GameIcon class="inline-icon" name="subclass" :size="22" /> {{ chosen.label }}</h4>
        <ul v-if="srdChosen && level.plan.subclass.srdFeatures.length" class="traits">
          <li v-for="feature in level.plan.subclass.srdFeatures" :key="feature"><strong>{{ feature }}</strong><template v-if="featureText(feature)">. {{ featureText(feature) }}</template></li>
        </ul>
        <p v-else-if="chosen.value === 'other'">Подкласс не из списка: назовите его в листе и впишите умения, как договоритесь с мастером.</p>
        <p v-else>Умения подкласса «{{ chosen.label }}» {{ level.plan.classLevel }}-го уровня впишите в лист вручную: игра их не считает.</p>
        <p class="muted">Запишется в класс — «{{ level.plan.className }} ({{ chosen.label }})»; поменять потом можно в «Умениях».</p>
      </div>
    </div>
  </template>
</template>

<style scoped src="../../characters/wizard/wizardKit.css"></style>
