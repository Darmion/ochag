<script setup lang="ts">
import VisibilityControl, { type VisibilitySetting } from '../common/VisibilityControl.vue';
import type { CampaignMember } from '../../campaign/members';
import { ABILITIES, ABILITY_LABELS, formatSigned } from '../../characterSheet/abilities';
import type { Proficiencies } from '../../characterSheet/proficiencies';
import type { SheetRequest } from '../../characterSheet/types';
import { describe } from '../../characterSheet/sheetExtra';

defineProps<{
  proficiencies: Proficiencies;
  readOnly: boolean;
  legacySkills: Array<[string, unknown]>;
  legacySaves: Array<[string, unknown]>;
  campaignId: string;
  characterId: string;
  request: SheetRequest;
  campaignMembers: CampaignMember[];
  visibilityFor: (fieldKey: string) => VisibilitySetting;
}>();
const emit = defineEmits<{ visibility: [fieldKey: string, setting: VisibilitySetting] }>();
const onVisibilityChange = (fieldKey: string, setting: VisibilitySetting) => emit('visibility', fieldKey, setting);
</script>

<template>
  <details class="proficiency-editor">
    <summary>
      <span>Владение навыками и спасбросками</span>
      <small v-if="!readOnly">сохраняется сразу</small>
    </summary>

    <template v-if="!readOnly">
      <p class="muted proficiency-intro">
        Здесь настраиваются только владение, экспертиза, дополнительные бонусы и видимость. Все игровые броски находятся на экране «Герой».
      </p>
      <p v-if="proficiencies.skillsBusy || proficiencies.savesBusy" class="muted" role="status">Обновление владения…</p>

      <h4>Навыки</h4>
      <div class="proficiency-skill-grid" :aria-busy="proficiencies.skillsBusy">
        <article v-for="skill in proficiencies.visibleSkillRows" :key="skill.index" class="proficiency-skill-row">
          <div class="proficiency-name">
            <strong>{{ skill.nameRu }}</strong>
            <small>{{ skill.abilityRu }} · {{ proficiencies.skillTotal(skill) === null ? '—' : formatSigned(proficiencies.skillTotal(skill)!) }}</small>
          </div>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="proficiencies.characterSkills.find(s => s.index === skill.index)?.proficient ?? false"
              :disabled="proficiencies.skillsBusy"
              @input.stop
              @change.stop="proficiencies.setSkillState(skill.index, { proficient: ($event.target as HTMLInputElement).checked })"
            />
            Владение
          </label>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="proficiencies.characterSkills.find(s => s.index === skill.index)?.expertise ?? false"
              :disabled="proficiencies.skillsBusy || !(proficiencies.characterSkills.find(s => s.index === skill.index)?.proficient ?? false)"
              @input.stop
              @change.stop="proficiencies.setSkillState(skill.index, { expertise: ($event.target as HTMLInputElement).checked })"
            />
            Экспертиза
          </label>
          <VisibilityControl
            :field-key="`skill:${skill.index}`"
            :campaign-id="campaignId"
            :character-id="characterId"
            :request="request"
            :setting="visibilityFor(`skill:${skill.index}`)"
            :members="campaignMembers"
            @change="s => onVisibilityChange(`skill:${skill.index}`, s)"
          />
        </article>
      </div>

      <h4>Спасброски</h4>
      <div class="proficiency-save-grid" :aria-busy="proficiencies.savesBusy">
        <article v-for="ability in ABILITIES" :key="ability" class="proficiency-save-row">
          <div class="proficiency-name">
            <strong>{{ ABILITY_LABELS[ability] }}</strong>
            <small>{{ proficiencies.saveTotal(proficiencies.saveFor(ability)) === null ? '—' : formatSigned(proficiencies.saveTotal(proficiencies.saveFor(ability))!) }}</small>
          </div>
          <label class="checkbox-label">
            <input
              type="checkbox"
              :checked="proficiencies.saveFor(ability).proficient ?? false"
              :disabled="proficiencies.savesBusy"
              @input.stop
              @change.stop="proficiencies.setSaveState(ability, { proficient: ($event.target as HTMLInputElement).checked })"
            />
            Владение
          </label>
          <label class="custom-bonus-label">
            Свой бонус
            <input
              type="number"
              class="custom-bonus-input"
              :value="proficiencies.saveFor(ability).customBonus ?? 0"
              :disabled="proficiencies.savesBusy"
              @input.stop
              @change.stop="proficiencies.setSaveState(ability, { customBonus: Number(($event.target as HTMLInputElement).value) || 0 })"
            />
          </label>
          <VisibilityControl
            :field-key="`save:${ability}`"
            :campaign-id="campaignId"
            :character-id="characterId"
            :request="request"
            :setting="visibilityFor(`save:${ability}`)"
            :members="campaignMembers"
            @change="s => onVisibilityChange(`save:${ability}`, s)"
          />
        </article>
      </div>
    </template>

    <details v-if="legacySkills.length || legacySaves.length" class="legacy-proficiencies">
      <summary>Данные из импортированного листа</summary>
      <VisibilityControl v-if="!readOnly && legacySkills.length" field-key="legacy_skills" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('legacy_skills')" :members="campaignMembers" @change="s => onVisibilityChange('legacy_skills', s)" />
      <table v-if="legacySkills.length">
        <caption>Навыки</caption>
        <tr v-for="[key, value] in legacySkills" :key="key"><td>{{ key }}</td><td>{{ describe(value) }}</td></tr>
      </table>
      <VisibilityControl v-if="!readOnly && legacySaves.length" field-key="legacy_saves" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('legacy_saves')" :members="campaignMembers" @change="s => onVisibilityChange('legacy_saves', s)" />
      <table v-if="legacySaves.length">
        <caption>Спасброски</caption>
        <tr v-for="[key, value] in legacySaves" :key="key"><td>{{ key }}</td><td>{{ describe(value) }}</td></tr>
      </table>
    </details>
  </details>
</template>

<style scoped src="./sheetKit.css"></style>
<style scoped>
.custom-bonus-input{width:64px;display:inline-block;margin-left:4px}
.muted{font-size:13px}
.proficiency-editor{margin:18px 0;padding:0 14px 14px;border:1px solid var(--brass-light);border-radius:6px;background:color-mix(in srgb,var(--surface-inset) 72%,transparent)}
.proficiency-editor > summary{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:12px 0;cursor:pointer;font:700 15px var(--heading-font)}
.proficiency-editor > summary small{font:400 11px "Segoe UI",Arial,sans-serif;color:var(--muted-ink)}
.proficiency-intro{margin:0 0 14px}
.proficiency-editor h4{margin:16px 0 8px;font:700 14px var(--heading-font)}
.proficiency-skill-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px}
.proficiency-skill-row,.proficiency-save-row{display:grid;grid-template-columns:minmax(120px,1fr) auto auto auto;gap:10px;align-items:center;min-width:0;padding:7px 8px;border-bottom:1px solid var(--brass-light)}
.proficiency-name{display:flex;flex-direction:column;min-width:0}
.proficiency-name strong{font-size:13px;overflow-wrap:anywhere}
.proficiency-name small{font-size:11px;color:var(--muted-ink)}
.proficiency-editor .checkbox-label,.proficiency-editor .custom-bonus-label{display:flex;align-items:center;gap:5px;margin:0;font-size:12px;white-space:nowrap}
.proficiency-editor input{margin:0}
.proficiency-save-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px}
.proficiency-save-row{grid-template-columns:minmax(100px,1fr) auto auto auto}
.legacy-proficiencies{margin-top:14px;padding-top:10px;border-top:1px solid var(--brass-light)}
.legacy-proficiencies > summary{cursor:pointer;font-size:13px;color:var(--muted-ink)}
.legacy-proficiencies caption{text-align:left;padding:12px 0 4px;font-weight:700}
@media(max-width:900px){.proficiency-skill-grid,.proficiency-save-grid{grid-template-columns:1fr}}
@media(max-width:560px){.proficiency-skill-row,.proficiency-save-row{grid-template-columns:1fr auto}.proficiency-skill-row > .visibility-control,.proficiency-save-row > .visibility-control{grid-column:2;grid-row:1}.proficiency-editor .custom-bonus-label{white-space:normal}}
</style>
