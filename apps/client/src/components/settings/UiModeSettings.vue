<script setup lang="ts">
import { computed, ref } from 'vue';
import { GAME_SKINS, SKIN_SWATCHES, gameSkin } from '../../settings/uiMode';
import ThemePickerDialog from './ThemePickerDialog.vue';
import GameIcon from '../game/GameIcon.vue';

const open = ref(false);
const current = computed(() => GAME_SKINS.find(skin => skin.id === gameSkin.value) ?? GAME_SKINS[0]!);
const swatch = computed(() => {
  const colors = SKIN_SWATCHES[current.value.id];
  return { background: `linear-gradient(135deg, ${colors.bg} 0 45%, ${colors.tint} 45% 70%, ${colors.rim} 70%)` };
});
</script>

<template>
  <div class="ui-mode-settings">
    <h4>Оформление</h4>
    <div class="theme-summary">
      <span class="theme-swatch" :style="swatch" aria-hidden="true" />
      <span class="theme-text"><strong>{{ current.name }}</strong><small>{{ current.description }}</small></span>
      <button type="button" @click="open = true"><GameIcon name="palette" :size="16" /> Выбрать оформление…</button>
    </div>
    <ThemePickerDialog v-if="open" @close="open = false" />
  </div>
</template>

<style scoped>
.ui-mode-settings h4{margin:0 0 8px}
.theme-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.theme-swatch{flex:none;width:36px;height:36px;border-radius:50%;box-shadow:inset 0 0 0 1px #0008,0 0 0 1px var(--g-gold-lo,#80602a)}
.theme-text{flex:1;min-width:160px;display:flex;flex-direction:column;gap:2px}
.theme-text small{font-size:12px;color:var(--muted-ink)}
.theme-summary button{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:4px 14px}
</style>
