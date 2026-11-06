<script setup lang="ts">
import { ref } from 'vue';
import { RUNES, type RuneSymbol } from '../../../../../packages/domain/minigames/rune-lock';
import RuneImage from './RuneImage.vue';
const props = defineProps<{ modelValue: RuneSymbol[]; campaignId: string; disabled?: boolean; request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any> }>();
const emit = defineEmits<{ 'update:modelValue': [RuneSymbol[]]; uploading: [boolean] }>();
const loading = ref(false), error = ref('');
function update(index: number, change: Partial<RuneSymbol>) { emit('update:modelValue', props.modelValue.map((s, i) => i === index ? { ...s, ...change } : s)); }
async function upload(index: number, event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = '';
  if (!file || loading.value || props.disabled) return;
  error.value = '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) { error.value = 'Выберите PNG, JPEG или WebP до 2 МБ.'; return; }
  loading.value = true; emit('uploading', true);
  try { const result = await props.request(`/campaigns/${props.campaignId}/assets?kind=art_sprite`, 'POST', undefined, file); update(index, { assetId: result.id }); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить изображение. Попробуйте ещё раз.'; }
  finally { loading.value = false; emit('uploading', false); }
}
</script>
<template><fieldset :disabled="disabled || loading"><legend>Собственные символы</legend><p>Замените любые из шести картинок и задайте названия. PNG, JPEG, WebP до 2 МБ. Изображения увидит весь отряд после сохранения.</p><p v-if="error" role="alert">{{ error }}</p><div class="symbols"><div v-for="(symbol, i) in modelValue" :key="i" class="symbol"><RuneImage :asset-id="symbol.assetId" :campaign-id="campaignId" :request="request"><span aria-hidden="true">{{ RUNES[i]?.glyph }}</span></RuneImage><input :value="symbol.name" :aria-label="`Название символа ${i + 1}`" maxlength="40" required @input="update(i, { name: ($event.target as HTMLInputElement).value })" /><label>Загрузить картинку<input type="file" accept="image/png,image/jpeg,image/webp" @change="upload(i, $event)" /></label><button type="button" :disabled="!symbol.assetId" @click="update(i, { assetId: null })">Убрать картинку</button></div></div><p v-if="loading" role="status">Загрузка изображения…</p></fieldset></template>
<style scoped>fieldset{min-width:0;border:1px solid var(--brass-light);padding:12px}p{font-size:12px;line-height:1.5}.symbols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.symbol{display:flex;flex-direction:column;align-items:center;gap:8px;padding:10px;background:var(--surface-inset);min-width:0}.symbol>span{font-size:36px}.symbol input{max-width:100%;min-width:0;width:100%}.symbol label,.symbol button{font-size:12px}.symbol input[type=file]{font-size:11px}@media(max-width:440px){.symbols{grid-template-columns:1fr}}</style>
