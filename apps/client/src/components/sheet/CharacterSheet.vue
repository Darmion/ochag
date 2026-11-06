<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import type { CharacterDTO } from '../../characterSheet/types';
import { useAppearance } from '../../characterSheet/appearance';
import { useProficiencies } from '../../characterSheet/proficiencies';
import { useOtherTab } from '../../characterSheet/otherTab';
import { useResources } from '../../characterSheet/resources';
import GearTab from './GearTab.vue';
import OtherTab from './OtherTab.vue';
import { formatSigned } from '../../characterSheet/abilities';
import EditTab from './EditTab.vue';
import HeroTab from './HeroTab.vue';
import SheetConditions from './SheetConditions.vue';
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { ensureCampaignMembers, type CampaignMember } from '../../campaign/members';
import SpellsPanel from '../spells/SpellsPanel.vue';
import LevelUpModal from './LevelUpModal.vue';
import { onCampaignEvent } from '../../campaign/campaignEvents';
import VisibilityControl, { type VisibilitySetting } from '../common/VisibilityControl.vue';
import { cropStyle } from '../../art/imageCrop';
import { describe } from '../../characterSheet/sheetExtra';
import type { GameIconName } from '../../ui/gameIcons';
import { SIZE_LABELS, kindBadge } from '../../campaign/objects';
import { useSheetEffects } from '../../characterSheet/effects';
import { useSheetRolls } from '../../characterSheet/rolls';
import { useHeroTab } from '../../characterSheet/heroTab';
import { useSheetEditForm } from '../../characterSheet/editForm';
import GameIcon from '../game/GameIcon.vue';

const PUBLIC_SETTING: VisibilitySetting = { mode: 'public', allowedUserIds: [] };

const props = defineProps<{
  campaignId: string;
  characterId: string;
  token: string;
  currentUserId: string;
  request: (
    path: string,
    method?: string,
    body?: unknown,
    file?: File,
  ) => Promise<any>;
}>();

const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

type Tab = 'hero' | 'core' | 'spells' | 'gear' | 'other';
const ALL_TABS: Array<{ id: Tab; label: string; icon: GameIconName; creatureOnly?: boolean }> = [
  { id: 'hero', label: 'Герой', icon: 'shield', creatureOnly: true },
  { id: 'spells', label: 'Магия', icon: 'wand', creatureOnly: true },
  { id: 'gear', label: 'Снаряжение', icon: 'pouch' },
  { id: 'other', label: 'Другое', icon: 'sparkle', creatureOnly: true },
  { id: 'core', label: 'Правка листа', icon: 'scroll' },
];

const character = ref<CharacterDTO | null>(null);
const busy = ref(false);
const error = ref('');
const tab = ref<Tab>('hero');

const isCreature = computed(() => character.value?.kind !== 'object');
const TABS = computed(() => ALL_TABS
  .filter(t => !t.creatureOnly || isCreature.value)
  .map(t => (t.id === 'core' && !isCreature.value ? { ...t, label: 'Основное' } : t.id === 'gear' && !isCreature.value ? { ...t, label: 'Ресурсы' } : t))
  .sort((a, b) => Number(!isCreature.value && b.id === 'core') - Number(!isCreature.value && a.id === 'core')));

const canManageKinds = ref(false);
const levelUpOpen = ref(false);
const levelUpReady = computed(() => {
  const info = character.value?.experience_info;
  return Boolean(info && info.next !== null && (character.value?.experience ?? 0) >= info.next);
});
const experiencePercent = computed(() => {
  const info = character.value?.experience_info;
  if (!info || info.next === null) return 100;
  const span = info.next - info.floor;
  return span > 0 ? Math.max(0, Math.min(100, ((character.value?.experience ?? 0) - info.floor) / span * 100)) : 100;
});

function syncEditFields(data: CharacterDTO) {
  if (!ALL_TABS.some(t => t.id === tab.value && (!t.creatureOnly || data.kind !== 'object'))) tab.value = data.kind === 'object' ? 'core' : 'hero';
  void appearance.loadAppearancePreview(data);
  form.fillFromCharacter(data);
}

const readOnly = computed(() => character.value !== null && !character.value.privileged);
const campaignMembers = ref<CampaignMember[]>([]);

function isHidden(field: string): boolean {
  return character.value?.hiddenFields.includes(field) ?? false;
}

function visibilityFor(fieldKey: string): VisibilitySetting {
  return character.value?.visibility?.[fieldKey] ?? PUBLIC_SETTING;
}

function onVisibilityChange(fieldKey: string, setting: VisibilitySetting) {
  if (!character.value) return;
  character.value.visibility = { ...character.value.visibility, [fieldKey]: setting };
}

const dirty = ref(false);
const externalChange = ref(false);
let reloadWhenIdle = false;

function onExternalChange() {
  if (dirty.value) externalChange.value = true;
  else if (busy.value) reloadWhenIdle = true;
  else void load();
}
watch(busy, value => {
  if (value || !reloadWhenIdle) return;
  reloadWhenIdle = false;
  void load();
});

const stopEvents = onCampaignEvent('character', id => {
  if (id === props.characterId.toLowerCase()) onExternalChange();
});
onBeforeUnmount(() => stopEvents());

function reloadFromServer() {
  externalChange.value = false;
  dirty.value = false;
  void load();
}

async function load() {
  busy.value = true;
  reloadWhenIdle = false;
  error.value = '';
  dirty.value = false;
  externalChange.value = false;

  try {
    const data = await props.request(
      `/campaigns/${props.campaignId}/characters/${props.characterId}`,
    );
    character.value = data;
    void loadHeroNames();
    if (data.privileged) {
      syncEditFields(data);
      if (!campaignMembers.value.length) {
        campaignMembers.value = await ensureCampaignMembers(props.request, props.campaignId);
      }
      try {
        canManageKinds.value = (await props.request(`/campaigns/${props.campaignId}/characters`)).canManage === true;
      } catch {
        canManageKinds.value = false;
      }
    } else {
      void appearance.loadAppearancePreview(data);
      form.fillFromCharacter(data);
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить лист. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

function proficiencyForLevel(level: number): number {
  return Math.ceil(level / 4) + 1;
}

const proficiencyBonus = computed<number | null>(() => {
  if (typeof character.value?.level === 'number') return proficiencyForLevel(character.value.level);
  const raw = character.value?.sheet_extra?.proficiency;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const challenge = character.value?.challenge_rating;
  return typeof challenge === 'number' ? Math.floor((Math.max(1, challenge) - 1) / 4) + 2 : null;
});

const {
  rollAdvantage, spendInspiration, setInspiration, rollBusy, lastRoll, rollCheck, dyingNow,
  rollDeathSave,
} = useSheetRolls({
  props, character, busy, error, load,
});

const recordHpPercent = computed(() => {
  const data = character.value;
  if (!data || isHidden('hp_current') || isHidden('hp_max') || !data.hp_max) return null;
  return Math.max(0, Math.min(100, (data.hp_current / data.hp_max) * 100));
});

const proficiencies = useProficiencies({ props, character, error, readOnly, proficiencyBonus });

const {
  loadHeroNames, heroLine, initiativeBonus, passivePerception, weaponStat,
} = useHeroTab({
  props, character, proficiencyBonus, proficiencies,
});

watch(() => props.characterId, load);
watch(() => props.characterId, proficiencies.loadSkills);
watch(() => props.characterId, proficiencies.loadSaves);
const factionChips = ref<Array<{ id: string; name: string; color: string }>>([]);
async function loadFactions() {
  try {
    const data = await props.request(`/campaigns/${props.campaignId}/factions`);
    factionChips.value = (data.factions ?? [])
      .filter((faction: any) => (faction.members ?? []).some((member: any) => member.id === props.characterId))
      .map((faction: any) => ({ id: faction.id, name: faction.name, color: faction.color }));
  } catch {
    factionChips.value = [];
  }
}

onMounted(load);
onMounted(loadFactions);
onMounted(proficiencies.loadSkills);
onMounted(proficiencies.loadSaves);

const form = useSheetEditForm({ props, character, busy, error, dirty, canManageKinds, syncEditFields });

const appearance = useAppearance({ props, character, error, syncEditFields });

const effects = useSheetEffects({
  props, character, busy, error, load,
});

const resources = useResources({ props, busy, error, load });

function entries(value: unknown): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>);
}

const skills = computed(() => entries(character.value?.sheet_extra?.skills));
const legacySaves = computed(() => entries(character.value?.sheet_extra?.saves));
const weapons = computed(() => (Array.isArray(character.value?.sheet_extra?.weapons) ? character.value!.sheet_extra.weapons : []));
const spellsInfo = computed(() => entries(character.value?.sheet_extra?.spellsInfo));
const spellSlots = computed(() => entries(character.value?.sheet_extra?.spellSlots));
const other = useOtherTab({ props, character, tab, isCreature, editExtraText: toRef(form, 'extraText'), error, save: form.save });
</script>

<template>
  <div class="sheet-overlay" role="dialog" aria-modal="true" aria-label="Лист персонажа" @wheel.stop @pointerdown.stop @click.stop>
    <section class="sheet-parchment" :class="{ wide: tab === 'spells' }" @input="dirty = true" @change="dirty = true">
      <header>
        <div>
          <h2>{{ character?.name || 'Лист объекта' }}</h2>
          <p v-if="character" class="muted sheet-kind">{{ kindBadge(character) }} · {{ SIZE_LABELS[character.size].toLowerCase() }}</p>
          <p v-if="factionChips.length && character?.kind !== 'object'" class="sheet-factions" title="Фракции: общая — союзники; задаёт мастер (правый щелчок по фигуре → «Фракции»)">
            <span v-for="faction in factionChips" :key="faction.id"><i :style="{ background: faction.color }" />{{ faction.name }}</span>
          </p>
          <SheetConditions
            v-if="character" :character="character" :effects="effects" :read-only="readOnly" :busy="busy"
            :campaign-id="campaignId" :character-id="characterId" :request="request" :campaign-members="campaignMembers"
            :visibility-for="visibilityFor" @visibility="onVisibilityChange"
          />
        </div>
        <button type="button" @click="emit('close')">Закрыть</button>
      </header>

      <p v-if="error" class="notice error" role="alert">{{ error }}</p>
      <p v-if="externalChange" class="notice" role="status">
        Лист изменили снаружи (урон, другой участник), а у вас есть несохранённые правки.
        <button type="button" @click="reloadFromServer">Обновить — правки пропадут</button>
        <button type="button" @click="externalChange = false">Оставить мои</button>
      </p>

      <section v-if="character" class="sheet-summary" :class="{ compact: tab !== 'hero' }" aria-label="Основные показатели">
          <div v-if="isCreature" class="hero-top">
            <div class="hero-portrait">
              <img v-if="appearance.imagePreview" :src="appearance.imagePreview" alt="" :style="appearance.previewFromLibrary ? {} : cropStyle(character.image_crop)" />
              <span v-else>{{ character.name.slice(0, 1) }}</span>
            </div>
            <div class="hero-id">
              <p class="hero-line">{{ heroLine || kindBadge(character) }}<template v-if="character.level !== null"> · {{ character.level }}-й уровень</template></p>
              <div v-if="character.kind === 'character' && character.experience_info" class="hero-xp">
                <div class="xp-bar" role="progressbar" :aria-valuenow="character.experience ?? 0" :aria-valuemin="character.experience_info.floor" :aria-valuemax="character.experience_info.next ?? undefined">
                  <span :style="{ width: `${experiencePercent}%` }" />
                </div>
                <small class="muted">
                  {{ character.experience_info.next === null ? 'Наивысший уровень' : `Опыт ${character.experience ?? 0} / ${character.experience_info.next}` }}
                </small>
                <button v-if="!readOnly && levelUpReady" type="button" class="primary level-up-button" :disabled="busy" @click="levelUpOpen = true"><GameIcon class="inline-icon" name="levelUp" :size="16" /> Новый уровень!</button>
              </div>
              <p v-if="character.kind === 'character'" class="hero-inspiration" :class="{ lit: character.inspiration }">
                <GameIcon class="inline-icon" name="sparkle" :size="16" /> Вдохновение: {{ character.inspiration ? 'есть — отметьте «потратить» перед броском' : 'нет' }}
                <button v-if="canManageKinds" type="button" :disabled="busy" @click="setInspiration({ inspired: !character.inspiration })">
                  {{ character.inspiration ? 'Снять' : 'Даровать' }}
                </button>
              </p>
            </div>
          </div>

          <div class="hero-vitals">
            <div class="vital-card hp" :class="recordHpPercent === null ? '' : recordHpPercent <= 25 ? 'low' : recordHpPercent <= 60 ? 'mid' : 'high'" title="Хиты">
              <small>Хиты</small>
              <b>{{ isHidden('hp_current') ? '—' : character.hp_current }}<span> / {{ isHidden('hp_max') ? '—' : character.hp_max }}</span></b>
              <span v-if="recordHpPercent !== null" class="vital-bar"><span :style="{ width: `${recordHpPercent}%` }" /></span>
              <small v-if="character.hp_temp && !isHidden('hp_temp')" class="temp">+{{ character.hp_temp }} временных</small>
            </div>
            <div class="vital-card" title="Класс доспеха — сколько нужно выбросить врагу, чтобы попасть"><small>Защита (КД)</small><b>{{ isHidden('armor_class') ? '—' : character.armor_class }}</b></div>
            <div class="vital-card" title="Скорость за ход"><small>Скорость</small><b>{{ isHidden('speed_feet') ? '—' : character.speed_feet }}<span> фт.</span></b></div>
            <div v-if="isCreature" class="vital-card" title="Ловкость; черты и умения добавятся при броске"><small>Инициатива</small><b>{{ formatSigned(initiativeBonus) }}</b></div>
            <div v-if="proficiencyBonus !== null" class="vital-card" title="Бонус мастерства — к тому, чем герой владеет"><small>Мастерство</small><b>{{ formatSigned(proficiencyBonus) }}</b></div>
            <div v-if="passivePerception !== null" class="vital-card" title="Пассивное Восприятие — замечает ли герой спрятанное без броска"><small>Внимание</small><b>{{ passivePerception }}</b></div>
          </div>

          <div v-if="dyingNow" class="record-death">
            <span>При смерти: <GameIcon class="inline-icon" name="heartPlus" :size="14" /> {{ character.death_successes ?? 0 }}/3 · <GameIcon class="inline-icon" name="skull" :size="14" /> {{ character.death_failures ?? 0 }}/3</span>
            <button v-if="!readOnly" type="button" class="primary" :disabled="rollBusy" @click="rollDeathSave">Спасбросок от смерти</button>
          </div>


      </section>

      <nav class="sheet-tabs" aria-label="Разделы листа">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          :aria-pressed="tab === t.id"
          :aria-current="tab === t.id ? 'page' : undefined"
          :class="{ 'sheet-edit-tab': t.id === 'core' }"
          @click="tab = t.id"
        >
          <GameIcon class="ui-icon" :name="t.icon" :size="20" />{{ t.label }}
        </button>
      </nav>

      <template v-if="character">
        <div v-if="!readOnly && (tab === 'hero' || tab === 'gear')" class="roll-controls">
          <label class="checkbox-label">
            Бросок
            <select v-model="rollAdvantage">
              <option value="none">обычный</option>
              <option value="adv">с преимуществом</option>
              <option value="disadv">с помехой</option>
            </select>
          </label>
          <label v-if="character.inspiration" class="checkbox-label" title="Вдохновение: преимущество в этом броске">
            <input v-model="spendInspiration" type="checkbox" @input.stop @change.stop /> <GameIcon class="inline-icon" name="sparkle" :size="16" /> потратить вдохновение
          </label>
          <span v-if="lastRoll" class="muted">
            {{ lastRoll.label }}: <strong>{{ lastRoll.total }}</strong> ({{ lastRoll.results.join(', ') }})
          </span>
        </div>

        <LevelUpModal v-if="levelUpOpen" :campaign-id="campaignId" :character-id="characterId" :request="request" @close="levelUpOpen = false" @done="load" />

        <HeroTab
          v-if="tab === 'hero' && isCreature" :character="character" :read-only="readOnly" :roll-busy="rollBusy" :is-hidden="isHidden"
          :proficiencies="proficiencies" :weapon-stat="weaponStat" @roll="rollCheck"
        />

        <EditTab
          v-else-if="tab === 'core'" :form="form" :character="character" :is-creature="isCreature" :read-only="readOnly" :busy="busy"
          :roll-busy="rollBusy" :can-manage-kinds="canManageKinds" :level-up-ready="levelUpReady" :experience-percent="experiencePercent"
          :proficiency-bonus="proficiencyBonus" :proficiencies="proficiencies" :legacy-skills="skills" :legacy-saves="legacySaves" :appearance="appearance"
          :campaign-id="campaignId" :character-id="characterId" :request="request" :campaign-members="campaignMembers"
          :visibility-for="visibilityFor" :is-hidden="isHidden" @visibility="onVisibilityChange" @roll="key => rollCheck('ability', key)"
          @level-up="levelUpOpen = true" @dirty="dirty = true"
        />

        <section v-else-if="tab === 'spells'" class="sheet-tab">
          <SpellsPanel
            :campaign-id="campaignId"
            :character-id="characterId"
            :current-user-id="currentUserId"
            :request="request"
            :read-only="readOnly"
            :campaign-members="campaignMembers"
            :visibility="character.visibility ?? {}"
            @visibility-change="onVisibilityChange"
          />

          <details v-if="spellsInfo.length || spellSlots.length">
            <summary>Ячейки заклинаний из файла импорта (только чтение)</summary>
            <VisibilityControl v-if="!readOnly" field-key="legacy_spells" :campaign-id="campaignId" :character-id="characterId" :request="request" :setting="visibilityFor('legacy_spells')" :members="campaignMembers" @change="s => onVisibilityChange('legacy_spells', s)" />
            <table>
              <tr v-for="[key, value] in spellsInfo" :key="'info-' + key"><td>{{ key }}</td><td>{{ describe(value) }}</td></tr>
              <tr v-for="[key, value] in spellSlots" :key="'slot-' + key"><td>Ячейки {{ key }}</td><td>{{ describe(value) }}</td></tr>
            </table>
          </details>
        </section>

        <GearTab
          v-else-if="tab === 'gear'" :character="character" :is-creature="isCreature" :read-only="readOnly" :busy="busy"
          :roll-busy="rollBusy" :legacy-weapons="weapons" :resources="resources"
          :campaign-id="campaignId" :character-id="characterId" :request="request" :campaign-members="campaignMembers"
          :visibility-for="visibilityFor" @visibility="onVisibilityChange" @changed="load" @attack="weaponId => rollCheck('attack', weaponId)"
        />

        <OtherTab
          v-else-if="tab === 'other'" :other="other" :read-only="readOnly" :busy="busy"
          :campaign-id="campaignId" :character-id="characterId" :request="request" :campaign-members="campaignMembers"
          :visibility-for="visibilityFor" @visibility="onVisibilityChange"
        />
      </template>

      <p v-else-if="busy" class="muted">Загрузка…</p>
    </section>
  </div>
</template>

<style scoped src="./sheetKit.css"></style>
<style scoped>
.hero-top{display:flex;gap:14px;align-items:center}
.hero-portrait{width:56px;height:56px;flex-shrink:0;border-radius:8px;border:1px solid var(--brass);overflow:hidden;display:flex;align-items:center;justify-content:center;font:700 28px var(--heading-font);background:var(--surface-inset)}
.hero-portrait img{width:100%;height:100%;object-fit:cover}
.hero-id{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.hero-line{margin:0;font-size:14px}
.hero-xp{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.hero-xp .xp-bar{flex:1 1 160px}
.hero-xp small{margin:0}
.hero-inspiration{margin:0;font-size:13px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hero-inspiration:not(.lit){color:var(--muted-ink)}
.hero-inspiration button{min-height:26px;padding:2px 10px;font-size:12px}
.hero-inspiration.lit{opacity:1;font-weight:700;color:var(--brass)}
.hero-vitals{display:grid;grid-template-columns:1.6fr repeat(5,minmax(0,1fr));gap:8px}
.vital-card{position:relative;display:flex;flex-direction:column;gap:4px;padding:8px 12px;min-width:0;border-left:1px solid var(--brass-light);background:transparent}
.vital-card small{font-size:11px;line-height:1.3;margin:0;color:var(--muted-ink)}
.vital-card b{font:700 24px/1.2 "Segoe UI",Arial,sans-serif;font-variant-numeric:tabular-nums}
.vital-card b span{font-size:14px;font-weight:400}
.vital-card.hp{border:1px solid var(--brass);border-radius:6px;background:var(--surface-inset)}
.vital-card .temp{color:var(--muted-ink)}
.vital-card .vital-bar{display:block;height:4px;border-radius:2px;background:var(--brass-light);overflow:hidden}
.vital-card .vital-bar span{display:block;height:100%;background:var(--brass)}
.vital-card.hp.low{border-color:var(--burgundy)}
.vital-card.hp.low .vital-bar span{background:var(--burgundy)}
.sheet-overlay{position:fixed;inset:0;z-index:3000;background:#0b0704cc;display:flex;align-items:center;justify-content:center;padding:16px;overscroll-behavior:contain}
.sheet-parchment{--sheet-radius:6px;width:min(1040px,100%);max-height:calc(100dvh / var(--ui-zoom,1) - 32px);min-width:0;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-gutter:stable;padding:20px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:var(--sheet-radius);box-shadow:0 16px 40px #0008}
.sheet-parchment.wide{width:min(1360px,100%)}
.sheet-parchment > header{display:flex;justify-content:space-between;align-items:flex-start;flex-direction:row;gap:16px;margin-bottom:12px}
.sheet-parchment h2{font:700 27px var(--heading-font);margin:0}
.sheet-kind{margin:2px 0 0;font-size:14px}
.sheet-tabs{display:flex;gap:4px;flex-wrap:wrap;margin:16px 0;border-bottom:1px solid var(--brass-light);padding-bottom:8px}
.record-death{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font:600 15px var(--heading-font);color:var(--ink)}
.sheet-tabs button{display:inline-flex;align-items:center;justify-content:center;gap:6px;font:600 13px "Segoe UI",Arial,sans-serif;padding:8px 10px;white-space:nowrap}
.sheet-tabs button[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text);border-color:var(--burgundy);box-shadow:inset 0 -3px 0 var(--brass)}
.sheet-tab{overflow-wrap:anywhere}
.sheet-tab h3.section-gap{margin-top:22px}
.roll-controls{display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.roll-controls label{display:flex;align-items:center;gap:8px;margin:0}
.roll-controls select{width:auto;margin:0;min-height:32px}
.muted{font-size:13px}


.sheet-summary{display:flex;flex-direction:column;gap:12px}
.sheet-summary.compact{gap:7px}
.sheet-summary.compact .hero-top{display:none}
.sheet-summary.compact .hero-vitals{grid-template-columns:1.6fr repeat(5,minmax(90px,1fr));gap:4px}
.sheet-summary.compact .vital-card{padding:6px 10px}
.sheet-summary.compact .vital-card b{font-size:19px}
.sheet-parchment h2{overflow-wrap:anywhere}
.sheet-parchment > header > div{min-width:0}
.sheet-parchment > header > button{flex-shrink:0}
.sheet-edit-tab{margin-left:auto}
.sheet-tabs .sheet-edit-tab{border-style:dashed}
@media(max-width:760px){
  .hero-vitals{grid-template-columns:repeat(3,minmax(0,1fr))}
  .sheet-summary.compact .hero-vitals{grid-template-columns:repeat(3,minmax(0,1fr))}
  .sheet-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
  .sheet-tabs button{white-space:normal;overflow-wrap:normal;min-width:0}
  .sheet-edit-tab{margin-left:0}
}
@media(max-width:480px){
  .sheet-overlay{padding:8px}
  .sheet-parchment{padding:12px;max-height:calc(100dvh / var(--ui-zoom,1) - 16px)}
  .sheet-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hero-vitals{grid-template-columns:repeat(2,minmax(0,1fr))}
  .hero-portrait{display:none}
}

.sheet-factions{display:flex;flex-wrap:wrap;gap:6px;margin:2px 0 0;font-size:12px}
.sheet-factions span{display:inline-flex;align-items:center;gap:4px;padding:0 7px;border:1px solid var(--brass-light);border-radius:10px}
.sheet-factions i{width:8px;height:8px;border-radius:50%}
</style>
