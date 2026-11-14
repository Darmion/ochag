<script setup lang="ts">
import ArtPickerDialog from '../common/ArtPickerDialog.vue';
import ImageCropDialog from '../common/ImageCropDialog.vue';
import type { Appearance } from '../../characterSheet/appearance';
import type { CharacterDTO } from '../../characterSheet/types';

defineProps<{ appearance: Appearance; character: CharacterDTO; readOnly: boolean; isCreature: boolean }>();
</script>

<template>
  <section class="appearance">
    <h3>Внешний вид на столе</h3>
    <img v-if="appearance.imagePreview" :src="appearance.imagePreview" alt="Миниатюра объекта" class="appearance-preview" />
    <p class="muted">
      <template v-if="character.model_asset_id">3D-модель.</template>
      <template v-else-if="character.image_asset_id">Картинка-стойка: всегда повёрнута к камере.</template>
      <template v-else-if="appearance.previewFromLibrary">Портрет из библиотеки по имени — пока нет своей картинки.</template>
      <template v-else>{{ isCreature ? 'Фигурка цвета стороны.' : 'Деревянный ящик.' }}</template>
      Модель важнее картинки, если заданы обе.
    </p>

    <template v-if="!readOnly">
      <label>
        Картинка-миниатюра — PNG, JPEG или WebP, до 5 МБ
        <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="appearance.busy" @change="appearance.onImageChosen" />
      </label>
      <button type="button" :disabled="appearance.busy" @click="appearance.openArtPicker()">
        {{ isCreature ? 'Портрет из библиотеки…' : 'Картинка из библиотеки…' }}
      </button>
      <button v-if="character.image_asset_id && appearance.imagePreview && !appearance.previewFromLibrary" type="button" :disabled="appearance.busy" title="Какая часть картинки видна в портрете: «Отряд», очередь хода, лист. Стойка на столе — целиком" @click="appearance.openPortraitCrop()">
        Кадр портрета…
      </button>
      <button v-if="character.image_asset_id" type="button" :disabled="appearance.busy" @click="appearance.clearImage">
        Убрать картинку
      </button>
      <ImageCropDialog
        v-if="appearance.portraitCrop"
        :src="appearance.portraitCrop.src"
        :crop="character.image_crop"
        shape="portrait"
        :title="`Кадр портрета: ${character.name}`"
        :busy="appearance.busy"
        @save="appearance.savePortraitCrop"
        @close="appearance.closePortraitCrop"
      />
      <div v-if="!isCreature" class="open-look">
        <h4>Открытым</h4>
        <img v-if="appearance.openPreview" :src="appearance.openPreview" alt="Как предмет выглядит открытым" class="appearance-preview" />
        <p class="muted">{{ character.image_open_asset_id ? 'Открытый предмет показывает эту картинку.' : 'Открытый предмет выглядит так же, как закрытый. Для сундука или двери выберите вторую картинку.' }}</p>
        <div class="open-buttons">
          <button type="button" :disabled="appearance.busy" @click="appearance.openArtPickerShown = true">Картинка «открыто» из библиотеки…</button>
          <label class="file-button">
            Загрузить картинку «открыто»
            <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="appearance.busy" @change="appearance.onOpenImageChosen" />
          </label>
          <button v-if="character.image_open_asset_id" type="button" :disabled="appearance.busy" @click="appearance.clearOpenImage">Убрать картинку «открыто»</button>
        </div>
        <ArtPickerDialog
          v-if="appearance.openArtPickerShown"
          title="Картинка «открыто»"
          :sections="[]"
          :suggested="appearance.openArtSuggested"
          :busy="appearance.busy"
          @pick="appearance.onOpenArtPicked"
          @close="appearance.openArtPickerShown = false"
        />
      </div>
      <ArtPickerDialog
        v-if="appearance.artPickerOpen"
        :title="isCreature ? 'Портрет из библиотеки' : 'Картинка из библиотеки'"
        :sections="isCreature ? ['Портреты'] : []"
        :suggested="appearance.artPickerSuggested"
        :busy="appearance.busy"
        @pick="appearance.onLibraryArtPicked"
        @close="appearance.closeArtPicker()"
      />

      <label>
        3D-модель из библиотеки кампании
        <select :value="character.model_asset_id ?? ''" :disabled="appearance.busy" @change="appearance.setModel(($event.target as HTMLSelectElement).value)">
          <option value="">— без модели —</option>
          <option v-for="asset in appearance.modelLibrary" :key="asset.id" :value="asset.id">{{ asset.original_filename || asset.id }}</option>
        </select>
      </label>
      <label>
        Или загрузить новую — GLB, до 25 МБ
        <input type="file" accept=".glb,model/gltf-binary" :disabled="appearance.busy" @change="appearance.onModelChosen" />
      </label>
    </template>
  </section>
</template>

<style scoped src="./sheetKit.css"></style>
<style scoped>
.appearance{margin-top:20px;padding-top:12px;border-top:1px solid var(--brass-light);display:flex;flex-direction:column;gap:8px}
.appearance-preview{max-width:140px;max-height:180px;object-fit:contain;border:1px solid var(--brass-light);background:#0002}
.muted{font-size:13px}
.open-look{display:flex;flex-direction:column;gap:6px;padding-top:8px;border-top:1px dashed var(--brass-light)}
.open-look h4{margin:0;font-size:14px}
.open-buttons{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.file-button{position:relative;display:inline-flex;align-items:center;min-height:32px;padding:4px 12px;border:1px solid var(--brass);border-radius:4px;cursor:pointer;font-size:13px}
.file-button input{position:absolute;inset:0;opacity:0;cursor:pointer}
</style>
