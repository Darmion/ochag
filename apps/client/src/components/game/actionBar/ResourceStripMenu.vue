<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import GameIcon from '../GameIcon.vue';
import { cssZoom } from '../../../settings/uiScale';
import { STRIP_SIZES, tableViewPrefs, type StripSize } from '../../../settings/tablePrefs';
// Next to the portrait: the resource strip's size and whether it is shown at all. Kept per user in the table preferences.
// The menu is teleported to the page: the portrait card clips what overflows it.
defineProps<{ empty: boolean }>();
const open = ref(false);
const button = ref<HTMLElement | null>(null);
const popover = ref<HTMLElement | null>(null);
const place = ref({ left: '0px', bottom: '0px' });
const SIZE_LABELS: Record<StripSize, string> = { compact: 'Компактная', normal: 'Обычная', large: 'Крупная' };
function toggle() {
  if (!open.value && button.value) {
    const rect = button.value.getBoundingClientRect();
    const zoom = cssZoom.value || 1;
    place.value = { left: `${Math.max(8, rect.left / zoom - 8)}px`, bottom: `${(window.innerHeight - rect.top) / zoom + 8}px` };
  }
  open.value = !open.value;
}
function onDocument(event: PointerEvent) {
  const target = event.target as Node;
  if (!button.value?.contains(target) && !popover.value?.contains(target)) open.value = false;
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false;
}
watch(open, value => {
  document.removeEventListener('pointerdown', onDocument, true);
  window.removeEventListener('keydown', onKey);
  if (value) {
    document.addEventListener('pointerdown', onDocument, true);
    window.addEventListener('keydown', onKey);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocument, true);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <button
    ref="button" type="button" class="strip-toggle icon-only" :class="{ off: tableViewPrefs.resourceStripCollapsed }" :aria-expanded="open"
    :title="tableViewPrefs.resourceStripCollapsed ? 'Полоса ресурсов свёрнута — показать или изменить размер' : 'Полоса ресурсов: размер и сворачивание'"
    aria-label="Полоса ресурсов" @click="toggle"
  ><GameIcon name="poolGeneric" :size="14" /></button>
  <Teleport to="body">
    <div v-if="open" ref="popover" class="strip-popover g-frame" :style="place" role="dialog" aria-label="Полоса ресурсов">
      <b>Полоса ресурсов</b>
      <label class="size">Размер
        <select v-model="tableViewPrefs.resourceStripSize" :disabled="tableViewPrefs.resourceStripCollapsed">
          <option v-for="size in STRIP_SIZES" :key="size" :value="size">{{ SIZE_LABELS[size] }}</option>
        </select>
      </label>
      <small v-if="empty" class="note">У этого существа нет ячеек и запасов умений — полоса появится у тех, у кого они есть.</small>
      <button type="button" class="collapse" @click="tableViewPrefs.resourceStripCollapsed = !tableViewPrefs.resourceStripCollapsed; open = false">
        {{ tableViewPrefs.resourceStripCollapsed ? 'Показать полосу' : 'Свернуть полосу' }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.strip-toggle{flex:none;display:inline-grid;place-items:center;width:20px;height:20px;min-height:0;padding:0;border-radius:5px;color:var(--g-gold,var(--brass))}
.strip-toggle.off{color:var(--muted-ink);opacity:.8}
.strip-popover{position:fixed;z-index:2400;display:grid;gap:8px;width:250px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:10px 12px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--g-gold-lo,var(--brass));border-radius:8px;box-shadow:var(--g-shadow);font-size:13px}
.size{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:8px;font-size:12px}
.size select{min-width:0;width:100%}
.note{font-size:12px;line-height:1.45;color:var(--muted-ink)}
.collapse{min-height:30px;font-size:12px;white-space:normal}
</style>
