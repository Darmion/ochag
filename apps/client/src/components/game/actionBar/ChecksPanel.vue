<script setup lang="ts">
import { computed } from 'vue';
import type { SrdSkill } from '../../../rules/srd';
import type { FeatureView, Popover } from '../../../actionBar/types';
import { ABILITIES } from '../../../actionBar/constants';
import { checkView, peerlessNote, type CheckKind, type Sense } from '../../../actionBar/checkView';
import SenseSelect from './SenseSelect.vue';

const props = defineProps<{
  popover: Popover;
  skills: SrdSkill[];
  working: boolean;
  lucky: boolean;
  strokeReady: boolean;
  peerless: FeatureView | null;
}>();
const emit = defineEmits<{ check: [kind: CheckKind, key: string] }>();
const sense = defineModel<Sense>('sense', { required: true });
const checkTab = defineModel<CheckKind>('checkTab', { required: true });
const usePeerless = defineModel<boolean>('usePeerless', { required: true });
const useLuckyCheck = defineModel<boolean>('useLuckyCheck', { required: true });
const useStrokeCheck = defineModel<boolean>('useStrokeCheck', { required: true });
const view = computed(() => checkView(props.popover, checkTab.value));
const isCheck = computed(() => view.value.kind !== 'save');
const showLuck = computed(() => view.value.tabs && (props.lucky || (isCheck.value && (props.strokeReady || Boolean(props.peerless)))));
</script>

<template>
  <div v-if="view.tabs" class="check-tabs" role="tablist" aria-label="Что проверить">
    <button type="button" role="tab" :aria-selected="checkTab === 'skill'" @click="checkTab = 'skill'">Навык</button>
    <button type="button" role="tab" :aria-selected="checkTab === 'save'" @click="checkTab = 'save'">Спасбросок</button>
    <button type="button" role="tab" :aria-selected="checkTab === 'ability'" @click="checkTab = 'ability'">Характеристика</button>
    <SenseSelect v-if="view.sense" v-model="sense" />
  </div>
  <h4 v-else>{{ view.heading }} <SenseSelect v-if="view.sense" v-model="sense" /></h4>
  <div v-if="showLuck" class="check-luck">
    <label v-if="peerless && isCheck" class="checkbox-label" :title="peerless.text">
      <input v-model="usePeerless" type="checkbox" :disabled="working || !peerless.available" /> «Непревзойдённое мастерство» — {{ peerlessNote(peerless) }}
    </label>
    <label v-if="lucky" class="checkbox-label" title="Очко удачи: ещё к20, берётся лучший — на этот бросок">
      <input v-model="useLuckyCheck" type="checkbox" :disabled="working" /> «Везунчик» — ещё к20
    </label>
    <label v-if="strokeReady && isCheck" class="checkbox-label" title="«Удача» плута 20: к20 этой проверки считается 20, раз до короткого отдыха">
      <input v-model="useStrokeCheck" type="checkbox" :disabled="working" /> «Удача» — к20 = 20
    </label>
  </div>
  <div class="popover-grid">
    <template v-if="view.kind === 'skill'">
      <button v-for="skill in skills" :key="skill.index" type="button" :disabled="working" @click="emit('check', 'skill', skill.index)">
        {{ skill.nameRu }} <small class="muted">{{ skill.abilityRu }}</small>
      </button>
    </template>
    <template v-else>
      <button v-for="[key, label] in ABILITIES" :key="key" type="button" :disabled="working" @click="emit('check', view.kind, key)">{{ label }}</button>
    </template>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.check-tabs{display:flex;gap:4px;margin-bottom:4px}
.check-tabs button{flex:1 1 0;justify-content:center !important;min-height:30px}
.check-tabs button[aria-selected="true"]{color:var(--g-gold-hi);box-shadow:inset 0 -2px 0 var(--g-gold-hi)}
.check-luck{display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:4px;font-size:.9em}
</style>
