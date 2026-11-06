<script setup lang="ts">
import { ref } from 'vue';

import { NO_ART } from '../../art/itemArt';
import { appliesText, type ArtElement } from '../../personalization/catalog';
import type { ArtElements } from '../../personalization/elements';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  elements: ArtElements;
  selected: ArtElement;
  current: string | undefined;
  forAll: boolean;
  busy: boolean;
  notice: string;
}>();
defineEmits<{
  default: [];
  none: [];
  file: [event: Event];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
</script>

<template>
  <div class="pz-current">
    <span class="pz-preview" :class="{ empty: !elements.currentArt(selected), frame: selected.kind === 'rarity' }">
      <img v-if="elements.currentArt(selected)" :src="elements.currentArt(selected)!" alt="" />
      <span v-else aria-hidden="true">?</span>
    </span>
    <div class="pz-current-text">
      <h3>{{ selected.name }}</h3>
      <p class="muted">
        {{ selected.group }}<template v-if="elements.statusLabel(elements.statusOf(selected))"> · {{ elements.statusLabel(elements.statusOf(selected)) }}</template><template v-if="elements.statusOf(selected) === 'missing'"> — выберите</template>
      </p>
      <p class="pz-applies">{{ appliesText(selected, forAll) }}</p>
      <div class="pz-actions">
        <button type="button" :disabled="busy || current === undefined" title="Вернуть исходную картинку" @click="$emit('default')"><GameIcon class="inline-icon" name="undo" :size="16" /> Вернуть исходную</button>
        <span v-if="elements.defaultArt(selected) && current !== undefined" class="pz-was" title="Исходная картинка">
          <img :src="elements.defaultArt(selected)!" alt="" />
        </span>
        <button type="button" :disabled="busy || current === NO_ART" @click="$emit('none')">Без картинки</button>
        <button type="button" :disabled="busy" title="PNG, JPEG, WebP или GIF; лист спрайтов (полоска или сетка) нарежется на клетки" @click="fileInput?.click()">
          <GameIcon class="inline-icon" name="upload" :size="16" /> Свой спрайт…
        </button>
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden @change="$emit('file', $event)" />
      </div>
      <p v-if="notice" class="muted pz-notice" aria-live="polite">{{ notice }}</p>
    </div>
  </div>
</template>

<style scoped>
.pz-current{display:flex;gap:14px;align-items:flex-start}
.pz-preview{width:96px;height:96px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border-radius:8px;border:1px solid var(--brass-light);background:radial-gradient(circle,#ffffff30 0,#ffffff0d 55%,transparent 72%);font-size:36px}
.pz-preview img{width:88%;height:88%;object-fit:contain}
.pz-preview.frame img{width:100%;height:100%}
.pz-preview.empty{border-style:dashed;color:var(--muted-ink)}
.pz-current-text{flex:1;min-width:0}
.pz-current-text h3{margin:0 0 2px}
.pz-current-text p{margin:0 0 4px}
.pz-applies{font-size:12px}
.pz-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px}
.pz-actions button{min-height:32px;padding:3px 10px;font-size:13px}
.pz-was{width:32px;height:32px;display:inline-flex;opacity:.7}
.pz-was img{width:100%;height:100%;object-fit:contain}
.pz-notice{font-size:12px;margin:0}
</style>
