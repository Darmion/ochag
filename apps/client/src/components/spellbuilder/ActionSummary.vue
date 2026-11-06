<script setup lang="ts">
import { computed } from 'vue';
import { localized } from './localize';
import { actionParts, type Action } from '../../../../../packages/domain/spells/spell-template';

const props = defineProps<{ action: Action; head?: boolean }>();
const parts = computed(() => actionParts(props.action));
const end = (effects: string[]) => (effects[effects.length - 1]?.endsWith('.') ? '' : '.');
</script>

<template>
  <span class="action-summary">
    <template v-if="head">
      <strong translate="no">«{{ action.name }}»</strong>{{ ' ' }}<span class="muted">{{ parts.when }}</span>
      <template v-if="parts.times">, <span class="muted">{{ parts.times }}</span></template>; <span class="muted">{{ parts.who }}</span>:{{ ' ' }}
    </template>
    <span v-if="parts.check">{{ parts.check }}.</span>
    <template v-for="outcome in parts.outcomes" :key="outcome.outcome">
      {{ ' ' }}<b v-if="outcome.label" class="outcome">{{ outcome.label }}:</b>{{ ' ' }}<template v-for="(effect, index) in outcome.effects" :key="index"><template v-if="index">, </template><span>{{ localized(effect) }}</span></template>{{ end(outcome.effects) }}
    </template>
    <template v-if="parts.half">{{ ' ' }}<b class="outcome">успех:</b>{{ ' ' }}<span>половина урона</span>.</template>
    <span v-if="!parts.check && !parts.outcomes.length && !parts.half" class="muted">ничего</span>
  </span>
</template>

<style scoped>
.outcome{font-weight:700}
:root[data-ui="game"] .action-summary{line-height:1.6}
:root[data-ui="game"] .action-summary .outcome{color:var(--g-gold-hi)}
</style>
