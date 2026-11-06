<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{
  feature: FeatureView;
  working: boolean;
  cleanseSpells: Array<{ value: string; label: string; level: number; harmful: boolean }>;
  cleanseName: string;
}>();
const emit = defineEmits<{ aim: [] }>();
const cleanseSpell = defineModel<string>('cleanseSpell', { required: true });
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <select v-if="cleanseSpells.length > 1" v-model="cleanseSpell" class="sense-select" :disabled="working" :aria-label="`Какое заклинание снять с «${cleanseName}»`" :title="`Заклинания на «${cleanseName}» — для следующего щелчка по ней`">
      <option value="">{{ `${cleanseSpells[0]!.label} (первым${cleanseSpells[0]!.harmful ? ', вредное' : ''})` }}</option>
      <option v-for="spell in cleanseSpells.slice(1)" :key="spell.value" :value="spell.value">{{ spell.label }}{{ spell.level ? ` (${spell.level} ур.)` : '' }}{{ spell.harmful ? ' — вредное' : '' }}</option>
    </select>
    <button type="button" :disabled="working || !feature.available" title="С кого снять заклинание — щелчком по фигуре на карте (касание; можно себя)" @click="emit('aim')">Очистить…</button>
    <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
