<script setup lang="ts">
import { computed } from 'vue';

export type DifficultyView = {
  party: Array<{ name: string; level: number }>;
  foes?: Array<{ name: string; xp: number }>;
  partySize: number;
  monsters: number;
  experience: number;
  multiplier: number;
  adjusted: number;
  thresholds: { easy: number; medium: number; hard: number; deadly: number };
  rating: 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly';
  label: string;
};

const props = defineProps<{ result: DifficultyView | null; prefix?: string }>();

const number = (value: number) => String(value).replace('.', ',');

const unrated = computed(() => Boolean(props.result && !props.result.monsters && (props.result.foes?.length ?? 0) > 0));

const details = computed(() => {
  const result = props.result;
  if (!result) return '';
  if (!result.partySize) return 'В кампании нет героев — не с кем сравнить.';
  if (unrated.value) return 'У этих врагов не указан уровень опасности (в листе НПС — «Уровень опасности»), опыт за них 0 — сложность не задана.';
  const levels = result.party.map(hero => `${hero.name} ${hero.level}`).join(', ');
  const { easy, medium, hard, deadly } = result.thresholds;
  return `Отряд: ${levels}. Пороги: лёгкая ${easy}, средняя ${medium}, сложная ${hard}, смертельная ${deadly}. `
    + `Опыт врагов ${result.experience} × ${number(result.multiplier)} (врагов: ${result.monsters}) = ${result.adjusted}.`;
});
</script>

<template>
  <span v-if="result" class="difficulty" :class="unrated ? 'trivial' : result.rating" :title="details">
    <span v-if="prefix" class="prefix">{{ prefix }}</span>
    {{ !result.partySize ? 'без отряда' : unrated ? 'не задана' : result.label }}
    <small v-if="result.monsters">· {{ result.experience }} оп.</small>
  </span>
</template>

<style scoped>
.difficulty{display:inline-flex;flex-wrap:wrap;align-items:baseline;column-gap:4px;width:fit-content;max-width:100%;justify-self:start;padding:1px 7px;border-radius:10px;font-size:12px;font-weight:600;line-height:1.35;border:1px solid currentColor;cursor:help}
.difficulty small{font-weight:400;opacity:.85}
.prefix{font-weight:400;margin-right:2px}
.trivial{color:#8f8a80}
.easy{color:#5fae63}
.medium{color:#d2a93c}
.hard{color:#e07b39}
.deadly{color:#e0483d}
</style>
