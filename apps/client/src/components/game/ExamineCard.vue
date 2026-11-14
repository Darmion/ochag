<script setup lang="ts">
import { computed } from 'vue';
import HudPortrait from './HudPortrait.vue';
import DamageTag from '../common/DamageTag.vue';
import ConditionIcon from '../conditions/ConditionIcon.vue';
import { conditionInfo } from '../../rules/conditions';
import { CREATURE_TYPE_OPTIONS } from '../../characterSheet/editForm';
import { SIZE_LABELS } from '../../campaign/objects';
import { priceText } from '../../../../../packages/domain/character/coins';
import type { PortraitFace } from '../../tabletop/view/hudPortraits';

// What an examining hero learned about a creature or an object; a part the roll did not reach shows «?».
export type ExamineCardView = {
  name: string; object: boolean; known: string[];
  kind?: { creatureType?: string | null; size?: string | null; level?: number | null; className?: string | null; cr?: number | null; weightLb?: number | null; priceCp?: number | null };
  hp?: { current: number; max: number; temp: number };
  ac?: number;
  abilities?: number[];
  defenses?: { resistant: string[]; immune: string[]; vulnerable: string[]; conditionImmunities: string | null };
  conditions?: string[];
  text?: string | null;
};
const props = defineProps<{ card: ExamineCardView; face: PortraitFace | null }>();
const knows = (part: string) => props.card.known.includes(part);
const ABILITIES = ['СИЛ', 'ЛОВ', 'ТЕЛ', 'ИНТ', 'МДР', 'ХАР'];
const typeLabel = (type: string | null | undefined) => CREATURE_TYPE_OPTIONS.find(([id]) => id === type)?.[1] ?? null;
const crText = (cr: number) => (cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr));
const kindLine = computed(() => {
  const kind = props.card.kind;
  if (!kind) return null;
  if (props.card.object) return [kind.weightLb ? `${String(kind.weightLb).replace('.', ',')} фнт.` : null, kind.priceCp ? priceText(kind.priceCp) : null].filter(Boolean).join(' · ') || null;
  const type = typeLabel(kind.creatureType);
  return [
    type ? type[0]!.toUpperCase() + type.slice(1) : null, kind.size ? SIZE_LABELS[kind.size as keyof typeof SIZE_LABELS] : null,
    kind.level ? `уровень ${kind.level}` : null, kind.className, kind.cr !== null && kind.cr !== undefined ? `опасность ${crText(kind.cr)}` : null,
  ].filter(Boolean).join(' · ');
});
const hpPercent = computed(() => (props.card.hp && props.card.hp.max ? Math.max(0, Math.min(100, Math.round(props.card.hp.current / props.card.hp.max * 100))) : 0));
const defenseGroups = computed(() => {
  const d = props.card.defenses;
  if (!d) return [];
  return ([['Сопротивление', d.resistant], ['Иммунитет', d.immune], ['Уязвимость', d.vulnerable]] as const).filter(([, types]) => types.length);
});
</script>

<template>
  <article class="examine-card">
    <figure class="portrait">
      <HudPortrait :name="card.name" :image-url="face?.imageUrl ?? null" :image-crop="face?.imageCrop" :crest="face?.crest ?? null" />
    </figure>
    <div class="info">
      <header>
        <div>
          <small v-if="card.object">Предмет</small>
          <small v-else-if="knows('kind')">{{ kindLine }}</small>
          <small v-else class="unknown" title="Бросок не открыл — сложность выше">Кто это — неизвестно</small>
          <h3 translate="no">{{ card.name }}</h3>
          <small v-if="card.object && kindLine">{{ kindLine }}</small>
        </div>
        <span class="ac" :title="knows('ac') ? 'Класс доспеха' : 'Класс доспеха не удалось узнать'"><small>КД</small><b>{{ knows('ac') ? card.ac : '?' }}</b></span>
      </header>
      <div v-if="card.hp" class="hp" :title="`Хиты: ${card.hp.current} из ${card.hp.max}`">
        <i :style="{ width: `${hpPercent}%` }" /><span>{{ card.hp.current }} / {{ card.hp.max }}<template v-if="card.hp.temp"> +{{ card.hp.temp }}</template></span>
      </div>
      <div v-else-if="!knows('hp')" class="hp unknown" title="Хиты не удалось узнать"><span>Хиты: ?</span></div>
      <div v-if="!card.object" class="abilities">
        <div v-for="(label, index) in ABILITIES" :key="label"><small>{{ label }}</small><b>{{ card.abilities ? card.abilities[index] : '?' }}</b></div>
      </div>
      <section v-if="!card.object">
        <h4>Состояния</h4>
        <p v-if="!knows('conditions')" class="unknown">Не удалось узнать.</p>
        <p v-else-if="!card.conditions?.length" class="muted">Ничего особенного.</p>
        <ul v-else class="conditions">
          <li v-for="code in card.conditions" :key="code"><ConditionIcon :name="conditionInfo(code).icon" :image="conditionInfo(code).image" :size="16" />{{ conditionInfo(code).label }}</li>
        </ul>
      </section>
      <section>
        <h4>Устойчивость</h4>
        <p v-if="!knows('defenses')" class="unknown">Не удалось узнать.</p>
        <p v-else-if="!defenseGroups.length && !card.defenses?.conditionImmunities" class="muted">Ничего особенного.</p>
        <template v-else>
          <div v-for="[label, types] in defenseGroups" :key="label" class="defense"><small>{{ label }}:</small>
            <span v-for="type in types" :key="type" class="chip"><DamageTag :type="type" /></span>
          </div>
          <p v-if="card.defenses?.conditionImmunities" class="defense"><small>Не подвержен:</small> {{ card.defenses.conditionImmunities }}</p>
        </template>
      </section>
      <p v-if="card.text" class="text" translate="no">{{ card.text }}</p>
      <p v-else-if="!knows('text')" class="unknown">Подробностей не разглядеть.</p>
    </div>
  </article>
</template>

<style scoped>
.examine-card{display:grid;grid-template-columns:minmax(140px,38%) 1fr;gap:16px;align-items:start}
.portrait{position:relative;margin:0;aspect-ratio:3/4;border:1px solid var(--brass);border-radius:8px;overflow:hidden;background:var(--surface-inset);display:grid;place-items:center}
.portrait :deep(.hud-portrait-image){width:100%;height:100%;object-fit:cover}
.portrait :deep(.hud-portrait-crest){width:70%;height:auto}
.info{display:grid;gap:10px;min-width:0}
header{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
header h3{margin:2px 0;font-size:22px;overflow-wrap:anywhere}
header small{color:var(--muted-ink);font-size:12px}
.ac{display:grid;place-items:center;min-width:46px;padding:4px 6px;border:2px solid var(--brass);border-radius:8px 8px 18px 18px;background:var(--surface-inset)}
.ac b{font:600 20px var(--g-title-font,Georgia)}
.hp{position:relative;height:20px;border:1px solid var(--brass-light);border-radius:4px;background:var(--surface-inset);overflow:hidden}
.hp i{position:absolute;inset:0 auto 0 0;background:color-mix(in srgb,#b5394a 70%,transparent)}
.hp span{position:relative;display:block;text-align:center;font-size:12px;line-height:18px}
.abilities{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;text-align:center}
.abilities div{display:grid;padding:4px 0;border:1px solid var(--brass-light);border-radius:6px}
.abilities small{font-size:11px;color:var(--muted-ink)}
.abilities b{font:600 16px var(--g-title-font,Georgia)}
section h4{margin:0 0 4px;font-size:13px;color:var(--g-gold,var(--brass));text-align:center}
.conditions{list-style:none;margin:0;padding:0;display:grid;gap:3px;font-size:13px}
.conditions li{display:flex;align-items:center;gap:6px}
.defense{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;margin:3px 0;font-size:13px}
.defense small{color:var(--muted-ink)}
.chip{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;border:1px solid var(--brass-light);border-radius:10px;font-size:12px}
.text{margin:0;padding:8px 10px;border-left:2px solid var(--brass);font-style:italic;line-height:1.5}
.unknown{color:var(--muted-ink);font-style:italic}
.muted{color:var(--muted-ink)}
@media (max-width:560px){.examine-card{grid-template-columns:1fr}.portrait{max-width:180px;justify-self:center}}
</style>
