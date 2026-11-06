<script setup lang="ts">
import FeatureHead from './FeatureHead.vue';
import FeatureChips from './FeatureChips.vue';
import { hasChoice, isReady } from '../../../actionBar/featureCards';
import type { FeatureView } from '../../../actionBar/types';

defineProps<{ feature: FeatureView; working: boolean; canSpeak: boolean }>();
const emit = defineEmits<{ choose: [value: string, on: boolean]; ready: [key: 'lucky', on: boolean]; speech: [] }>();
</script>

<template>
  <div class="feature-row">
    <FeatureHead :feature="feature" />
    <FeatureChips :feature="feature" :working="working" @toggle="(value, on) => emit('choose', value, on)" />
    <label v-if="feature.id === 'feats' && hasChoice(feature, 'lucky')" class="checkbox-label" title="Атака по вам попала — очко удачи, ещё к20, берётся меньший">
      <input type="checkbox" :checked="isReady(feature, 'lucky')" :disabled="working" @change="emit('ready', 'lucky', !isReady(feature, 'lucky'))" />
      «Везунчик» против атак — наготове
    </label>
    <button
      v-if="feature.id === 'feats' && hasChoice(feature, 'inspiring-leader')" type="button" :disabled="working || !canSpeak"
      title="Вне боя: до 6 своих в 30 футах и вы — временные хиты уровень + Харизма; раз до короткого отдыха" @click="emit('speech')"
    >Воодушевляющая речь</button>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
