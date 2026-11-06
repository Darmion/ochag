<script setup lang="ts">
import { AUTO_PACES, AUTO_TARGETS, autoPace, type AutoTarget } from '../../../tabletop/autoTarget';

defineProps<{ autoTarget?: AutoTarget; busy: boolean }>();
const emit = defineEmits<{ pick: [mode: AutoTarget] }>();
</script>

<template>
  <h4>Авто-ход: кого бить</h4>
  <button
    v-for="mode in AUTO_TARGETS" :key="mode.id" type="button" role="menuitemradio" :aria-checked="(autoTarget ?? 'nearest') === mode.id"
    :class="{ active: (autoTarget ?? 'nearest') === mode.id }" :disabled="busy" @click="emit('pick', mode.id)"
  >{{ mode.label }} <small class="muted">{{ mode.hint }}</small></button>
  <small class="muted">Область ставит сам — где больше врагов и нет своих; раненого союзника лечит.</small>
  <h4>Темп</h4>
  <div class="pace-row" role="radiogroup" aria-label="Темп авто-хода">
    <button
      v-for="pace in AUTO_PACES" :key="pace.id" type="button" role="radio" :aria-checked="autoPace === pace.id"
      :class="{ active: autoPace === pace.id }" :title="pace.hint" @click="autoPace = pace.id"
    >{{ pace.label }}</button>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.pace-row{display:flex;gap:4px}
.pace-row button{flex:1;justify-content:center;text-align:center}
</style>
