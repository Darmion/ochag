<script setup lang="ts">
import { MAX_SHEET_CELLS } from '../../art/spriteSheet';
import type { SpriteSheet } from '../../personalization/spriteUpload';

defineProps<{
  sheet: SpriteSheet;
  image: HTMLImageElement;
  sheetGrid: { columns: number; rows: number };
  busy: boolean;
  forAll: boolean;
}>();
defineEmits<{
  cut: [];
  whole: [];
  cancel: [];
}>();
</script>

<template>
  <section class="pz-sheet" aria-label="Лист спрайтов">
    <h4>Лист спрайтов «{{ sheet.name }}» — {{ image.naturalWidth }}×{{ image.naturalHeight }} px</h4>
    <div class="pz-sheet-body">
      <img class="pz-sheet-image" :src="sheet.preview" alt="" />
      <div class="pz-sheet-tools">
        <label>Ширина клетки <input v-model.number="sheet.cellWidth" type="number" min="4" :max="image.naturalWidth" /></label>
        <label>Высота клетки <input v-model.number="sheet.cellHeight" type="number" min="4" :max="image.naturalHeight" /></label>
        <label class="checkbox-label"><input v-model="sheet.skipEmpty" type="checkbox" /> пропускать пустые клетки</label>
        <p class="muted">
          {{ sheetGrid.columns }} × {{ sheetGrid.rows }} клеток<template v-if="sheet.empty"> · пустых пропущено: {{ sheet.empty }}</template> · получится <b>{{ sheet.cells.length }}</b>
          <template v-if="sheet.cut"> (больше {{ MAX_SHEET_CELLS }} — лишние не войдут)</template>
        </p>
      </div>
    </div>
    <div v-if="sheet.thumbs.length" class="pz-sheet-thumbs">
      <img v-for="(thumb, index) in sheet.thumbs" :key="index" :src="thumb" alt="" />
      <span v-if="sheet.cells.length > sheet.thumbs.length" class="muted">и ещё {{ sheet.cells.length - sheet.thumbs.length }}</span>
    </div>
    <div class="pz-actions">
      <button type="button" class="primary" :disabled="busy || !sheet.cells.length" @click="$emit('cut')">
        Нарезать: {{ sheet.cells.length }} {{ forAll ? 'спрайтов кампании' : 'картинок' }}
      </button>
      <button type="button" :disabled="busy" @click="$emit('whole')">Одной картинкой</button>
      <button type="button" :disabled="busy" @click="$emit('cancel')">Отмена</button>
      <span v-if="sheet.progress" class="muted" aria-live="polite">{{ sheet.progress }}</span>
    </div>
  </section>
</template>

<style scoped>
.pz-sheet{border:1px dashed var(--brass-light);border-radius:6px;padding:8px 10px;display:flex;flex-direction:column;gap:8px}
.pz-sheet h4{margin:0;font-size:14px}
.pz-sheet-body{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}
.pz-sheet-image{max-width:min(420px,100%);max-height:140px;object-fit:contain;image-rendering:pixelated;background:repeating-conic-gradient(#0002 0 25%,transparent 0 50%) 0 0/12px 12px;border-radius:4px}
.pz-sheet-tools{display:flex;flex-direction:column;gap:4px;font-size:13px;min-width:200px}
.pz-sheet-tools label{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pz-sheet-tools input[type=number]{width:90px;min-height:30px;padding:2px 6px}
.pz-sheet-tools p{margin:0;font-size:12px}
.pz-sheet-thumbs{display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-height:112px;overflow-y:auto}
.pz-sheet-thumbs img{width:32px;height:32px;image-rendering:pixelated;border-radius:3px;background:#ffffff14}
.pz-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:6px}
.pz-actions button{min-height:32px;padding:3px 10px;font-size:13px}
</style>
