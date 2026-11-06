<script setup lang="ts">
import { libraryArt } from '../../art/itemArt';
import type { OwnPicture, PictureLibrary } from '../../personalization/pictureLibrary';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  pictures: PictureLibrary;
  busy: boolean;
  current: string | undefined;
}>();
defineEmits<{
  choose: [value: string, label: string];
  delete: [picture: OwnPicture];
}>();
</script>

<template>
  <div class="pz-picture-tools">
    <input v-model="pictures.pictureQuery" type="search" class="pz-search" placeholder="Найти картинку: меч, синее зелье, дуб…" aria-label="Найти картинку" />
    <select v-model="pictures.pictureSection" aria-label="Раздел библиотеки">
      <option value="">Все разделы</option>
      <option v-if="pictures.ownTotal" :value="pictures.ownSection">{{ pictures.ownLabel }} ({{ pictures.ownTotal }})</option>
      <option v-for="section in pictures.sections" :key="section" :value="section">{{ section }}</option>
      <option v-if="pictures.pictureSection && !pictures.sections.includes(pictures.pictureSection) && pictures.pictureSection !== 'mine' && pictures.pictureSection !== 'campaign'" :value="pictures.pictureSection">
        {{ pictures.sectionLabel(pictures.pictureSection) }}
      </option>
    </select>
    <small class="muted">{{ pictures.pictureCount }} картинок</small>
  </div>
  <p v-if="pictures.searchedEverywhere" class="muted pz-notice">
    В разделе «{{ pictures.sectionLabel(pictures.pictureSection) }}» по запросу ничего — показаны все разделы.
  </p>

  <div class="pz-library">
    <section v-if="pictures.showOwn" class="pz-pictures">
      <h4>{{ pictures.ownLabel }}</h4>
      <div class="pz-grid">
        <div v-for="picture in pictures.ownPictures" :key="picture.id" class="pz-tile-wrap">
          <button type="button" class="pz-tile" :aria-pressed="current === picture.value" :title="picture.label" :disabled="busy" @click="$emit('choose', picture.value, picture.label)">
            <img :src="picture.url" alt="" />
            <span>{{ picture.label }}</span>
          </button>
          <button type="button" class="pz-tile-delete" title="Удалить" :disabled="busy" @click="$emit('delete', picture)"><GameIcon class="inline-icon" name="close" :size="16" /></button>
        </div>
      </div>
    </section>
    <section v-for="group in pictures.pictureGroups" :key="group.id" class="pz-pictures">
      <h4>{{ group.label }}</h4>
      <div class="pz-grid">
        <button
          v-for="item in group.items" :key="item.path" type="button" class="pz-tile" :aria-pressed="current === item.path" :title="item.label"
          :disabled="busy" @click="$emit('choose', item.path, item.label)"
        >
          <img :src="libraryArt(item.path)" alt="" loading="lazy" />
          <span>{{ item.label }}</span>
        </button>
      </div>
    </section>
    <p v-if="!pictures.pictureCount" class="muted">
      Картинок не нашлось.
      <button v-if="pictures.pictureSection" type="button" class="link-button" @click="pictures.pictureSection = ''">Искать во всех разделах</button>
    </p>
  </div>
</template>

<style scoped>
.pz-notice{font-size:12px;margin:0}
.pz-picture-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pz-picture-tools .pz-search{flex:1 1 220px;width:auto}
.pz-picture-tools select{width:auto;min-width:160px}
.pz-library{overflow-y:auto;flex:1;min-height:200px;display:flex;flex-direction:column;gap:12px;padding-right:4px}
.pz-pictures h4{margin:0 0 6px;font-size:14px}
.pz-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(86px,1fr));gap:6px}
.pz-tile-wrap{position:relative}
.pz-tile{width:100%;display:flex;flex-direction:column;align-items:center;gap:2px;min-height:96px;padding:6px 4px;justify-content:flex-start;font:400 11px "Segoe UI",Arial,sans-serif;letter-spacing:0;line-height:1.2}
.pz-tile img{width:52px;height:52px;object-fit:contain;flex-shrink:0}
.pz-tile span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;text-align:center;overflow-wrap:anywhere}
.pz-tile[aria-pressed="true"]{outline:2px solid var(--gold-light,#e9c46a);outline-offset:-2px}
.pz-tile-delete{position:absolute;top:2px;right:2px;min-height:20px;width:20px;padding:0;font-size:11px;line-height:1;border-radius:50%}
@media (max-width:900px){
  .pz-library{max-height:70vh}
}
</style>
