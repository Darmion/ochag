<script setup lang="ts">
import { describeSpellMechanics } from '../../../spells/spellMechanics';
import { RIDER_TEXT } from '../../../actionBar/constants';
import { spellName } from '../../../actionBar/spellCatalog';
import { ELEMENT_LABELS, crLabel } from '../../../actionBar/summonChoices';
import { PROJECTILE_NOUN } from '../../../actionBar/spellTargets';
import type { CastView, Metamagic, SpellEntry } from '../../../actionBar/types';

const castMode = defineModel<string>('castMode', { required: true });
const castElement = defineModel<string>('castElement', { required: true });
const conjureOption = defineModel<number>('conjureOption', { required: true });
const castBeast = defineModel<string>('castBeast', { required: true });
const warnFriendly = defineModel<boolean>('warnFriendly', { required: true });
const castSlot = defineModel<number>('castSlot', { required: true });
const castMetamagic = defineModel<Metamagic>('castMetamagic', { required: true });
const castHeightened = defineModel<string>('castHeightened', { required: true });
const castEmpowered = defineModel<boolean>('castEmpowered', { required: true });
const useRitual = defineModel<boolean>('useRitual', { required: true });
const castOverchannel = defineModel<boolean>('castOverchannel', { required: true });
const useFree = defineModel<boolean>('useFree', { required: true });
const useRacial = defineModel<boolean>('useRacial', { required: true });
const usePact = defineModel<boolean>('usePact', { required: true });
defineProps<{ entry: SpellEntry; view: CastView; working: boolean; inCombat: boolean }>();
const emit = defineEmits<{ aim: []; cast: []; back: []; shots: [id: string, delta: number] }>();
</script>

<template>
  <h4>{{ spellName(entry) }}</h4>
  <small class="muted">{{ describeSpellMechanics(entry.spell?.mechanics) }}</small>
  <small v-if="entry.spell?.riders?.length" class="muted">{{ entry.spell.riders.map(kind => RIDER_TEXT[kind] ?? kind).join(' · ') }}</small>
  <small v-if="entry.spell?.targetLimit && !entry.spell?.summon" class="muted">Целей — не больше {{ entry.spell.targetLimit }} (+1 за уровень ячейки выше).</small>
  <small v-if="entry.spell?.singleTarget && !entry.spell?.summon" class="muted">{{ castMetamagic === 'twinned' ? '«Удвоенное заклинание» — две цели.' : 'На одно существо.' }}</small>
  <label v-if="entry.spell?.modes?.length" class="target-select" title="Режим заклинания — какой набор действий сработает">
    Режим
    <select v-model="castMode" :disabled="working">
      <option v-for="mode in entry.spell.modes" :key="mode.id" :value="mode.id" translate="no">{{ mode.name }}</option>
    </select>
  </label>
  <label v-if="entry.spell?.element?.length" class="target-select" title="Что выбрать при сотворении: стихия сопротивления или вид урона">
    Стихия
    <select v-model="castElement" :disabled="working">
      <option v-for="element in entry.spell.element" :key="element" :value="element">{{ ELEMENT_LABELS[element] ?? element }}</option>
    </select>
  </label>
  <template v-if="entry.spell?.summon || entry.spell?.shape">
    <label v-if="entry.spell?.summon?.options" class="target-select" title="«Призыв животных»: чем больше зверей, тем они слабее; ячейка 5-го круга — вдвое больше, 7-го — втрое, 9-го — вчетверо">
      Сколько
      <select v-model.number="conjureOption" :disabled="working">
        <option v-for="(option, index) in entry.spell.summon.options" :key="index" :value="index">{{ view.conjureCounts[index] }} — до опасности {{ crLabel(option.cr) }}</option>
      </select>
    </label>
    <label class="target-select">
      {{ entry.spell?.summon ? 'Кого призвать' : 'Облик' }}
      <select v-model="castBeast" :disabled="working || !view.beasts.length">
        <option v-for="form in view.beasts" :key="form.index" :value="form.index" translate="no">{{ form.label }}</option>
      </select>
    </label>
    <small v-if="entry.spell?.summon?.kind === 'familiar'" class="muted">Фамильяр не атакует; новый прогоняет прежнего.</small>
    <small v-else-if="entry.spell?.summon?.kind === 'steed'" class="muted">Скакун — по одному: новый прогоняет прежнего.</small>
    <small v-else-if="entry.spell?.summon" class="muted">Звери — на вашей стороне, пока держится концентрация.</small>
    <small v-else-if="entry.spell?.shape?.kind === 'polymorph'" class="muted">Опасность зверя — не выше опасности (или уровня) цели; свои согласны без спасброска.</small>
    <small v-else class="muted">Только согласные; звери до опасности 4, не больше Большого.</small>
  </template>
  <p class="map-instruction">{{ entry.spell?.summon ? 'Место — щелчком по клетке рядом с вами.' : entry.spell?.area ? 'Область ставится щелчком по карте — видно, кого она заденет.' : 'Выбирайте цели на карте. Повторный щелчок убирает цель у заклинаний на несколько существ.' }}</p>
  <button type="button" class="primary" :disabled="working || ((Boolean(entry.spell?.summon) || Boolean(entry.spell?.shape)) && !castBeast)" @click="emit('aim')">{{ entry.spell?.summon ? 'Поставить на карте' : entry.spell?.area ? 'Поставить область на карте' : 'Выбрать цели на карте' }}</button>
  <label class="checkbox-label friendly-flag" title="Вредное по союзнику или помощь врагу (по фракциям) — сначала спросить. Область задевает всех по правилам — её не спрашивает">
    <input v-model="warnFriendly" type="checkbox" :disabled="working" /> Подтверждать вред союзнику и помощь врагу
  </label>
  <div v-if="entry.spell?.projectiles" class="shots">
    <small class="muted">{{ PROJECTILE_NOUN[entry.spell.projectiles.noun] }}: {{ view.projectileTotal }}{{ view.chosen.length > 1 ? ` — поделено ${view.shotsAssigned}` : view.chosen.length ? ' — все в одну цель' : '' }}</small>
    <template v-if="view.chosen.length > 1">
      <div v-for="target in view.chosen" :key="target.id" class="shot-row">
        <span>{{ target.name }}</span>
        <button type="button" :disabled="working || !view.shotsPer[target.id]" @click="emit('shots', target.id, -1)">−</button>
        <b>{{ view.shotsPer[target.id] ?? 0 }}</b>
        <button type="button" :disabled="working || view.shotsAssigned >= view.projectileTotal" @click="emit('shots', target.id, 1)">+</button>
      </div>
    </template>
  </div>
  <label v-if="view.slots.length > 1 && !usePact && !(useFree && view.freeCast)" class="target-select">
    Ячейка
    <select v-model.number="castSlot" :disabled="working">
      <option :value="0">наименьшая свободная ({{ view.slots[0]?.level }} ур.)</option>
      <option v-for="slot in view.slots" :key="slot.level" :value="slot.level">{{ slot.level }} ур. — осталось {{ slot.current }} из {{ slot.max }}</option>
    </select>
  </label>
  <small v-if="entry.slotless" class="muted">Сотворяется без ячейки.</small>
  <label v-if="view.metamagic.length" class="target-select" title="Метамагия чародея: очки чародейства">
    Метамагия
    <select v-model="castMetamagic" :disabled="working">
      <option value="">— без метамагии —</option>
      <option v-if="view.metamagic.includes('quickened')" value="quickened">Ускоренное — бонусным действием (2 очка)</option>
      <option v-if="view.metamagic.includes('twinned') && entry.spell?.singleTarget" value="twinned">Удвоенное — вторая цель ({{ view.twinCost }} оч.)</option>
      <option v-if="view.metamagic.includes('careful') && entry.spell?.mechanics?.save" value="careful">Осторожное — свои спасаются сами (1 очко)</option>
      <option v-if="view.metamagic.includes('heightened') && entry.spell?.mechanics?.save" value="heightened">Повышенное — помеха спасброску цели (3 очка)</option>
      <option v-if="view.metamagic.includes('distant')" value="distant">Отдалённое — дальность вдвое, касание — 30 фт. (1 очко)</option>
      <option v-if="view.metamagic.includes('extended')" value="extended">Продлённое — длительность вдвое (1 очко)</option>
      <option v-if="view.metamagic.includes('subtle')" value="subtle">Неуловимое — не ответить «Контрзаклинанием» (1 очко)</option>
    </select>
    <select v-if="castMetamagic === 'heightened' && view.chosen.length > 1" v-model="castHeightened" :disabled="working" aria-label="Чей спасбросок с помехой">
      <option value="">помеха — первому врагу</option>
      <option v-for="target in view.chosen" :key="target.id" :value="target.id">помеха — {{ target.name }}</option>
    </select>
    <label v-if="view.metamagic.includes('empowered') && entry.spell?.mechanics?.damageFormula" class="checkbox-label" title="Можно вместе с другой метамагией">
      <input v-model="castEmpowered" type="checkbox" :disabled="working" /> Усиленное — перебросить слабые кости урона (+1 очко)
    </label>
    <small class="muted">очков чародейства: {{ view.sorcery.current }} из {{ view.sorcery.max }}</small>
  </label>
  <label v-if="entry.spell?.ritual && !inCombat" class="checkbox-label" title="Ритуал: без ячейки, сотворение — на 10 минут дольше; волшебник, жрец, друид, бард или черта «Ритуальный заклинатель»">
    <input v-model="useRitual" type="checkbox" :disabled="working" /> ритуалом — без ячейки, +10 минут
  </label>
  <label v-if="view.overchannelReady" class="checkbox-label" title="«Сверхзаряд» Воплощения 14: кости урона наибольшие. Первый раз до долгого отдыха — даром, дальше — некротический урон себе">
    <input v-model="castOverchannel" type="checkbox" :disabled="working" /> сверхзарядом — урон наибольший <small class="muted">({{ view.overchannelDetail }})</small>
  </label>
  <label v-if="view.freeCast && !(useRitual && entry.spell?.ritual && !inCombat)" class="checkbox-label" title="Умение класса: заклинание без ячейки">
    <input v-model="useFree" type="checkbox" :disabled="working" /> {{ view.freeCast?.label }}
  </label>
  <label v-if="view.legacy" class="checkbox-label" title="«Дьявольское наследие»: без ячейки, Харизмой, раз до долгого отдыха">
    <input v-model="useRacial" type="checkbox" :disabled="working" />
    по наследию тифлинга — без ячейки{{ view.legacy?.castAt ? ` (${view.legacy?.castAt} ур.)` : '' }}{{ view.legacy?.charge ? `, осталось ${view.legacy?.charge?.current} из ${view.legacy?.charge?.max}` : '' }}
  </label>
  <label v-if="view.pactCastable && !(useRacial && view.legacy)" class="checkbox-label" title="Ячейка договора тратится на своём уровне и возвращается на коротком отдыхе">
    <input v-model="usePact" type="checkbox" :disabled="working || !view.pactSlots?.current" />
    ячейкой договора ({{ view.pactSlots?.slotLevel }} ур., осталось {{ view.pactSlots?.current }} из {{ view.pactSlots?.max }})
  </label>
  <div class="cast-buttons">
    <button v-if="!entry.spell?.summon" type="button" class="primary" :disabled="working" @click="emit('cast')">Сотворить{{ view.chosen.length || view.hasArea ? '' : ' без целей' }}</button>
    <button type="button" :disabled="working" @click="emit('back')">Назад</button>
  </div>
</template>

<style scoped src="./actionPopover.css"></style>
<style scoped>
.shots{display:grid;gap:2px}
.shot-row{display:flex;align-items:center;gap:6px;font-size:13px}
.shot-row > span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.shot-row > b{min-width:1.5em;text-align:center}
.action-popover .shot-row button{flex:0 0 auto;width:28px;min-width:28px;min-height:24px;padding:0;justify-content:center}
</style>
