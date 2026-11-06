<script setup lang="ts">
import type { Sense } from '../../../actionBar/checkView';

const sense = defineModel<Sense>({ required: true });
</script>

<template>
  <select v-model="sense" class="sense-select" aria-label="Чем проверка" title="Зрением — ослеплённый и в кромешной тьме проваливает сам; слухом — оглохший">
    <option value="">чем — любое</option>
    <option value="sight">зрением</option>
    <option value="hearing">слухом</option>
  </select>
</template>

<style scoped src="./actionPopover.css"></style>
