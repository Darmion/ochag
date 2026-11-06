<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import GameIcon from '../game/GameIcon.vue';

export type Handout = { id: string; title: string; body: string | null; assetId: string | null };

const props = defineProps<{
  campaignId: string;
  handout: Handout;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

const imageUrl = ref('');
const failed = ref(false);

async function loadImage() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = '';
  failed.value = false;
  if (!props.handout.assetId) return;
  try {
    const blob = await props.request(`/campaigns/${props.campaignId}/assets/${props.handout.assetId}`) as Blob;
    imageUrl.value = URL.createObjectURL(blob);
  } catch {
    failed.value = true;
  }
}

watch(() => props.handout.id, loadImage);
onMounted(() => {
  void loadImage();
});
onBeforeUnmount(() => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
});
</script>

<template>
  <div class="handout-overlay" role="dialog" aria-modal="true" :aria-label="handout.title" @click.self="emit('close')">
    <article class="handout-card">
      <header>
        <h2 translate="no">{{ handout.title }}</h2>
        <button type="button" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <img v-if="imageUrl" :src="imageUrl" :alt="handout.title" class="handout-image" />
      <p v-else-if="failed" class="muted">Картинку не удалось загрузить.</p>
      <p v-if="handout.body" class="handout-body" translate="no">{{ handout.body }}</p>
      <small class="muted">Материал остаётся в журнале — вкладка «Материалы».</small>
    </article>
  </div>
</template>

<style scoped>
.handout-overlay{position:fixed;inset:0;z-index:4500;display:flex;align-items:center;justify-content:center;padding:24px;background:#0b0704d9}
.handout-card{display:flex;flex-direction:column;gap:12px;max-width:min(980px,96vw);max-height:92vh;overflow:auto;padding:22px 26px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 18px 50px #000c}
.handout-card header{display:flex;align-items:center;justify-content:space-between;gap:16px}
.handout-card h2{margin:0;font:700 26px var(--heading-font)}
.handout-card header button{min-height:32px;width:32px;padding:0}
.handout-image{display:block;max-width:100%;max-height:70vh;object-fit:contain;margin:0 auto;border-radius:3px}
.handout-body{margin:0;white-space:pre-line;font-size:17px;line-height:1.55}
</style>
