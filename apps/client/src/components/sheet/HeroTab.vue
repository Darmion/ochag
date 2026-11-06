<script setup lang="ts">
import ItemArt from '../rpg/ItemArt.vue';
import { ABILITIES, ABILITY_LABELS, formatSigned, modifier } from '../../characterSheet/abilities';
import type { useHeroTab } from '../../characterSheet/heroTab';
import type { Proficiencies } from '../../characterSheet/proficiencies';
import { RECHARGE_LABELS } from '../../characterSheet/resources';
import type { CharacterDTO } from '../../characterSheet/types';

type RollKind = 'save' | 'skill' | 'ability' | 'attack';

defineProps<{
  character: CharacterDTO;
  readOnly: boolean;
  rollBusy: boolean;
  isHidden: (field: string) => boolean;
  proficiencies: Proficiencies;
  weaponStat: ReturnType<typeof useHeroTab>['weaponStat'];
}>();
const emit = defineEmits<{ roll: [kind: RollKind, key: string] }>();
const rollCheck = (kind: RollKind, key: string) => emit('roll', kind, key);
</script>

<template>
  <section class="sheet-tab hero-tab">
    <h4 class="hero-section">Характеристики <small class="muted">щелчок — проверка, кнопка ниже — спасбросок</small></h4>
    <div class="hero-abilities">
      <div v-for="key in ABILITIES" :key="key" class="hero-ability">
        <button type="button" class="ability-roll" :disabled="readOnly || rollBusy || isHidden(key)" :title="`${ABILITY_LABELS[key]}: проверка характеристики`" @click="rollCheck('ability', key)">
          <small>{{ ABILITY_LABELS[key] }}</small>
          <b>{{ isHidden(key) ? '?' : modifier(character[key]) }}</b>
          <span>{{ isHidden(key) ? 'скрыто' : `Значение ${character[key]}` }}</span>
        </button>
        <button
          type="button" class="save-roll" :class="{ proficient: proficiencies.saveFor(key).proficient }"
          :disabled="readOnly || rollBusy || proficiencies.saveFor(key).hidden" :title="`Спасбросок: ${ABILITY_LABELS[key]}${proficiencies.saveFor(key).proficient ? ' (владение)' : ''}`"
          @click="rollCheck('save', key)"
        >
          {{ proficiencies.saveFor(key).proficient ? '●' : '○' }} спасбр. {{ proficiencies.saveTotal(proficiencies.saveFor(key)) === null ? '—' : formatSigned(proficiencies.saveTotal(proficiencies.saveFor(key))!) }}
        </button>
      </div>
    </div>

    <div class="hero-play-grid">
      <section class="hero-skill-panel" aria-labelledby="hero-skills-title">
        <h4 id="hero-skills-title" class="hero-section">Навыки <small class="muted">● владение, ◆ экспертиза</small></h4>
        <div class="hero-skills">
          <button
            v-for="skill in proficiencies.visibleSkillRows" :key="skill.index" type="button" class="skill-roll" :class="{ proficient: proficiencies.skillMark(skill.index) }"
            :disabled="readOnly || rollBusy" :title="`${skill.nameRu} (${skill.abilityRu}) — бросить проверку`" @click="rollCheck('skill', skill.index)"
          >
            <span class="mark">{{ proficiencies.skillMark(skill.index) }}</span>
            <span class="skill-name">{{ skill.nameRu }} <small>{{ skill.abilityRu }}</small></span>
            <b>{{ proficiencies.skillTotal(skill) === null ? '—' : formatSigned(proficiencies.skillTotal(skill)!) }}</b>
          </button>
        </div>
      </section>

      <aside class="hero-action-panel" aria-label="Боевые действия и ресурсы">
        <template v-if="(character.weapons ?? []).length && !isHidden('weapons')">
          <h4 class="hero-section">Атаки <small class="muted">готовые броски оружия</small></h4>
          <div class="hero-attacks">
            <div v-for="weapon in character.weapons" :key="weapon.id" class="attack-row">
              <span class="attack-name"><ItemArt :name="weapon.name" :srd-index="weapon.srd_index" :size="30" :fallback-icon="weapon.weapon_kind === 'ranged' ? 'bow' : 'swords'" /> {{ weapon.name }}</span>
              <span class="attack-hit">{{ formatSigned(weaponStat(weapon).toHit) }} к попаданию</span>
              <span class="attack-damage">{{ weaponStat(weapon).damage || '—' }}</span>
              <button v-if="!readOnly" type="button" :disabled="rollBusy" @click="rollCheck('attack', weapon.id)">Атаковать</button>
            </div>
          </div>
        </template>

        <template v-if="character.resources.length">
          <h4 class="hero-section">Ресурсы <small class="muted">быстрый остаток</small></h4>
          <div class="hero-resources">
            <span v-for="resource in character.resources" :key="resource.id" class="resource-pill" :title="resource.recharge && resource.recharge !== 'none' ? `восстанавливается: ${RECHARGE_LABELS[resource.recharge]}` : ''">
              {{ resource.name }} <b>{{ resource.current }}/{{ resource.max }}</b>
            </span>
          </div>
        </template>

        <p v-if="!readOnly" class="muted hero-hint">Числа и владение меняются в «Правке листа».</p>
      </aside>
    </div>
  </section>
</template>

<style scoped src="./sheetKit.css"></style>
<style scoped>
.hero-tab{display:flex;flex-direction:column;gap:10px}
.hero-section{margin:8px 0 0;font:700 17px var(--heading-font);display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}
.hero-section small{font:400 12px "Segoe UI",Arial,sans-serif}
.hero-abilities{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:6px}
.hero-ability{display:flex;flex-direction:column;gap:4px}
.ability-roll{display:flex;flex-direction:column;align-items:center;padding:10px 4px;min-height:94px;gap:4px}
.ability-roll small{font-size:11px;font-weight:700}
.ability-roll b{font:700 26px/1.15 "Segoe UI",Arial,sans-serif;font-variant-numeric:tabular-nums}
.ability-roll span{font-size:12px;opacity:.75}
.save-roll{font-size:11px;min-height:28px;padding:2px 4px}
.save-roll.proficient{font-weight:700;border-color:var(--brass)}
.hero-play-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.8fr);gap:20px;align-items:start;margin-top:4px}
.hero-skill-panel,.hero-action-panel{min-width:0}
.hero-action-panel{padding-left:18px;border-left:1px solid var(--brass-light)}
.hero-skills{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:4px 16px}
.skill-roll{display:flex;align-items:center;gap:6px;justify-content:flex-start;padding:4px 8px;min-height:32px;text-align:left}
.skill-roll .mark{width:12px;color:var(--brass)}
.skill-roll .skill-name{flex:1;font:400 13px "Segoe UI",Arial,sans-serif;letter-spacing:0;overflow-wrap:normal;opacity:.8}
.skill-roll .skill-name small{font-size:10px;color:var(--muted-ink);text-transform:uppercase;margin-left:4px}
.skill-roll.proficient .skill-name{font-weight:700;opacity:1}
.hero-attacks{display:flex;flex-direction:column;gap:4px}
.attack-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 8px;align-items:center;padding:8px;border:1px solid var(--brass-light);border-radius:6px}
.attack-name{font-weight:700;display:flex;align-items:center;gap:6px}
.attack-hit,.attack-damage{font-size:12px;color:var(--muted-ink)}
.attack-row button{grid-column:2;grid-row:1 / 3}
.hero-resources{display:flex;flex-wrap:wrap;gap:6px}
.resource-pill{padding:3px 10px;border:1px solid var(--brass-light);border-radius:12px;font-size:13px}
.hero-hint{margin-top:6px}
@media (max-width:820px){.hero-play-grid{grid-template-columns:1fr}.hero-action-panel{padding-left:0;padding-top:10px;border-left:0;border-top:1px solid var(--brass-light)}}
@media (max-width:640px){.attack-row{grid-template-columns:minmax(0,1fr) auto}}
.muted{font-size:13px}
.sheet-parchment .skill-roll{border-width:0 0 1px;border-radius:0;background:transparent}
.skill-roll b{min-width:3ch;text-align:right;font-size:17px;font-variant-numeric:tabular-nums}
@media(max-width:760px){.hero-abilities{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>
