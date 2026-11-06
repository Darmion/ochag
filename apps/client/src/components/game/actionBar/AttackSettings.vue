<script setup lang="ts">
import type { AttackUsing, AttackUsingView } from '../../../actionBar/attackView';

defineProps<{
  working: boolean;
  hasTarget: boolean;
  using: AttackUsingView | null;
  attacksLeft: string;
  versatile: boolean;
  powerFeat: string;
  strokeReady: boolean;
  lucky: boolean;
  precision: boolean;
}>();
const warnFriendly = defineModel<boolean>('warnFriendly', { required: true });
const attackUsing = defineModel<AttackUsing>('attackUsing', { required: true });
const twoHanded = defineModel<boolean>('twoHanded', { required: true });
const usePower = defineModel<boolean>('usePower', { required: true });
const useStroke = defineModel<boolean>('useStroke', { required: true });
const useLucky = defineModel<boolean>('useLucky', { required: true });
const usePrecision = defineModel<boolean>('usePrecision', { required: true });
</script>

<template>
  <details class="attack-settings"><summary>Приёмы и параметры атаки</summary>
    <label class="checkbox-label friendly-flag" title="Цель — союзник по фракции? Сначала спросить. Только предупреждение: можно ударить и своего">
      <input v-model="warnFriendly" type="checkbox" :disabled="working" /> Подтверждать атаку по союзнику
    </label>
    <small v-if="hasTarget" class="muted">Сервер сверит с КД цели и учтёт её состояния: «попадание», «промах» или «крит» — в журнале.</small>
    <label v-if="using" class="target-select" title="Действие — основная атака в свой ход. Бонусное действие — только второе лёгкое оружие после атаки лёгким или умение (черта, «Боевые искусства»). Реакция — атака при уходе цели (предложение появится само) или подготовленная «Подготовиться».">
      Ресурс атаки
      <select v-model="attackUsing" :disabled="working">
        <option v-for="option in using.options" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option>
      </select>
    </label>
    <small v-if="using?.note" class="muted">
      {{ using.note }}
    </small>
    <small v-if="attacksLeft" class="muted">{{ attacksLeft }}</small>
    <label v-if="versatile" class="checkbox-label">
      <input v-model="twoHanded" type="checkbox" :disabled="working" /> двумя руками (универсальное)
    </label>
    <label v-if="powerFeat" class="checkbox-label" :title="`${powerFeat}: дальнобойным («Меткий стрелок») или тяжёлым рукопашным («Мастер большого оружия»)`">
      <input v-model="usePower" type="checkbox" :disabled="working" /> −5 к попаданию / +10 к урону
    </label>
    <label v-if="strokeReady" class="checkbox-label" title="«Удача» плута: тратится, только если промах — промах становится попаданием (раз до короткого отдыха)">
      <input v-model="useStroke" type="checkbox" :disabled="working" /> «Удача» — если промах, попадание
    </label>
    <label v-if="lucky" class="checkbox-label" title="«Везунчик»: очко удачи тратится, только если промах — ещё к20, попал — берётся он">
      <input v-model="useLucky" type="checkbox" :disabled="working" /> «Везунчик» — если промах, очко удачи
    </label>
    <label v-if="precision" class="checkbox-label" title="Кость превосходства тратится, только если без неё промах, а с ней может быть попадание">
      <input v-model="usePrecision" type="checkbox" :disabled="working" /> «Точная атака» — если промах, кость к броску
    </label>
  </details>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.attack-settings{border:1px solid var(--brass-light);border-radius:4px;padding:0 10px}.attack-settings summary{font-size:13px;padding:9px 0}.attack-settings[open]{display:flex;flex-direction:column;gap:8px;padding-bottom:10px}
</style>
