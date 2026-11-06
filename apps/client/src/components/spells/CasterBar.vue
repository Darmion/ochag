<script setup lang="ts">
import type { Caster } from '../../spellsPanel/casting';
import type { SpellSlots } from '../../spellsPanel/slots';

defineProps<{ caster: Caster; spellSlots: SpellSlots; readOnly: boolean; busy: boolean }>();

const ABILITY_LABELS: Record<string, string> = {
  strength: 'Сила', dexterity: 'Ловкость', constitution: 'Телосложение', intelligence: 'Интеллект', wisdom: 'Мудрость', charisma: 'Харизма',
};
</script>

<template>
  <section class="caster-bar" aria-label="Заклинатель и ячейки">
    <div v-if="caster.casting" class="casting-line">
      <span class="casting-stat"><small>Характеристика</small><b>{{ ABILITY_LABELS[caster.casting.ability] ?? caster.casting.ability }}</b><small v-if="!caster.casting.abilityFromSheet">лучшая из ИНТ/МДР/ХАР</small></span>
      <span class="casting-stat" title="Сложность спасброска от заклинаний"><small>Сложность спасброска</small><b>{{ caster.casting.dc }}</b><small v-if="caster.casting.dcOverride !== null">из листа</small></span>
      <span class="casting-stat" title="Бонус атаки заклинанием"><small>Атака заклинанием</small><b>{{ caster.casting.attack >= 0 ? '+' : '' }}{{ caster.casting.attack }}</b><small v-if="caster.casting.attackOverride !== null">из листа</small></span>
      <button v-if="!readOnly && !caster.castingEdit" type="button" class="link-button" @click="caster.startCastingEdit">изменить</button>
    </div>
    <div class="slots-line">
      <span class="slots-title">Ячейки</span>
      <span v-for="slot in spellSlots.visibleSlots" :key="slot.level" class="slot-chip" :class="{ empty: slot.current === 0 }" :title="`${slot.level} круг: осталось ${slot.current} из ${slot.max}`">
        <b>{{ slot.level }}</b>
        <span v-if="slot.max <= 6" class="slot-pips" aria-hidden="true"><i v-for="index in slot.max" :key="index" :class="{ spent: index > slot.current }" /></span>
        <small>{{ slot.current }}/{{ slot.max }}</small>
      </span>
      <span v-if="spellSlots.pactSlots" class="slot-chip pact" :class="{ empty: spellSlots.pactSlots.current === 0 }" :title="`Ячейки договора ${spellSlots.pactSlots.slotLevel} круга — возвращаются на коротком отдыхе`">
        <b>договор {{ spellSlots.pactSlots.slotLevel }}</b>
        <span class="slot-pips" aria-hidden="true"><i v-for="index in spellSlots.pactSlots.max" :key="index" :class="{ spent: index > spellSlots.pactSlots.current }" /></span>
        <small>{{ spellSlots.pactSlots.current }}/{{ spellSlots.pactSlots.max }}</small>
      </span>
      <span v-if="!spellSlots.visibleSlots.length && !spellSlots.pactSlots" class="muted">нет{{ readOnly ? '' : ' — «по классу и уровню» или «править»' }}</span>
      <label v-if="spellSlots.pactSlots && !readOnly" class="checkbox-label" title="Ячейка договора тратится на своём уровне (заклинание пониже — сотворится выше) и возвращается на коротком отдыхе">
        <input v-model="spellSlots.usePact" type="checkbox" :disabled="spellSlots.pactSlots.current === 0" /> тратить ячейку договора
      </label>
      <template v-if="!readOnly">
        <button type="button" class="link-button" :disabled="busy" title="Максимум ячеек по таблице класса и уровню" @click="spellSlots.slotsByClass">по классу и уровню</button>
        <button type="button" class="link-button" :aria-pressed="spellSlots.showAllSlots" @click="spellSlots.showAllSlots = !spellSlots.showAllSlots">{{ spellSlots.showAllSlots ? 'готово' : 'править' }}</button>
      </template>
    </div>
    <div v-if="caster.casting && (caster.casting.knowsShield || caster.casting.knowsCounterspell || caster.casting.knowsRebuke)" class="reactions-line">
      <span class="slots-title">Реакцией сами</span>
      <label v-if="caster.casting.knowsShield" class="checkbox-label" title="Реакцией сам: попадание, которое не попало бы по КД + 5, превращается в промах; КД + 5 до начала своего хода. Тратит реакцию и наименьшую свободную ячейку.">
        <input type="checkbox" :checked="(caster.casting.autoReactions ?? []).includes('shield')" :disabled="busy || readOnly" @change="caster.toggleReaction('shield')" />
        «Щит» наготове
      </label>
      <label v-if="caster.casting.knowsCounterspell" class="checkbox-label" title="Без вопроса: заклинание врага 1-го уровня и выше на виду в 60 футах прерывается само — наименьшей ячейкой, что прервёт наверняка. Тратит реакцию и ячейку. Заговоры — нет.">
        <input type="checkbox" :checked="(caster.casting.autoReactions ?? []).includes('counterspell')" :disabled="busy || readOnly" @change="caster.toggleReaction('counterspell')" />
        «Контрзаклинание» наготове
      </label>
      <label v-if="caster.casting.knowsRebuke" class="checkbox-label" title="Без вопроса: ранивший на виду в 60 футах получает «Адское возмездие» — наименьшей ячейкой, реакцией (спасбросок ЛОВ, 2к10 огнём).">
        <input type="checkbox" :checked="(caster.casting.autoReactions ?? []).includes('hellish-rebuke')" :disabled="busy || readOnly" @change="caster.toggleReaction('hellish-rebuke')" />
        «Адское возмездие» наготове
      </label>
    </div>
    <div v-if="caster.castingEdit && caster.casting" class="casting-edit" role="group" aria-label="Заклинатель — правка">
      <label>Характеристика
        <select v-model="caster.castingDraft.ability" :disabled="busy">
          <option value="">лучшая из ИНТ/МДР/ХАР</option>
          <option v-for="(label, key) in ABILITY_LABELS" :key="key" :value="key">{{ label }}</option>
        </select>
      </label>
      <label>СЛ <input v-model="caster.castingDraft.dc" inputmode="numeric" :placeholder="`по расчёту: ${8 + caster.casting.proficiency + caster.casting.modifier}`" :disabled="busy" /></label>
      <label>Атака <input v-model="caster.castingDraft.attack" inputmode="numeric" :placeholder="`по расчёту: ${caster.casting.proficiency + caster.casting.modifier >= 0 ? '+' : ''}${caster.casting.proficiency + caster.casting.modifier}`" :disabled="busy" /></label>
      <button type="button" class="primary" :disabled="busy" @click="caster.saveCasting">Сохранить</button>
      <button type="button" :disabled="busy" @click="caster.castingEdit = false">Отмена</button>
    </div>
    <div v-if="spellSlots.showAllSlots && !readOnly" class="spell-slot-grid" aria-label="Ячейки — правка">
      <div v-for="slot in spellSlots.allSlots" :key="slot.level" class="spell-slot-chip" :class="{ empty: slot.current === 0 && slot.max > 0 }">
        <span class="spell-slot-level">{{ slot.level }} круг</span>
        <input
          type="number" min="0" class="spell-slot-input" :value="slot.current" :disabled="spellSlots.slotsBusy" :aria-label="`Осталось ячеек ${slot.level} уровня`"
          @change="spellSlots.setSlot(slot.level, { current: Number(($event.target as HTMLInputElement).value) || 0 })"
        />
        <span class="muted">из</span>
        <input
          type="number" min="0" class="spell-slot-input" :value="slot.max" :disabled="spellSlots.slotsBusy" :aria-label="`Всего ячеек ${slot.level} уровня`"
          @change="spellSlots.setSlot(slot.level, { max: Number(($event.target as HTMLInputElement).value) || 0 })"
        />
      </div>
    </div>
  </section>
</template>

<style scoped src="./spellsKit.css"></style>
<style scoped>
.spell-slot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr));gap:8px}
.spell-slot-chip{display:inline-flex;align-items:center;gap:5px;padding:10px;border:1px solid var(--brass-light);border-radius:6px;font-size:13px;flex-wrap:wrap}
.spell-slot-chip.empty{opacity:.75}
.spell-slot-level{font-weight:700}
.spells-panel .spell-slot-chip input.spell-slot-input{width:46px;min-width:0;flex:none;min-height:28px;padding:2px 4px}
.casting-line{display:flex;flex-wrap:wrap;align-items:center;gap:12px 24px;padding:14px 0;border-bottom:1px solid var(--brass-light);font-size:14px}
.casting-line small{opacity:.75}
.casting-edit{flex-basis:100%;display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px}
.casting-edit label{display:flex;flex-direction:column;gap:3px;margin:0;font-size:13px}
.casting-edit input{width:120px;min-height:32px}
.casting-edit select{min-height:32px}
.casting-stat{display:flex;flex-direction:column;gap:2px;min-width:110px}
.casting-stat small{margin:0;color:var(--muted-ink);font-size:11px;overflow-wrap:normal}
.slot-chip small{margin:0;display:inline}
.casting-stat b{font-size:20px;font-variant-numeric:tabular-nums}

.caster-bar{display:flex;flex-direction:column;gap:8px;padding:10px 12px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset)}
.caster-bar .casting-line{padding:0;border:0}
.slots-line,.reactions-line{display:flex;align-items:center;gap:6px 10px;flex-wrap:wrap;font-size:13px}
.slots-title{font-weight:700;margin-right:2px}
.slot-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border:1px solid var(--brass-light);border-radius:999px;font-size:12px}
.slot-chip b{font-variant-numeric:tabular-nums}
.slot-chip small{color:var(--muted-ink)}
.slot-chip.empty{opacity:.6}
.slot-chip.pact{border-style:dashed}
@media(max-width:480px){.casting-stat{min-width:0;flex:1 1 120px}}
</style>
