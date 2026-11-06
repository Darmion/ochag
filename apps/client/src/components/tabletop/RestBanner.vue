<script setup lang="ts">
import GameIcon from '../game/GameIcon.vue';
defineProps<{ banner: { text: string; interrupted: boolean }; canManage: boolean; busy: boolean }>();
const emit = defineEmits<{ finish: []; cancel: [] }>();
</script>

<template>
  <div class="rest-banner g-frame" :class="{ interrupted: banner.interrupted }" role="status">
    <span><GameIcon class="inline-icon" name="campfire" :size="16" /> {{ banner.text }}</span>
    <template v-if="canManage">
      <button type="button" class="primary" :disabled="busy" :title="banner.interrupted ? 'Снять сорванный привал' : 'Часы — на остаток привала, отряду — польза отдыха'" @click="emit('finish')">{{ banner.interrupted ? 'Снять' : 'Завершить' }}</button>
      <button v-if="!banner.interrupted" type="button" :disabled="busy" title="Час напряжённого без боя — привал сорван, пользы нет" @click="emit('cancel')">Прервать</button>
    </template>
  </div>
</template>

<style scoped>
.rest-banner{position:fixed;left:50%;top:calc(var(--game-top,54px) + 76px);translate:-50% 0;z-index:2200;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 14px 6px 20px;max-width:min(680px,92vw);background:#1d140cf2;color:#f1e4c5;border:1px solid #6f8fd8;border-radius:6px;box-shadow:0 6px 18px #000a;font-size:13px}
.rest-banner.interrupted{border-color:#b5575d}
.rest-banner span{flex:1 1 240px;font-weight:600}
.rest-banner button{min-height:28px;padding:2px 10px;font-size:13px}
</style>
