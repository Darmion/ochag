<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import { cssZoom } from '../../settings/uiScale';
import { ensureSrdSpells, invalidateSrdSpells, type SrdSpell } from '../../rules/srd';
import { describeGroups } from '../../rules/dice';
import type { VisibilitySetting, CampaignMember } from '../common/VisibilityControl.vue';
import ItemCard from '../rpg/ItemCard.vue';
import ItemArt from '../rpg/ItemArt.vue';
import { isOwnSpellArt, spellOrSchoolArt, templateArt } from '../../art/spellArt';

import type { MechanicsOverrides, SpellFormulas } from './SpellMechanicsEditor.vue';
import SpellBuilder from '../spellbuilder/SpellBuilder.vue';
import SpellFilters from './SpellFilters.vue';
import SpellList from './SpellList.vue';
import CasterBar from './CasterBar.vue';
import PendingRefs from './PendingRefs.vue';
import SpellCard from './SpellCard.vue';
import { useSpellBrowser } from '../../spellsPanel/browser';
import { useSpellcasting } from '../../spellsPanel/casting';
import { useRefMapping } from '../../spellsPanel/refMapping';
import { useSpellSlots } from '../../spellsPanel/slots';
import { STATUS_LABEL, schoolIcon, schoolLabel, spellDesc, spellFacts, spellHigherLevel, spellName } from '../../spellsPanel/spellInfo';
import type { BrowseItem, CampaignSpell, CastOption, CharacterSpellEntry, FormulaRoll, LastCast } from '../../spellsPanel/types';
import GameIcon from '../game/GameIcon.vue';

type Section = 'browse' | 'custom' | 'review';
const section = ref<Section>('browse');

const props = defineProps<{
  campaignId: string;
  characterId: string;
  currentUserId: string;
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
  readOnly: boolean;
  campaignMembers: CampaignMember[];
  visibility: Record<string, VisibilitySetting>;
}>();

const emit = defineEmits<{ visibilityChange: [fieldKey: string, setting: VisibilitySetting] }>();

const PUBLIC_SETTING: VisibilitySetting = { mode: 'public', allowedUserIds: [] };
function visibilityFor(fieldKey: string): VisibilitySetting {
  return props.visibility[fieldKey] ?? PUBLIC_SETTING;
}

const busy = ref(false);
const error = ref('');

const known = ref<CharacterSpellEntry[]>([]);
const srdLibrary = ref<SrdSpell[]>([]);
const customLibrary = ref<CampaignSpell[]>([]);
const canReview = ref(false);

async function loadKnown() {
  busy.value = true;
  error.value = '';

  try {
    const data = await props.request(
      `/campaigns/${props.campaignId}/characters/${props.characterId}/spells`,
    );
    known.value = data.spells;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить заклинания. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

async function loadLibrary() {
  try {
    srdLibrary.value = await ensureSrdSpells(props.request);
    const data = await props.request(`/campaigns/${props.campaignId}/spells`);
    customLibrary.value = data.spells;
    canReview.value = data.canReview;
    pendingRevisions.value = data.pendingRevisions ?? [];
    try {
      srdOverrides.value = new Set((await props.request(`/campaigns/${props.campaignId}/srd-templates`)).overrides.map((row: { index: string }) => row.index));
    } catch {
      srdOverrides.value = new Set();
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить библиотеку заклинаний. Попробуйте ещё раз.';
  }
}

const spellSlots = useSpellSlots({ props, busy, error });
const castBusy = ref(false);
const lastCast = ref<LastCast | null>(null);

function overridesOf(entry: CharacterSpellEntry): MechanicsOverrides | null {
  if (entry.source === 'srd') return srdLibrary.value.find(spell => spell.index === entry.srdIndex)?.mechanicsOverrides as MechanicsOverrides ?? null;
  const spell = entry.spell as any;
  return spell ? {
    attackKind: spell.attackKind ?? null, saveAbility: spell.saveAbility ?? null, halfOnSave: spell.halfOnSave ?? null,
    damageType: spell.damageType ?? null, conditionCode: spell.conditionCode ?? null,
    conditionRounds: spell.conditionRounds ?? null, conditionRepeat: spell.conditionRepeat ?? null,
    createsZone: spell.createsZone === true,
  } : null;
}

const mechanicsFor = ref('');

async function saveMechanics(entry: CharacterSpellEntry, overrides: MechanicsOverrides, formulas: SpellFormulas | null = null) {
  busy.value = true;
  error.value = '';
  try {
    if (entry.source === 'srd') {
      await props.request(`/srd/spells/${entry.srdIndex}/mechanics`, 'POST', {
        ...overrides,
        ...(formulas?.damageFormula ? { damageFormula: formulas.damageFormula } : {}),
        ...(formulas?.healingFormula ? { healingFormula: formulas.healingFormula } : {}),
      });
      invalidateSrdSpells();
      srdLibrary.value = await ensureSrdSpells(props.request);
      if (formulas?.upcastFormula) {
        await props.request(`/srd/spells/${entry.srdIndex}/mechanics`, 'POST', { upcastFormula: formulas.upcastFormula });
      }
    } else {
      await props.request(`/campaigns/${props.campaignId}/spells/${entry.customSpellId}/mechanics`, 'PUT', overrides);
      if (formulas) {
        await props.request(`/campaigns/${props.campaignId}/spells/${entry.customSpellId}`, 'PATCH', {
          damageFormula: formulas.damageFormula, healingFormula: formulas.healingFormula, upcastFormula: formulas.upcastFormula ?? null,
        });
        await loadLibrary();
      }
    }
    mechanicsFor.value = '';
    await loadKnown();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить механику. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

async function castSpell(entry: CharacterSpellEntry, option?: { slotLevel?: number; pact?: boolean }) {
  castBusy.value = true;
  castMenuFor.value = '';
  error.value = '';

  try {
    const level = entry.spell?.level ?? 0;
    const pact = option ? option.pact === true : spellSlots.usePact && spellSlots.pactSlots && level > 0 && !entry.slotless;
    const body = pact ? { pact: true } : option?.slotLevel && option.slotLevel !== level ? { slotLevel: option.slotLevel } : {};
    const result = await props.request(
      `/campaigns/${props.campaignId}/characters/${props.characterId}/spells/${entry.id}/cast`,
      'POST',
      body,
    );
    if (result.pending) {
      lastCast.value = { spellNameText: spellName(entry.spell), slot: null, damageTotal: null, healingTotal: null, pending: true };
      return;
    }
    lastCast.value = {
      spellNameText: spellName(entry.spell),
      slot: result.slot,
      damageTotal: result.damageRoll?.total ?? null,
      healingTotal: result.healingRoll?.total ?? null,
    };
    if (result.slot?.pact && spellSlots.pactSlots) {
      spellSlots.pactSlots = { ...spellSlots.pactSlots, current: result.slot.current };
    } else if (result.slot) {
      const index = spellSlots.slots.findIndex(s => s.level === result.slot.level);
      if (index === -1) spellSlots.slots.push(result.slot);
      else spellSlots.slots[index] = result.slot;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось сотворить заклинание. Попробуйте ещё раз.';
  } finally {
    castBusy.value = false;
  }
}

const lastFormulaRoll = ref<FormulaRoll | null>(null);

async function rollDescriptionFormula(entry: CharacterSpellEntry, formula: string) {
  castBusy.value = true;
  error.value = '';

  try {
    const result = await props.request(`/campaigns/${props.campaignId}/rolls`, 'POST', {
      formula,
      label: spellName(entry.spell),
      characterId: props.characterId,
    });
    lastFormulaRoll.value = {
      spellNameText: spellName(entry.spell),
      formula,
      total: result.total,
      detail: result.breakdown?.length ? describeGroups(result.breakdown) : result.dice_results.join(', '),
    };
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось бросить. Попробуйте ещё раз.';
  } finally {
    castBusy.value = false;
  }
}

onMounted(spellSlots.loadSlots);
watch(() => props.characterId, spellSlots.loadSlots);

const caster = useSpellcasting({ props, busy, error });
const casting = toRef(caster, 'casting');
onMounted(caster.loadCasting);
watch(() => props.characterId, caster.loadCasting);

const refMapping = useRefMapping({ props, busy, error, casting, srdLibrary, customLibrary, loadKnown, loadCasting: caster.loadCasting });

const castMenuFor = ref('');
function castOptions(entry: CharacterSpellEntry) {
  const level = entry.spell?.level ?? 0;
  if (level === 0 || entry.slotless) return [];
  const options: CastOption[] = spellSlots.slots
    .filter(slot => slot.level >= level && slot.max > 0)
    .sort((a, b) => a.level - b.level)
    .map(slot => ({ key: `slot:${slot.level}`, label: `Ячейкой ${slot.level} ур. — осталось ${slot.current} из ${slot.max}`, slotLevel: slot.level, disabled: slot.current <= 0 }));
  if (spellSlots.pactSlots && spellSlots.pactSlots.slotLevel >= level) {
    options.push({ key: 'pact', label: `Ячейкой договора (${spellSlots.pactSlots.slotLevel} ур.) — ${spellSlots.pactSlots.current} из ${spellSlots.pactSlots.max}`, pact: true, disabled: spellSlots.pactSlots.current <= 0 });
  }
  return options;
}
function canCastNow(entry: CharacterSpellEntry) {
  const level = entry.spell?.level ?? 0;
  return level === 0 || entry.slotless === true || castOptions(entry).some(option => !option.disabled);
}
const castMenuStyle = ref<Record<string, string>>({});
const castMenuEntry = computed(() => known.value.find(entry => entry.id === castMenuFor.value) ?? null);
function onCastClick(entry: CharacterSpellEntry, event: MouseEvent) {
  const options = castOptions(entry);
  if (!options.length) return castSpell(entry);
  const usable = options.filter(option => !option.disabled);
  if (usable.length === 1) return castSpell(entry, usable[0]!);
  if (castMenuFor.value === entry.id) {
    castMenuFor.value = '';
    return;
  }
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const zoom = cssZoom.value;
  const width = 280 * zoom;
  const height = (options.length * 34 + 14) * zoom;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
  const top = rect.bottom + 4 + height <= window.innerHeight - 8 ? rect.bottom + 4 : Math.max(8, rect.top - 4 - height);
  castMenuStyle.value = { left: `${left / zoom}px`, top: `${top / zoom}px`, ...(zoom === 1 ? {} : { zoom: `${Math.round(zoom * 100)}%` }) };
  castMenuFor.value = entry.id;
}
function closeCastMenu(event: Event) {
  if (!castMenuFor.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest?.('.cast-menu, .cast-wrap')) return;
  castMenuFor.value = '';
}
onMounted(() => {
  document.addEventListener('pointerdown', closeCastMenu, true);
  document.addEventListener('scroll', closeCastMenu, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeCastMenu, true);
  document.removeEventListener('scroll', closeCastMenu, true);
});

const pendingRevisions = ref<Array<{ spellId: string; version: number; submittedByName: string | null }>>([]);
const pendingReview = computed(() => customLibrary.value.filter(s => s.status === 'pending'));
const reviewCount = computed(() => pendingReview.value.length + pendingRevisions.value.length);

onMounted(() => { loadKnown(); loadLibrary(); });
watch(() => props.characterId, loadKnown);

async function addToCharacter(payload: { source: 'srd' | 'custom'; srdIndex?: string; customSpellId?: string }) {
  busy.value = true;
  error.value = '';

  try {
    await props.request(
      `/campaigns/${props.campaignId}/characters/${props.characterId}/spells`,
      'POST',
      { ...payload, prepared: true },
    );
    await loadKnown();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось добавить заклинание. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

async function togglePrepared(entry: CharacterSpellEntry) {
  busy.value = true;
  error.value = '';

  try {
    await props.request(
      `/campaigns/${props.campaignId}/characters/${props.characterId}/spells/${entry.id}`,
      'PATCH',
      { prepared: !entry.prepared },
    );
    await loadKnown();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось изменить заклинание. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

async function removeSpell(entryId: string) {
  busy.value = true;
  error.value = '';

  try {
    await props.request(
      `/campaigns/${props.campaignId}/characters/${props.characterId}/spells/${entryId}`,
      'DELETE',
    );
    await loadKnown();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось убрать заклинание. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

const browser = useSpellBrowser({ props, known, srdLibrary, customLibrary, casting });
async function addItem(item: BrowseItem) {
  if (item.entry || !item.spell) return;
  const payload = item.source === 'srd'
    ? { source: 'srd' as const, srdIndex: (item.spell as SrdSpell).index }
    : { source: 'custom' as const, customSpellId: (item.spell as CampaignSpell).id };
  await addToCharacter(payload);
  const added = known.value.find(entry => (payload.source === 'srd' ? entry.srdIndex === payload.srdIndex : entry.customSpellId === payload.customSpellId));
  if (added) {
    browser.filters.showKnown = true;
    browser.selectedKey = `e:${added.id}`;
  }
}

async function removeItem(item: BrowseItem) {
  if (!item.entry) return;
  const entry = item.entry;
  await removeSpell(entry.id);
  if (entry.source === 'srd') {
    browser.filters.showUnknown = true;
    browser.selectedKey = `srd:${entry.srdIndex}`;
  }
}

const canAdd = (item: BrowseItem) => !item.entry && Boolean(item.spell)
  && !(item.source === 'custom' && (item.spell as CampaignSpell).status !== 'approved' && (item.spell as CampaignSpell).createdBy !== props.currentUserId);

const builder = ref<{ spellId: string | null; seed: { template?: unknown; autoSuggest?: boolean } | null; review: boolean; fresh: boolean; srdIndex?: string } | null>(null);
const srdOverrides = ref<Set<string>>(new Set());
function startSrd(index: string) {
  builder.value = { spellId: null, seed: null, review: false, fresh: false, srdIndex: index };
}
const confirmDelete = ref('');
const artOf = (spell: unknown, school: string) => spellOrSchoolArt(templateArt(spell), school, props.campaignId, props.request);
const myCustom = computed(() => customLibrary.value.filter(spell => canReview.value || spell.createdBy === props.currentUserId));

function canEditCustom(spell: CampaignSpell) {
  return !props.readOnly && (spell.createdBy === props.currentUserId || canReview.value);
}
function startNew() {
  builder.value = { spellId: null, seed: null, review: false, fresh: true };
}
function startEditCustom(spell: CampaignSpell) {
  builder.value = { spellId: spell.id, seed: null, review: false, fresh: false };
}
function startReview(spellId: string) {
  builder.value = { spellId, seed: null, review: true, fresh: false };
}
function startCopy(spell: SrdSpell) {
  builder.value = {
    spellId: null, review: false, fresh: true,
    seed: {
      autoSuggest: true,
      template: { passport: { name: `${spellName(spell)} (своё)`.slice(0, 200), level: spell.level, school: String(spell.school ?? '').toLowerCase(), description: spellDesc(spell), higherLevel: spellHigherLevel(spell) ?? '' } },
    },
  };
}
function dataUrlFile(dataUrl: string): File {
  const [head, body = ''] = dataUrl.split(',');
  const type = /^data:([^;,]+)/.exec(head ?? '')?.[1] ?? 'image/png';
  const bytes = Uint8Array.from(atob(body), char => char.charCodeAt(0));
  return new File([bytes], 'spell-picture', { type });
}
async function importTemplate(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const template = parsed && typeof parsed === 'object' && 'template' in parsed ? parsed.template : parsed;
    if (!template || typeof template !== 'object') throw new Error('В файле нет шаблона заклинания.');
    const passport = (template as { passport?: Record<string, unknown> }).passport;
    if (passport && typeof passport === 'object') {
      const image = typeof parsed.image === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(parsed.image) ? parsed.image as string : '';
      if (image) {
        try {
          passport.art = (await props.request(`/campaigns/${props.campaignId}/assets?kind=object_image`, 'POST', undefined, dataUrlFile(image))).id;
        } catch {
          passport.art = '';
        }
      } else if (typeof passport.art === 'string' && isOwnSpellArt(passport.art)) {
        passport.art = '';
      }
    }
    builder.value = { spellId: null, seed: { template }, review: false, fresh: true };
  } catch (cause) {
    error.value = cause instanceof Error ? `Шаблон не прочитать: ${cause.message}` : 'Шаблон не прочитать.';
  }
}
async function builderSaved(spellId: string) {
  if (builder.value?.srdIndex) {
    await loadLibrary();
    await loadKnown();
    return;
  }
  const fresh = builder.value?.fresh;
  if (builder.value) builder.value = { ...builder.value, spellId, fresh: false };
  await loadLibrary();
  if (fresh && !props.readOnly && !browser.knownCustomIds.has(spellId)) {
    try {
      await addToCharacter({ source: 'custom', customSpellId: spellId });
    } catch {
    }
  }
  await loadKnown();
}
async function deleteCustomSpell(spell: CampaignSpell) {
  if (confirmDelete.value !== spell.id) {
    confirmDelete.value = spell.id;
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await props.request(`/campaigns/${props.campaignId}/spells/${spell.id}`, 'DELETE');
    confirmDelete.value = '';
    await loadLibrary();
    await loadKnown();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось удалить заклинание. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="spells-panel" @input.stop @change.stop>
    <Teleport to="body">
      <div v-if="castMenuEntry" class="cast-menu" :style="castMenuStyle" role="menu" :aria-label="`Сотворить: ${spellName(castMenuEntry.spell)}`">
        <button
          v-for="option in castOptions(castMenuEntry)" :key="option.key" type="button" role="menuitem" :disabled="option.disabled || castBusy"
          @click="castSpell(castMenuEntry, option)"
        >{{ option.label }}</button>
      </div>
    </Teleport>
    <p v-if="error" class="notice error" role="alert">{{ error }}</p>

    <header class="magic-head">
      <h3 class="magic-title">Магия</h3>
      <nav class="spell-sections" aria-label="Разделы заклинаний">
        <button type="button" :aria-pressed="section === 'browse'" @click="section = 'browse'"><GameIcon class="inline-icon" name="spellbook" :size="16" /> Заклинания ({{ known.length }})</button>
        <template v-if="!readOnly">
          <button type="button" :aria-pressed="section === 'custom'" @click="section = 'custom'"><GameIcon class="inline-icon" name="sparkle" :size="16" /> Своё заклинание</button>
          <button v-if="canReview" type="button" :aria-pressed="section === 'review'" @click="section = 'review'">Заявки ({{ reviewCount }})</button>
        </template>
      </nav>
    </header>

    <template v-if="section === 'browse'">
      <CasterBar :caster="caster" :spell-slots="spellSlots" :read-only="readOnly" :busy="busy" />

      <PendingRefs v-if="casting?.pending.length && !readOnly" :mapping="refMapping" :pending="casting.pending" :busy="busy" />

      <div class="spell-browser">
        <SpellFilters :browser="browser" :read-only="readOnly" />
        <SpellList :browser="browser" :read-only="readOnly" :busy="busy" :known-count="known.length" :slot-for="spellSlots.slotFor" :art-of="artOf" />
        <SpellCard
          :selected="browser.selected" :read-only="readOnly" :busy="busy" :cast-busy="castBusy"
          :campaign-id="campaignId" :character-id="characterId" :request="request" :campaign-members="campaignMembers"
          :can-review="canReview" :srd-overrides="srdOverrides" :cast-menu-for="castMenuFor"
          :last-cast="lastCast" :last-formula-roll="lastFormulaRoll" :mechanics-for="mechanicsFor"
          :art-of="artOf" :slot-for="spellSlots.slotFor" :is-favorite="browser.isFavorite" :visibility-for="visibilityFor"
          :can-add="canAdd" :can-edit-custom="canEditCustom" :can-cast-now="canCastNow" :cast-options="castOptions" :overrides-of="overridesOf"
          @cast="onCastClick" @toggle-prepared="togglePrepared" @roll-formula="rollDescriptionFormula"
          @edit-mechanics="entryId => mechanicsFor = entryId" @save-mechanics="saveMechanics"
          @visibility-change="(fieldKey, setting) => emit('visibilityChange', fieldKey, setting)"
          @add="addItem" @remove="removeItem" @edit-custom="startEditCustom" @copy-srd="startCopy" @open-srd="startSrd"
        />
      </div>
    </template>

    <section v-if="section === 'custom' && !readOnly" class="custom-spell" aria-label="Своё заклинание">
      <p class="muted">Своё заклинание собирается из таблицы действий — описание только подсказывает поля. {{ canReview ? 'Ваши заклинания сразу доступны кампании.' : 'Готовое уходит мастеру на рассмотрение.' }}</p>
      <div class="custom-actions">
        <button type="button" class="primary" :disabled="busy" @click="startNew">＋ Новое заклинание</button>
        <label class="file-button" title="Файл .spell.json — «Скачать шаблон» в окне заклинания"><GameIcon class="inline-icon" name="upload" :size="16" /> Загрузить шаблон
          <input type="file" accept=".json,application/json" :disabled="busy" @change="importTemplate" />
        </label>
      </div>
      <p v-if="!myCustom.length" class="muted">Своих заклинаний пока нет.</p>
      <ul v-else class="custom-list own">
        <li v-for="spell in myCustom" :key="spell.id">
          <ItemArt :src="artOf(spell, spell.school)" :size="44" :fallback-icon="schoolIcon(spell.school)" />
          <span class="own-text">
            <span class="custom-name" translate="no">{{ spell.name }}</span>
            <small class="muted">{{ spell.level === 0 ? 'заговор' : `${spell.level} круг` }} · {{ STATUS_LABEL[spell.status] ?? spell.status }}{{ spell.template ? '' : ' · без таблицы' }}</small>
          </span>
          <span class="own-actions">
            <button type="button" :disabled="busy" @click="startEditCustom(spell)">Открыть</button>
            <button type="button" class="danger-link" :disabled="busy" @click="deleteCustomSpell(spell)">{{ confirmDelete === spell.id ? 'Точно удалить? Пропадёт и из листов' : 'Удалить' }}</button>
          </span>
        </li>
      </ul>
    </section>

    <template v-if="section === 'review' && canReview && !readOnly">
      <p v-if="!reviewCount" class="muted">Заявок пока нет.</p>
      <ul v-if="pendingRevisions.length" class="custom-list">
        <li v-for="revision in pendingRevisions" :key="revision.spellId + revision.version">
          <span class="custom-name" translate="no">{{ customLibrary.find(spell => spell.id === revision.spellId)?.name ?? 'заклинание' }}</span>
          <small class="muted">новая версия {{ revision.version }}<template v-if="revision.submittedByName"> · <span translate="no">{{ revision.submittedByName }}</span></template></small>
          <button type="button" class="primary" :disabled="busy" @click="startReview(revision.spellId)">Рассмотреть</button>
        </li>
      </ul>
      <div v-if="pendingReview.length" class="item-card-grid">
        <ItemCard
          v-for="spell in pendingReview"
          :key="spell.id"
          :icon="schoolIcon(spell.school)"
          :art="artOf(spell, spell.school)"
          :title="spell.name"
          :tags="[spell.level === 0 ? 'заговор' : `${spell.level} ур.`, schoolLabel(spell.school)]"
        >
          <p class="spell-facts"><span v-for="(fact, index) in spellFacts(spell)" :key="fact.icon"><template v-if="index"> · </template><GameIcon class="inline-icon" :name="fact.icon" :size="13" /> {{ fact.text }}</span></p>
          <p>{{ spell.desc }}</p>
          <template #footer>
            <button type="button" class="primary" :disabled="busy" @click="startReview(spell.id)">Рассмотреть</button>
          </template>
        </ItemCard>
      </div>
    </template>
    <Teleport to="body">
      <SpellBuilder
        v-if="builder" :key="builder.srdIndex ?? builder.spellId ?? 'new'" :campaign-id="campaignId" :request="request" :can-review="canReview"
        :spell-id="builder.spellId" :seed="builder.seed" :review="builder.review" :srd-index="builder.srdIndex ?? null"
        @close="builder = null" @saved="builderSaved"
      />
    </Teleport>
  </div>
</template>

<style scoped src="./spellsKit.css"></style>
<style scoped>
.custom-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.file-button{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border:1px solid var(--brass-light);border-radius:6px;cursor:pointer}
.file-button input{display:none}
.custom-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.custom-list li{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:6px 8px;border:1px solid var(--brass-light);border-radius:6px}
.custom-name{font-weight:700}
.custom-list.own li{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:10px}
:root[data-ui="game"] .custom-list.own{gap:10px}
:root[data-ui="game"] .custom-list.own>li{gap:14px;min-height:64px;padding:10px 12px;border-color:var(--g-gold-deep);border-left:4px solid var(--g-gold-lo);background:var(--g-stone-3);box-shadow:inset 0 1px 0 #ffffff08}
:root[data-ui="game"] .custom-list.own .own-text{flex-direction:column;align-items:flex-start;gap:4px}
:root[data-ui="game"] .custom-list.own .custom-name{font-family:var(--g-title-font);font-size:17px;color:var(--g-gold-hi)}
:root[data-ui="game"] .custom-list.own>li:focus-within{border-color:var(--g-gold)}
.own-text{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline;min-width:0}
.own-text .custom-name{overflow-wrap:anywhere}
.own-actions{display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap}
@media (max-width:560px){.custom-list.own li{grid-template-columns:44px minmax(0,1fr)}.own-actions{grid-column:1/-1}}
.spells-panel{display:flex;flex-direction:column;gap:10px;container-type:inline-size}
.spell-sections{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--brass-light)}
.spell-sections button{min-height:32px;padding:4px 12px;font-size:13px}
.spell-sections button[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text)}
.item-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:12px;align-items:start}
.spell-facts{font-size:12px;font-weight:600;margin:0 0 4px}
.notice.error{margin:0}
.cast-menu{position:fixed;z-index:5000;display:flex;flex-direction:column;gap:3px;width:280px;padding:6px;border:1px solid var(--brass,#c9a227);border-radius:4px;background:var(--parchment-background,#241c15);color:var(--ink);box-shadow:0 8px 22px #0008}
.cast-menu button{justify-content:flex-start;text-align:left;min-height:30px;padding:2px 10px;font-size:13px}

.magic-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:flex-start}
.magic-head .spell-sections{border-bottom:0;padding-bottom:0}
.magic-title{margin:0;font:700 18px var(--heading-font)}

.spell-browser{display:grid;grid-template-columns:minmax(210px,250px) minmax(0,1fr) minmax(0,1.12fr);gap:12px;align-items:start}
.spell-pane{display:flex;flex-direction:column;gap:10px;min-width:0;padding:12px;border:1px solid var(--brass-light);border-radius:10px;background:var(--surface-inset)}
.spell-filters{position:sticky;top:0}

.spell-card-pane{position:sticky;top:0;max-height:min(80vh,900px);overflow-y:auto;gap:12px}

@container (max-width: 980px){
  .spell-browser{grid-template-columns:minmax(0,1fr) minmax(0,1.1fr)}
  .spell-filters{grid-column:1 / -1;position:static;display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));align-items:start}
}
@container (max-width: 640px){
  .spell-browser{grid-template-columns:minmax(0,1fr)}
  .spell-card-pane{position:static;max-height:none}
}
.spells-panel :deep(.item-card){border-color:var(--brass-light);background:transparent}
.spells-panel :deep(.item-card-head){flex-wrap:wrap}
.spells-panel :deep(.item-card-tags){white-space:normal;flex-basis:100%;padding-left:42px;line-height:1.5}
.spells-panel :deep(.item-card-body){padding:0 12px 12px}
.spells-panel :deep(.item-card-footer){gap:10px;align-items:center}
.spells-panel :deep(.item-card-footer label){margin:0}
@media(max-width:480px){.spell-sections button{flex:1 1 120px}}
</style>
