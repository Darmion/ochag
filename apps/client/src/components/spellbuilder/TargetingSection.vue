<script setup lang="ts">
import { AREA_AFFECTS, AREA_ORIGINS, AREA_SHAPES, CREATURE_TYPES, OBJECT_FILTERS, OBJECT_KINDS, SIDES, SIZES, TARGETING_KINDS, type SpellTemplate } from '../../../../../packages/domain/spells/spell-template';
import { toggleIn } from '../../spellBuilder/edits';

defineProps<{ template: SpellTemplate; locked: boolean }>();
</script>

<template>
  <div class="grid">
    <label>Г1 Способ
      <select v-model="template.targeting.kind" data-path="targeting.kind" :disabled="locked"><option v-for="[value, label] in TARGETING_KINDS" :key="value" :value="value">{{ label }}</option></select>
    </label>
  </div>
  <div v-if="template.targeting.kind === 'creatures' || template.targeting.kind === 'chain'" class="grid">
    <label>Г2 Сколько
      <span class="pair">
        <select v-model="template.targeting.countMode" data-path="targeting.countMode" :disabled="locked"><option value="exact">ровно</option><option value="up-to">до</option></select>
        <input v-model.number="template.targeting.count" data-path="targeting.count" type="number" min="1" max="100" :disabled="locked" />
      </span>
    </label>
    <label>Г3 Какие
      <select v-model="template.targeting.side" data-path="targeting.side" :disabled="locked"><option v-for="[value, label] in SIDES" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label>Г6 Не дальше друг от друга, фт.<input v-model.number="template.targeting.maxApartFeet" type="number" min="0" :disabled="locked" placeholder="0 — без предела" /></label>
    <label>Г7 Тип существ
      <select v-model="template.targeting.typeMode" data-path="targeting.typeMode" :disabled="locked"><option value="any">любой</option><option value="only">только</option><option value="except">кроме</option></select>
    </label>
    <label>Размер не больше
      <select v-model="template.targeting.maxSize" :disabled="locked"><option value="">—</option><option v-for="[value, label] in SIZES" :key="value" :value="value">{{ label }}</option></select>
    </label>
  </div>
  <fieldset v-if="(template.targeting.kind === 'creatures' || template.targeting.kind === 'chain') && template.targeting.typeMode !== 'any'" class="chips" data-path="targeting.types"><legend>Типы</legend>
    <label v-for="[value, label] in CREATURE_TYPES" :key="value" class="chip" :class="{ on: template.targeting.types.includes(value) }"><input type="checkbox" :checked="template.targeting.types.includes(value)" :disabled="locked" @change="toggleIn(template.targeting.types, value)" />{{ label }}</label>
  </fieldset>
  <div v-if="template.targeting.kind === 'creatures' || template.targeting.kind === 'chain'" class="flags">
    <label class="checkbox-label"><input v-model="template.targeting.includeSelf" type="checkbox" :disabled="locked" /> Г4 Можно себя</label>
    <label class="checkbox-label"><input v-model="template.targeting.distinct" type="checkbox" :disabled="locked" /> Г5 Разные цели</label>
    <label class="checkbox-label"><input v-model="template.targeting.seesCaster" type="checkbox" :disabled="locked" /> видит заклинателя</label>
    <label class="checkbox-label"><input v-model="template.targeting.hearsCaster" type="checkbox" :disabled="locked" /> слышит</label>
    <label class="checkbox-label"><input v-model="template.targeting.understands" type="checkbox" :disabled="locked" /> понимает язык</label>
  </div>
  <div v-if="template.targeting.kind === 'chain'" class="grid">
    <label>Г14 Перескоков<input v-model.number="template.targeting.hops" type="number" min="1" max="20" :disabled="locked" /></label>
    <label>Г15 Дальность перескока, фт.<input v-model.number="template.targeting.hopFeet" type="number" min="5" :disabled="locked" /></label>
    <label class="checkbox-label"><input v-model="template.targeting.repeats" type="checkbox" :disabled="locked" /> Г16 одна цель дважды</label>
  </div>
  <div v-if="template.targeting.kind === 'area'" class="grid">
    <label>Г8 Форма
      <select v-model="template.targeting.shape" data-path="targeting.shape" :disabled="locked"><option v-for="[value, label] in AREA_SHAPES" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label>Г9 {{ template.targeting.shape === 'line' ? 'Длина' : ['sphere', 'cylinder'].includes(template.targeting.shape) ? 'Радиус' : 'Размер' }}, фт.<input v-model.number="template.targeting.sizeFeet" data-path="targeting.sizeFeet" type="number" min="5" :disabled="locked" /></label>
    <label v-if="template.targeting.shape === 'line'">Ширина, фт.<input v-model.number="template.targeting.widthFeet" data-path="targeting.widthFeet" type="number" min="5" :disabled="locked" /></label>
    <label v-if="template.targeting.shape === 'cylinder'">Высота, фт.<input v-model.number="template.targeting.heightFeet" data-path="targeting.heightFeet" type="number" min="0" :disabled="locked" /></label>
    <label>Г10 Откуда
      <select v-model="template.targeting.origin" data-path="targeting.origin" :disabled="locked"><option v-for="[value, label] in AREA_ORIGINS" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label>Г11 Кого задевает
      <select v-model="template.targeting.affects" data-path="targeting.affects" :disabled="locked"><option v-for="[value, label] in AREA_AFFECTS" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label class="checkbox-label"><input v-model="template.targeting.aroundCorners" type="checkbox" :disabled="locked" /> Г12 огибает углы</label>
  </div>
  <div v-if="template.targeting.kind === 'object'" class="grid">
    <label>Г17 Предмет
      <select v-model="template.targeting.objectKind" :disabled="locked"><option v-for="[value, label] in OBJECT_KINDS" :key="value" :value="value">{{ label }}</option></select>
    </label>
    <label>Чей
      <select v-model="template.targeting.objectOwner" :disabled="locked"><option value="self">свой</option><option value="target">цели</option></select>
    </label>
    <label>Какой
      <select v-model="template.targeting.objectFilter" :disabled="locked"><option v-for="[value, label] in OBJECT_FILTERS" :key="value" :value="value">{{ label }}</option></select>
    </label>
  </div>
  <div v-if="template.targeting.kind === 'wall'" class="grid">
    <label>Г19 Отрезков<input v-model.number="template.targeting.segments" type="number" min="1" :disabled="locked" /></label>
    <label>Длина отрезка, фт.<input v-model.number="template.targeting.segmentFeet" type="number" min="5" :disabled="locked" /></label>
    <label>Высота, фт.<input v-model.number="template.targeting.wallHeight" type="number" min="1" :disabled="locked" /></label>
    <label>Толщина, фт.<input v-model.number="template.targeting.wallThickness" type="number" min="0" :disabled="locked" /></label>
  </div>
</template>

<style scoped src="./builderKit.css"></style>
