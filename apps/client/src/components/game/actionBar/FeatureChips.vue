<script setup lang="ts">
import { computed } from 'vue';
import { featureChips, type CardFeature } from '../../../actionBar/featureCards';

const props = defineProps<{ feature: CardFeature; working: boolean }>();
const emit = defineEmits<{ toggle: [value: string, on: boolean] }>();
const card = computed(() => featureChips(props.feature));

function add(event: Event) {
  const select = event.target as HTMLSelectElement;
  const value = select.value;
  select.value = '';
  if (value) emit('toggle', value, true);
}
</script>

<template>
  <div class="choice-chips">
    <span v-for="chip in card.chips" :key="chip.value" class="choice-chip" :class="{ muted: chip.spent }">
      <span :title="chip.hint">{{ chip.label }}</span>
      <button type="button" class="chip-remove" :disabled="working" :aria-label="`Убрать «${chip.name}»`" :title="`Убрать «${chip.name}»`" @click="emit('toggle', chip.value, false)">×</button>
    </span>
    <select v-if="card.add" class="sense-select chip-add" :disabled="working" :aria-label="card.add.ariaLabel" @change="add">
      <option value="">{{ card.add.placeholder }}</option>
      <option v-for="option in card.add.options" :key="option.value" :value="option.value">{{ option.label }}</option>
    </select>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
