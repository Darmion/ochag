<script setup lang="ts">
import type { SpellTemplate } from '../../../../../packages/domain/spells/spell-template';
import { SCHOOL_OPTIONS } from '../../spellBuilder/constants';
import GameIcon from '../game/GameIcon.vue';

defineProps<{
  passport: SpellTemplate['passport'];
  locked: boolean;
  busy: boolean;
  srdMode: boolean;
  highlighted: Array<{ text: string; mark: boolean }>;
  hasPending: boolean;
}>();
const emit = defineEmits<{ suggest: []; showRules: []; toTable: [] }>();
</script>

<template>
  <section class="step-describe">
    <div class="row">
      <label class="grow">Название
        <input v-model="passport.name" maxlength="200" :disabled="locked" placeholder="Например: Ледяная цепь" translate="no" />
      </label>
      <label>Круг заклинания
        <select v-model.number="passport.level" :disabled="locked">
          <option :value="0">заговор</option>
          <option v-for="level in [1, 2, 3, 4, 5, 6, 7, 8, 9]" :key="level" :value="level">{{ level }}</option>
        </select>
      </label>
      <label>Школа
        <select v-model="passport.school" :disabled="locked">
          <option v-for="[value, label] in SCHOOL_OPTIONS" :key="value" :value="value">{{ label }}</option>
        </select>
      </label>
    </div>
    <label>Описание <small class="muted">— необязательно; по нему можно подсказать таблицу</small>
      <textarea v-model="passport.description" class="description-input" rows="5" :disabled="locked" translate="no" placeholder="Например: «Совершите дальнобойную атаку заклинанием… При попадании цель получает 2к8 урона холодом…»" />
    </label>
    <label>На больших кругах
      <textarea v-model="passport.higherLevel" rows="2" :disabled="locked" translate="no" />
    </label>
    <div class="actions-row">
      <template v-if="!srdMode">
        <button type="button" class="primary" :disabled="locked || !passport.description.trim()" @click="emit('suggest')">Разобрать описание</button>
        <button type="button" class="small quiet how" :disabled="locked" title="По каким правилам разбор подсказывает таблицу" @click="emit('showRules')"><GameIcon class="inline-icon" name="question" :size="16" /> Как это работает</button>
      </template>
      <span class="spacer" />
      <button type="button" :disabled="busy" @click="emit('toTable')">К таблице →</button>
    </div>
    <div v-if="hasPending" class="highlight" aria-label="Откуда подсказки">
      <small class="muted">Подсказки взяты из выделенных фраз:</small>
      <p translate="no"><template v-for="(part, index) in highlighted" :key="index"><mark v-if="part.mark">{{ part.text }}</mark><template v-else>{{ part.text }}</template></template></p>
    </div>
  </section>
</template>

<style scoped src="./builderKit.css"></style>
<style scoped>
.step-describe{display:flex;flex-direction:column;gap:14px}
.how{color:var(--g-gold,var(--brass))}
.highlight mark{background:color-mix(in srgb,var(--g-warn,#e1a33a) 45%,transparent);color:inherit;border-radius:3px;padding:0 2px}
.highlight p{white-space:pre-wrap}
:root[data-ui="game"] .description-input{min-height:150px;resize:vertical}
:root[data-ui="game"] .step-describe{position:relative;padding:14px 18px 18px;border:1px solid var(--g-line);border-left:3px solid var(--g-gold-lo);border-radius:3px 8px 8px 3px;background:var(--g-stone-2)}
:root[data-ui="game"] .step-describe::after{content:"";position:absolute;top:4px;right:4px;width:32px;height:32px;background:var(--g-gold);-webkit-mask:var(--g-corner-tr) center/contain no-repeat;mask:var(--g-corner-tr) center/contain no-repeat;opacity:.6;pointer-events:none}
:root[data-ui="game"] .step-describe textarea{box-sizing:border-box;padding:12px 14px;font-family:var(--g-body-font);font-size:15px;line-height:1.65;box-shadow:inset 0 2px 8px #0008}
:root[data-ui="game"] .step-describe .actions-row{padding-top:6px}
</style>
