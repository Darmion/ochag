<script setup lang="ts">
import GameIcon from '../GameIcon.vue';
import ImageCropDialog from '../../common/ImageCropDialog.vue';
import type { ImageCrop } from '../../../art/imageCrop';
import type { CampaignImages, LobbyCampaign } from '../../../lobby/campaignCards';

defineProps<{
  selected: LobbyCampaign;
  imageUrls: CampaignImages;
  appearanceBusy: 'avatar' | 'banner' | 'remove-avatar' | 'remove-banner' | null;
  appearanceError: string;
  cropping: { target: 'avatar' | 'banner'; src: string; revoke: boolean } | null;
}>();
const emit = defineEmits<{
  upload: [target: 'avatar' | 'banner', input: HTMLInputElement];
  'open-crop': [target: 'avatar' | 'banner'];
  'save-crop': [crop: ImageCrop | null];
  'close-crop': [];
  remove: [target: 'avatar' | 'banner'];
}>();
</script>

<template>
  <details class="appearance-editor">
    <summary><GameIcon name="palette" :size="18" /> Облик кампании</summary>
    <div class="appearance-body">
      <p>Аватар виден в библиотеке, баннер — в верхней части этой страницы. PNG, JPEG или WebP.</p>
      <div class="appearance-actions">
        <label class="upload-choice" :class="{ disabled: appearanceBusy !== null }">
          <GameIcon name="upload" :size="17" />
          <span>{{ appearanceBusy === 'avatar' ? 'Загрузка…' : 'Выбрать аватар' }}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="appearanceBusy !== null" @change="emit('upload', 'avatar', $event.target as HTMLInputElement)" />
        </label>
        <button v-if="selected.avatar_asset_id && imageUrls[selected.id]?.avatar" type="button" :disabled="appearanceBusy !== null" title="Как аватар ляжет в кружок: сдвинуть и приблизить" @click="emit('open-crop', 'avatar')">
          <GameIcon name="crosshair" :size="16" /> Кадр аватара…
        </button>
        <button v-if="selected.avatar_asset_id" type="button" :disabled="appearanceBusy !== null" @click="emit('remove', 'avatar')">
          <GameIcon name="trash" :size="16" /> Убрать аватар
        </button>
        <label class="upload-choice" :class="{ disabled: appearanceBusy !== null }">
          <GameIcon name="upload" :size="17" />
          <span>{{ appearanceBusy === 'banner' ? 'Загрузка…' : 'Выбрать баннер' }}</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="appearanceBusy !== null" @change="emit('upload', 'banner', $event.target as HTMLInputElement)" />
        </label>
        <button v-if="selected.banner_asset_id && imageUrls[selected.id]?.banner" type="button" :disabled="appearanceBusy !== null" title="Какая часть картинки видна в полосе баннера" @click="emit('open-crop', 'banner')">
          <GameIcon name="crosshair" :size="16" /> Кадр баннера…
        </button>
        <button v-if="selected.banner_asset_id" type="button" :disabled="appearanceBusy !== null" @click="emit('remove', 'banner')">
          <GameIcon name="trash" :size="16" /> Убрать баннер
        </button>
      </div>
      <ImageCropDialog
        v-if="cropping"
        :src="cropping.src"
        :crop="cropping.target === 'avatar' ? selected.avatar_crop : selected.banner_crop"
        :shape="cropping.target"
        :title="cropping.target === 'avatar' ? 'Кадр аватара' : 'Кадр баннера'"
        :busy="appearanceBusy !== null"
        @save="crop => emit('save-crop', crop)"
        @close="emit('close-crop')"
      />
      <p v-if="appearanceError" class="appearance-error" role="alert">{{ appearanceError }}</p>
    </div>
  </details>
</template>

<style scoped src="./lobbyKit.css"></style>
