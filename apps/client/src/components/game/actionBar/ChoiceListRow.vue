<script setup lang="ts">
import { computed } from 'vue';
import FeatureChoiceList from './FeatureChoiceList.vue';
import { MULTIATTACK, isReady, maneuverToggles, multiattackOf, type ManeuverToggle, type Multiattack } from '../../../actionBar/featureCards';
import type { FeatureView } from '../../../actionBar/types';

const props = defineProps<{ feature: FeatureView; working: boolean }>();
const emit = defineEmits<{ choose: [value: string, on: boolean]; ready: [key: ManeuverToggle['key'], on: boolean]; multiattack: [kind: Multiattack] }>();
const multiattack = computed(() => (props.feature.id === 'hunter-multiattack' ? multiattackOf(props.feature) : null));

function attack() {
  if (multiattack.value) emit('multiattack', multiattack.value);
}
</script>

<template>
  <div class="feature-row">
    <FeatureChoiceList :feature="feature" :working="working" @toggle="(value, on) => emit('choose', value, on)" />
    <template v-if="multiattack">
      <button
        type="button" :disabled="working || !feature.available"
        :title="MULTIATTACK[multiattack].title"
        @click="attack"
      >{{ MULTIATTACK[multiattack].label }}</button>
      <small v-if="feature.reason" class="muted">{{ feature.reason }}</small>
    </template>
    <template v-if="feature.id === 'combat-superiority'">
      <label v-for="toggle in maneuverToggles(feature)" :key="toggle.key" class="checkbox-label" :title="toggle.title">
        <input type="checkbox" :checked="isReady(feature, toggle.key)" :disabled="working" @change="emit('ready', toggle.key, !isReady(feature, toggle.key))" />
        {{ toggle.label }} — наготове
      </label>
    </template>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
