<script setup lang="ts">
import { CLASSES, DAMAGE_TYPES, TAGS, type SpellTemplate } from '../../../../../packages/domain/spells/spell-template';
import { isOwnSpellArt } from '../../art/spellArt';
import { SCHOOL_OPTIONS } from '../../spellBuilder/constants';
import { toggleIn } from '../../spellBuilder/edits';
import SpellArtMenu from './SpellArtMenu.vue';

defineProps<{
  passport: SpellTemplate['passport'];
  locked: boolean;
  busy: boolean;
  artUrl: string | null;
  hasArt: boolean;
  artMenuOpen: boolean;
  registerArtEl: (el: HTMLElement | null) => void;
}>();
const emit = defineEmits<{ toggleArt: []; upload: [event: Event]; library: []; clear: [] }>();
</script>

<template>
  <div class="passport-row">
    <div class="passport-art">
      <button :ref="el => registerArtEl(el as HTMLElement | null)" type="button" class="art-preview" :class="{ empty: !hasArt, library: hasArt && !isOwnSpellArt(passport.art) }" :disabled="locked" :aria-expanded="artMenuOpen" title="А9 Картинка" @click="emit('toggleArt')"><img v-if="artUrl" :src="artUrl" alt="" /></button>
      <button type="button" class="small" :disabled="locked" :aria-expanded="artMenuOpen" @click="emit('toggleArt')">Картинка…</button>
      <small v-if="!hasArt" class="muted">своей нет — значок школы</small>
      <SpellArtMenu v-if="artMenuOpen" :has-art="hasArt" :busy="busy" @upload="event => emit('upload', event)" @library="emit('library')" @clear="emit('clear')" />
    </div>
    <div class="grid">
      <label>А1 Название<input v-model="passport.name" data-path="passport.name" maxlength="200" :disabled="locked" translate="no" /></label>
      <label>А2 По-английски<input v-model="passport.nameEn" maxlength="200" :disabled="locked" translate="no" placeholder="необязательно" /></label>
      <label>А3 Круг
        <select v-model.number="passport.level" data-path="passport.level" :disabled="locked"><option :value="0">заговор</option><option v-for="level in [1, 2, 3, 4, 5, 6, 7, 8, 9]" :key="level" :value="level">{{ level }}</option></select>
      </label>
      <label>А4 Школа
        <select v-model="passport.school" data-path="passport.school" :disabled="locked"><option v-for="[value, label] in SCHOOL_OPTIONS" :key="value" :value="value">{{ label }}</option></select>
      </label>
      <label>А9 Стихия
        <select v-model="passport.element" data-path="passport.element" :disabled="locked"><option value="">—</option><option v-for="[value, label] in DAMAGE_TYPES" :key="value" :value="value">{{ label }}</option></select>
      </label>
    </div>
  </div>
  <fieldset class="chips"><legend>А5 Классы</legend>
    <label v-for="[value, label] in CLASSES" :key="value" class="chip" :class="{ on: passport.classes.includes(value) }"><input type="checkbox" :checked="passport.classes.includes(value)" :disabled="locked" @change="toggleIn(passport.classes, value)" />{{ label }}</label>
  </fieldset>
  <fieldset class="chips"><legend>А8 Метки</legend>
    <label v-for="[value, label] in TAGS" :key="value" class="chip" :class="{ on: passport.tags.includes(value) }"><input type="checkbox" :checked="passport.tags.includes(value)" :disabled="locked" @change="toggleIn(passport.tags, value)" />{{ label }}</label>
  </fieldset>
</template>

<style scoped src="./builderKit.css"></style>
<style scoped>
.popover{position:absolute;z-index:6;display:flex;flex-direction:column;gap:6px;padding:10px;min-width:240px;border:1px solid var(--g-gold-lo,var(--brass));border-radius:8px;background:var(--g-stone-2,var(--parchment-background));box-shadow:0 10px 28px #000b}
.passport-row{display:grid;grid-template-columns:88px minmax(0,1fr);gap:16px;align-items:start}
.passport-art{position:relative;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.passport-art>small{font-size:12px;line-height:1.3}
@media (max-width:640px){.passport-row{grid-template-columns:1fr}}
</style>
