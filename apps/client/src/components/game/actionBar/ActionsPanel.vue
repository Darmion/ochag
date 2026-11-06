<script setup lang="ts">
import { computed } from 'vue';
import GameIcon from '../GameIcon.vue';
import type { ActionBarProps, ActionUsing, AttackTarget, CombatCommand, StandardAction, StealthKind } from '../../../actionBar/types';

const props = defineProps<{
  working: boolean;
  economy: ActionBarProps['economy'];
  hasteAction: boolean;
  canAttackAction: boolean;
  targetId: string;
  targetName: string;
  targets: AttackTarget[];
  actorHidden: boolean;
  actorGrappled: boolean;
  hasCunningAction: boolean;
  expeditious: boolean;
  vanish: boolean;
  shieldMaster: boolean;
}>();
const emit = defineEmits<{
  standard: [action: StandardAction, using: ActionUsing];
  stealth: [kind: StealthKind, using?: ActionUsing];
  combat: [action: CombatCommand, extra?: Record<string, unknown>];
}>();
const readyTrigger = defineModel<string>('readyTrigger', { required: true });
const helpAlly = defineModel<string>('helpAlly', { required: true });
const helpFoe = defineModel<string>('helpFoe', { required: true });
const allies = computed(() => props.targets.filter(item => item.side !== 'hostile'));
const foes = computed(() => props.targets.filter(item => item.side === 'hostile'));

function ready() {
  const trigger = readyTrigger.value.trim();
  emit('combat', 'ready', trigger ? { trigger } : {});
}
function help() {
  const foe = props.economy && helpFoe.value ? { foeId: helpFoe.value } : {};
  emit('combat', 'help', { targetId: helpAlly.value, ...foe });
}
</script>

<template>
  <template v-if="economy">
    <h4>Действия</h4>
    <button type="button" :disabled="working || !(economy.action || hasteAction)" title="Ещё столько же движения в этот ход" @click="emit('standard', 'dash', 'action')"><GameIcon name="run" :size="20" /><span>Рывок</span></button>
    <button type="button" :disabled="working || !(economy.action || hasteAction)" title="В этот ход уход из досягаемости врагов не провоцирует атак" @click="emit('standard', 'disengage', 'action')"><GameIcon name="door" :size="20" /><span>Отход</span></button>
    <button type="button" :disabled="working || !economy.action" title="До начала своего хода: атаки по вам с помехой, спасброски ЛОВ с преимуществом" @click="emit('standard', 'dodge', 'action')"><GameIcon name="shield" :size="20" /><span>Уклонение</span></button>
    <button type="button" :disabled="working || !(economy.action || hasteAction)" title="Ловкость (Скрытность): не видят те, кто не заметит. Не спрятаться на свету на виду у врага" @click="emit('stealth', 'hide', 'action')"><GameIcon name="eye" :size="20" /><span>Спрятаться</span></button>
    <button type="button" :disabled="working || !economy.action" title="Мудрость (Восприятие): найти спрятавшихся, ловушки и тайное в 30 футах" @click="emit('stealth', 'search', 'action')"><GameIcon name="search" :size="20" /><span>Искать</span></button>
    <h4>Подготовиться <small class="muted">действием — атака реакцией до начала вашего хода</small></h4>
    <div class="feature-row">
      <input v-model="readyTrigger" class="sense-select" maxlength="120" :disabled="working" placeholder="на что, например «враг выйдет из-за угла»" aria-label="На что подготовиться" />
      <button type="button" :disabled="working || !economy.action" title="Когда это случится — атака реакцией: «Атака» → «Чем: реакцией»" @click="ready">Подготовить атаку</button>
    </div>
    <h4>Захват и толчок <small class="muted">вместо атаки, состязание Атлетики</small></h4>
    <button type="button" :disabled="working || !targetId || !canAttackAction" :title="targetId ? 'Цель в 5 футах, не больше чем на размер крупнее; удался — «схвачен»' : 'Выберите цель'" @click="emit('combat', 'grapple', { targetId })"><GameIcon name="target" :size="20" />Схватить{{ targetName ? ` «${targetName}»` : '' }}</button>
    <button type="button" :disabled="working || !targetId || !canAttackAction" @click="emit('combat', 'shove-prone', { targetId })"><GameIcon name="sword" :size="20" /><span>Толкнуть: сбить с ног</span></button>
    <button type="button" :disabled="working || !targetId || !canAttackAction" @click="emit('combat', 'shove-push', { targetId })"><GameIcon name="dash" :size="20" /><span>Толкнуть: на 5 футов</span></button>
    <button v-if="actorGrappled" type="button" :disabled="working || !economy.action" title="Атлетика или Акробатика против Атлетики схватившего" @click="emit('combat', 'escape')"><GameIcon name="shield" :size="20" /><span>Вырваться из захвата</span></button>
    <h4>Помощь <small class="muted">действием, до начала вашего хода</small></h4>
    <div class="feature-row">
      <select v-model="helpAlly" class="sense-select" :disabled="working" aria-label="Кому помочь">
        <option value="">— кому —</option>
        <option v-for="target in allies" :key="target.characterId" :value="target.characterId">{{ target.name }}</option>
      </select>
      <select v-model="helpFoe" class="sense-select" :disabled="working" aria-label="В чём помочь">
        <option value="">в проверке</option>
        <option v-for="target in foes" :key="target.characterId" :value="target.characterId">в атаке по «{{ target.name }}»</option>
      </select>
      <button type="button" :disabled="working || !helpAlly || !economy.action" @click="help">Помочь</button>
    </div>
    <h4>{{ hasCunningAction ? 'Хитрое действие (бонусным)' : 'Бонусным действием' }}</h4>
    <small v-if="expeditious" class="muted">«Поспешное отступление»: Рывок — бонусным действием каждый ход.</small>
    <small v-else-if="!hasCunningAction" class="muted">{{ vanish ? '«Исчезновение»: «Спрятаться» — бонусным.' : 'Если умение позволяет: Хитрое действие плута, Шаг ветра монаха, Исчезновение следопыта, «Поспешное отступление».' }}</small>
    <button type="button" :disabled="working || !economy.bonus" @click="emit('standard', 'dash', 'bonus')"><GameIcon name="run" :size="20" /><span>Рывок</span></button>
    <button type="button" :disabled="working || !economy.bonus" @click="emit('standard', 'disengage', 'bonus')"><GameIcon name="door" :size="20" /><span>Отход</span></button>
    <button type="button" :disabled="working || !economy.bonus" @click="emit('stealth', 'hide', 'bonus')"><GameIcon name="eye" :size="20" /><span>Спрятаться</span></button>
    <button v-if="actorHidden" type="button" :disabled="working" @click="emit('stealth', 'unhide')"><GameIcon name="eye" :size="20" /><span>Выйти из тени</span></button>
    <template v-if="shieldMaster">
      <button type="button" :disabled="working || !economy.bonus || !targetId" title="«Мастер щита»: толчок бонусным действием" @click="emit('combat', 'shove-prone', { targetId, using: 'bonus' })">Толкнуть щитом: сбить с ног</button>
      <button type="button" :disabled="working || !economy.bonus || !targetId" @click="emit('combat', 'shove-push', { targetId, using: 'bonus' })">Толкнуть щитом: на 5 футов</button>
    </template>
  </template>
  <template v-else>
    <h4>Действия</h4>
    <button type="button" :disabled="working" title="Ловкость (Скрытность): не видят те, кто не заметит. Не спрятаться на свету на виду у врага" @click="emit('stealth', 'hide')"><GameIcon name="eye" :size="20" /><span>Спрятаться</span></button>
    <button type="button" :disabled="working" title="Мудрость (Восприятие): найти спрятавшихся, ловушки и тайное в 30 футах" @click="emit('stealth', 'search')"><GameIcon name="search" :size="20" /><span>Искать</span></button>
    <button v-if="actorHidden" type="button" :disabled="working" @click="emit('stealth', 'unhide')"><GameIcon name="eye" :size="20" /><span>Выйти из тени</span></button>
    <button type="button" :disabled="working || !targetId" @click="emit('combat', 'grapple', { targetId })"><GameIcon name="target" :size="20" />Схватить{{ targetName ? ` «${targetName}»` : '' }}</button>
    <button type="button" :disabled="working || !targetId" @click="emit('combat', 'shove-prone', { targetId })"><GameIcon name="sword" :size="20" /><span>Толкнуть: сбить с ног</span></button>
    <button v-if="actorGrappled" type="button" :disabled="working" @click="emit('combat', 'escape')"><GameIcon name="shield" :size="20" /><span>Вырваться из захвата</span></button>
    <h4>Помощь <small class="muted">следующей проверке союзника</small></h4>
    <div class="feature-row">
      <select v-model="helpAlly" class="sense-select" :disabled="working" aria-label="Кому помочь">
        <option value="">— кому —</option>
        <option v-for="target in allies" :key="target.characterId" :value="target.characterId">{{ target.name }}</option>
      </select>
      <button type="button" :disabled="working || !helpAlly" @click="help">Помочь</button>
    </div>
    <small class="muted">Ловушки и тайное рядом отряд замечает и сам — пассивным Восприятием.</small>
  </template>
</template>

<style scoped src="./actionPopover.css"></style>
