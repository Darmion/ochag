<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';

defineProps<{ hasArt: boolean; busy: boolean }>();
const emit = defineEmits<{ upload: [event: Event]; library: []; clear: [] }>();
const first = ref<HTMLElement | null>(null);
onMounted(async () => {
  await nextTick();
  first.value?.focus();
});
</script>

<template>
  <div class="popover art-menu" aria-label="Картинка заклинания">
    <label ref="first" class="menu-item file-item" tabindex="0" @keydown.enter.prevent="($event.currentTarget as HTMLElement).querySelector('input')?.click()">Загрузить картинку…
      <input type="file" accept="image/png,image/jpeg,image/webp" tabindex="-1" :disabled="busy" @change="emit('upload', $event)" />
    </label>
    <button type="button" class="menu-item" :disabled="busy" @click="emit('library')">Из библиотеки…</button>
    <button v-if="hasArt" type="button" class="menu-item danger" :disabled="busy" @click="emit('clear')">Убрать картинку</button>
    <small class="muted">PNG, JPEG или WebP до 5 МБ. Без своей картинки — значок школы.</small>
  </div>
</template>

<style scoped>
.popover{position:absolute;z-index:6;top:calc(100% + 6px);left:0;display:flex;flex-direction:column;gap:6px;padding:10px;min-width:240px;border:1px solid var(--g-gold-lo,var(--brass));border-radius:8px;background:var(--g-stone-2,var(--parchment-background));box-shadow:0 10px 28px #000b}
.menu-item{text-align:left;justify-content:flex-start;width:100%}
.menu-item.danger:hover{color:var(--g-bad,#c0392b)}
.file-item{position:relative;cursor:pointer;display:inline-flex;align-items:center;padding:6px 12px;border:1px solid var(--g-line,var(--brass-light));border-radius:6px;margin:0}
.file-item input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.file-item:focus-visible,.file-item:focus-within{outline:2px solid var(--g-gold-hi,var(--brass));outline-offset:2px}
:root[data-ui="game"] .art-menu{box-sizing:border-box;width:280px;max-width:calc(100vw - 64px);padding:12px;border-color:var(--g-gold-lo);background:var(--g-stone-2);box-shadow:var(--g-ring-thin),var(--g-shadow)}
:root[data-ui="game"] .art-menu .menu-item{min-height:40px;border-left:2px solid var(--g-gold-lo);background:var(--g-well);color:var(--g-text);white-space:normal}
:root[data-ui="game"] .art-menu>small{padding:6px 2px 0;line-height:1.5}
:root[data-ui="game"] .art-menu :is(button,label):focus-visible{outline:2px solid var(--g-gold-hi);outline-offset:3px}
</style>
