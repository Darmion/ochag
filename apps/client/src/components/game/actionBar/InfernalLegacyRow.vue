<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ add: [index: string] }>();
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <div class="choice-chips">
      <span v-for="spell in feature.legacy ?? []" :key="spell.index" class="choice-chip" :class="{ muted: !spell.open }">
        {{ spell.name }}{{ spell.castAt ? ` (${spell.castAt} ур.)` : '' }}{{ !spell.open ? ` — с ${spell.minLevel}-го` : spell.charge ? ` · ${spell.charge.current}/${spell.charge.max}` : '' }}
        <button v-if="spell.open && !spell.entryId" type="button" class="chip-remove" :disabled="working" :title="`Добавить «${spell.name}» в заклинания`" :aria-label="`Добавить «${spell.name}» в заклинания`" @click="emit('add', spell.index)">+</button>
      </span>
    </div>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
