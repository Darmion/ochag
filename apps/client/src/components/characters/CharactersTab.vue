<script setup lang="ts">
import { confirmAction } from '../../ui/confirmDialog';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { protectNames } from '../../i18n/domTranslate';
import { onCampaignEvent } from '../../campaign/campaignEvents';
import { ensureCampaignMembers, type CampaignMember } from '../../campaign/members';
import { KIND_GROUP_LABELS, OBJECT_KINDS, SIZE_LABELS, kindBadge, type CampaignObject, type ObjectKind } from '../../campaign/objects';
import CreateObjectModal from '../objects/CreateObjectModal.vue';
import CharacterWizard from './CharacterWizard.vue';
import BestiaryModal from '../rules/BestiaryModal.vue';
import { cropStyle } from '../../art/imageCrop';
import { artImageUrl, isArtImageId, objectImageId } from '../../art/portraitArt';
import type { SheetImporterInfo } from '../../characterImport/types';
import { modText } from '../../settings/modText';

type AccessGrant = { user_id: string; level: 'denied' | 'edit'; display_name: string };

const props = defineProps<{
  campaignId: string;
  currentUserId: string;
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
  token?: string;
  importers?: SheetImporterInfo[];
}>();

const emit = defineEmits<{ 'open-character-sheet': [characterId: string]; 'import-file': [importerId: string, file: File] }>();

const sheetInput = ref<HTMLInputElement | null>(null);
const sheetImporter = ref<SheetImporterInfo | null>(null);
function pickSheet(importer: SheetImporterInfo) {
  sheetImporter.value = importer;
  sheetInput.value?.click();
}
function onSheetFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file && sheetImporter.value) emit('import-file', sheetImporter.value.id, file);
}

const busy = ref(false);
const error = ref('');
const characters = ref<CampaignObject[]>([]);
watch(() => characters.value.filter(character => character.kind !== 'object').map(character => character.name).join('\n'), names => protectNames('party', names.split('\n')), { immediate: true });

const portraits = reactive<Record<string, string>>({});

function portraitUrl(character: CampaignObject): string | null {
  const assetId = objectImageId(character);
  if (!assetId) return null;
  if (isArtImageId(assetId)) return artImageUrl(assetId);
  if (!(assetId in portraits)) {
    portraits[assetId] = '';
    void props.request(`/campaigns/${props.campaignId}/assets/${assetId}`)
      .then((blob: Blob) => { portraits[assetId] = URL.createObjectURL(blob); })
      .catch(() => {});
  }
  return portraits[assetId] || null;
}

function rosterSide(character: CampaignObject) {
  if (character.kind === 'object') return 'object';
  if (character.kind === 'npc') return character.disposition ?? 'neutral';
  return character.owner_user_id === props.currentUserId ? 'mine' : 'party';
}

onBeforeUnmount(() => {
  for (const url of Object.values(portraits)) if (url) URL.revokeObjectURL(url);
});
const canManage = ref(false);
const members = ref<CampaignMember[]>([]);
// undefined — not fetched yet; null — fetched, but this viewer may not manage access (403).
const grantsByCharacter = ref<Record<string, AccessGrant[] | null | undefined>>({});
const expandedCharacterId = ref('');
const createOpen = ref(false);
const wizardOpen = ref(false);
const bestiaryOpen = ref(false);
const filter = ref<ObjectKind | 'all'>('all');

const groups = computed(() => OBJECT_KINDS
  .filter(kind => filter.value === 'all' || filter.value === kind)
  .map(kind => ({ kind, label: KIND_GROUP_LABELS[kind], items: characters.value.filter(c => c.kind === kind) }))
  .filter(group => group.items.length || filter.value === group.kind));

const counts = computed(() => Object.fromEntries(
  OBJECT_KINDS.map(kind => [kind, characters.value.filter(c => c.kind === kind).length]),
) as Record<ObjectKind, number>);

const fileMessage = ref('');
const canUseFiles = computed(() => Boolean(window.desktop?.campaign?.exportObject && props.token));

async function exportObject(character: CampaignObject) {
  if (!window.desktop || !props.token) return;
  fileMessage.value = '';
  const result = await window.desktop.campaign.exportObject({ campaignId: props.campaignId, characterId: character.id, name: character.name, token: props.token });
  if ('canceled' in result) return;
  if (result.ok) fileMessage.value = `«${character.name}» сохранён в файл: ${result.filePath}. Загрузите его в другой кампании кнопкой «Загрузить из файла».`;
  else error.value = result.message;
}

async function importObject() {
  if (!window.desktop || !props.token) return;
  fileMessage.value = '';
  error.value = '';
  const result = await window.desktop.campaign.importObject({ campaignId: props.campaignId, token: props.token });
  if ('canceled' in result) return;
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  fileMessage.value = `Загружен «${result.name}» из ${result.fileName}: теперь он в этой кампании — поставьте его на сцену в окне «Объекты».`;
  await load();
}

async function load() {
  busy.value = true;
  error.value = '';

  try {
    const [charData, memberList] = await Promise.all([
      props.request(`/campaigns/${props.campaignId}/characters`),
      ensureCampaignMembers(props.request, props.campaignId),
    ]);
    characters.value = charData.characters;
    canManage.value = charData.canManage === true;
    members.value = memberList;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить список объектов. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

onMounted(load);

const stopEvents = [onCampaignEvent('characters', () => void load()), onCampaignEvent('character', () => void load())];
onBeforeUnmount(() => stopEvents.forEach(stop => stop()));

async function toggleManage(characterId: string) {
  if (expandedCharacterId.value === characterId) {
    expandedCharacterId.value = '';
    return;
  }

  expandedCharacterId.value = characterId;
  if (grantsByCharacter.value[characterId] !== undefined) return;

  try {
    const data = await props.request(`/campaigns/${props.campaignId}/characters/${characterId}/access`);
    grantsByCharacter.value = {
      ...grantsByCharacter.value,
      [characterId]: data.grants.map((g: any) => ({ user_id: g.user_id, level: g.level, display_name: g.display_name })),
    };
  } catch {
    grantsByCharacter.value = { ...grantsByCharacter.value, [characterId]: null };
  }
}

function levelFor(characterId: string, userId: string): 'view' | 'denied' | 'edit' {
  const grants = grantsByCharacter.value[characterId];
  return grants?.find(g => g.user_id === userId)?.level ?? 'view';
}

async function setLevel(characterId: string, userId: string, level: 'view' | 'denied' | 'edit') {
  busy.value = true;
  error.value = '';

  try {
    await props.request(`/campaigns/${props.campaignId}/characters/${characterId}/access/${userId}`, 'PUT', { level });
    const data = await props.request(`/campaigns/${props.campaignId}/characters/${characterId}/access`);
    grantsByCharacter.value = {
      ...grantsByCharacter.value,
      [characterId]: data.grants.map((g: any) => ({ user_id: g.user_id, level: g.level, display_name: g.display_name })),
    };
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось изменить доступ. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

async function deleteCharacter(character: CampaignObject) {
  if (!(await confirmAction(`Удалить «${character.name}» целиком — вместе с листом и со всех сцен? Отменить это нельзя.`, { title: 'Удалить', confirmLabel: 'Удалить', danger: true }))) return;

  busy.value = true;
  error.value = '';

  try {
    await props.request(`/campaigns/${props.campaignId}/characters/${character.id}`, 'DELETE');
    characters.value = characters.value.filter(c => c.id !== character.id);
    if (expandedCharacterId.value === character.id) expandedCharacterId.value = '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось удалить объект. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

function otherMembers(character: CampaignObject): CampaignMember[] {
  return members.value.filter(m => m.userId !== character.owner_user_id && m.userId !== props.currentUserId);
}

function ownerText(character: CampaignObject) {
  if (character.owner_display_name) return character.owner_display_name;
  return character.kind === 'character' ? 'без владельца' : 'мастер';
}

async function onCreated(payload: { character: CampaignObject }) {
  createOpen.value = false;
  await load();
  emit('open-character-sheet', payload.character.id);
}

async function onBestiaryCreated(created: Array<{ id: string; name: string }>) {
  bestiaryOpen.value = false;
  await load();
  if (created.length === 1) emit('open-character-sheet', created[0].id);
}

async function onWizardCreated(character: { id: string; name: string }) {
  wizardOpen.value = false;
  await load();
  emit('open-character-sheet', character.id);
}
</script>

<template>
  <section class="characters-tab panel is-game">
    <div class="tab-header">
      <div>
        <h2>Отряд и объекты</h2>
        <p class="muted">
          Персонажи игроков, НПС и неодушевлённые объекты — всё, что можно
          поставить на стол. Скрытые от вас объекты в списке не появляются.
        </p>
      </div>
      <div class="tab-header-actions">
        <button v-if="canUseFiles" type="button" :disabled="busy" title="Объект из файла .ochag-object — скачанный в другой кампании" @click="importObject">Загрузить из файла…</button>
        <button
          v-for="importer in importers ?? []" :key="importer.id" type="button" :disabled="busy"
          :title="`${modText(importer, 'description', importer.description)}: сначала предпросмотр, потом сохранение в этой кампании`" @click="pickSheet(importer)"
        >Из <span translate="no">{{ modText(importer, 'name', importer.name) }}</span>…</button>
        <input ref="sheetInput" type="file" :accept="sheetImporter?.extensions.join(',') || '.json'" hidden @change="onSheetFile" />
        <button type="button" class="primary" :disabled="busy" @click="createOpen = true">Создать…</button>
      </div>
    </div>
    <p v-if="fileMessage" class="notice success" role="status">{{ fileMessage }}</p>

    <nav class="kind-filter" aria-label="Показывать">
      <button type="button" :aria-pressed="filter === 'all'" @click="filter = 'all'">Все ({{ characters.length }})</button>
      <button v-for="kind in OBJECT_KINDS" :key="kind" type="button" :aria-pressed="filter === kind" @click="filter = kind">
        {{ KIND_GROUP_LABELS[kind] }} ({{ counts[kind] }})
      </button>
    </nav>

    <p v-if="error" class="notice error" role="alert">{{ error }}</p>
    <p v-if="busy && !characters.length" class="muted">Загрузка…</p>

    <section v-for="group in groups" :key="group.kind" class="roster-group">
      <h3>{{ group.label }}</h3>

      <ul class="roster-list">
        <li v-for="character in group.items" :key="character.id">
          <div class="roster-row">
            <span class="roster-portrait" :class="`side-${rosterSide(character)}`" aria-hidden="true">
              <img v-if="portraitUrl(character)" :src="portraitUrl(character)!" alt="" :style="character.image_asset_id ? cropStyle(character.image_crop) : {}" />
              <span v-else translate="no">{{ character.name.slice(0, 1) }}</span>
            </span>
            <span class="roster-name">
              {{ character.name }}
              <span class="muted">
                {{ kindBadge(character) }}, {{ SIZE_LABELS[character.size].toLowerCase() }} · {{ ownerText(character) }}{{ character.container_name ? ` · лежит в «${character.container_name}»` : '' }}
              </span>
            </span>
            <span class="roster-actions">
              <button type="button" class="primary" @click="emit('open-character-sheet', character.id)">Открыть лист</button>
              <button type="button" :disabled="busy" :aria-pressed="expandedCharacterId === character.id" @click="toggleManage(character.id)">
                {{ expandedCharacterId === character.id ? 'Скрыть доступ' : 'Доступ' }}
              </button>
              <button
                v-if="canUseFiles && character.can_control" type="button" :disabled="busy"
                title="Скачать объект в файл — чтобы загрузить в другую кампанию" @click="exportObject(character)"
              >В файл</button>
              <button v-if="character.can_delete" type="button" class="danger" :disabled="busy" title="Удалить объект" @click="deleteCharacter(character)">
                Удалить
              </button>
            </span>
          </div>

          <div v-if="expandedCharacterId === character.id" class="access-panel">
            <p v-if="grantsByCharacter[character.id] === null" class="muted">
              У вас нет прав менять доступ к этому объекту — это может владелец или мастер.
            </p>
            <template v-else-if="grantsByCharacter[character.id] !== undefined">
              <p class="muted">
                Владелец и мастер видят и правят объект всегда. «Редактирование» даёт
                и правку листа, и управление объектом на столе.
              </p>
              <div v-for="member in otherMembers(character)" :key="member.userId" class="access-row">
                <span>{{ member.displayName }}</span>
                <select
                  :value="levelFor(character.id, member.userId)"
                  :disabled="busy"
                  @change="setLevel(character.id, member.userId, ($event.target as HTMLSelectElement).value as any)"
                >
                  <option value="view">Просмотр (по умолчанию)</option>
                  <option value="denied">Нет доступа</option>
                  <option value="edit">Редактирование</option>
                </select>
              </div>
              <p v-if="!otherMembers(character).length" class="muted">В кампании больше никого нет.</p>
            </template>
          </div>
        </li>
        <li v-if="!group.items.length" class="muted">Пока нет.</li>
      </ul>
    </section>

    <p v-if="!busy && !characters.length" class="muted">
      Объектов пока нет — создайте персонажа, НПС или предмет кнопкой «Создать…»
      или импортируйте лист персонажа из JSON.
    </p>

    <CreateObjectModal
      v-if="createOpen"
      :campaign-id="campaignId"
      :can-manage="canManage"
      :request="request"
      @close="createOpen = false"
      @created="onCreated"
      @wizard="createOpen = false; wizardOpen = true"
      @bestiary="createOpen = false; bestiaryOpen = true"
    />
    <BestiaryModal
      v-if="bestiaryOpen"
      :campaign-id="campaignId"
      :can-place="false"
      :request="request"
      @close="bestiaryOpen = false"
      @created="onBestiaryCreated"
      @saved="bestiaryOpen = false"
    />
    <CharacterWizard v-if="wizardOpen" :campaign-id="campaignId" :request="request" @close="wizardOpen = false" @created="onWizardCreated" />
  </section>
</template>

<style scoped>
.tab-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.tab-header-actions{display:flex;gap:8px;flex-wrap:wrap}
.tab-header h2{margin-bottom:8px}
.kind-filter{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}
.kind-filter button{min-height:32px;padding:4px 10px;font-size:13px}
.kind-filter button[aria-pressed="true"]{background:var(--burgundy);color:var(--burgundy-text)}
.roster-group h3{margin:18px 0 4px;font-size:18px}
.roster-list{list-style:none;padding:0;margin:0}
.roster-list > li{border-bottom:1px solid var(--brass-light);padding:10px 0}
.roster-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.roster-name{flex:1 1 220px;min-width:0}
.roster-actions{display:flex;flex-wrap:wrap;gap:6px}
.access-panel{margin:10px 0 4px;padding:12px;border:1px solid var(--brass-light);border-radius:3px}
.access-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 0}
.access-row select{width:auto}
.danger{color:#8e2a2f;border-color:#8e2a2f}
.is-game{max-width:1320px;margin:0 auto}
.is-game .roster-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px;margin-top:8px}
.is-game .roster-list > li{border:0;padding:12px;min-width:0;border-radius:5px;background:linear-gradient(180deg,#ffffff08,#0000),#0005;box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-deep)}
.is-game .roster-list > li.muted{background:none;box-shadow:none}
.is-game .roster-row{display:grid;grid-template-columns:72px minmax(0,1fr);grid-template-rows:1fr auto;column-gap:14px;row-gap:10px;align-items:start}
.is-game .roster-portrait{grid-row:1/3;grid-column:1;display:grid;place-items:center;width:72px;height:88px;overflow:hidden;border-radius:4px;font:400 34px var(--g-title-font);color:var(--g-gold-hi);background:radial-gradient(circle at 50% 35%,var(--g-stone-1),var(--g-stone-3));box-shadow:inset 0 0 0 1px #000,0 0 0 1px var(--g-gold-hi),0 0 0 3px var(--g-gold),0 0 0 4px #000}
.is-game .roster-portrait img{width:100%;height:100%;object-fit:cover;object-position:top}
.is-game .roster-portrait.side-mine{background:radial-gradient(circle at 50% 35%,#3a6b51,#0f2219)}
.is-game .roster-portrait.side-party{background:radial-gradient(circle at 50% 35%,#3b5384,#0e1628)}
.is-game .roster-portrait.side-hostile{background:radial-gradient(circle at 50% 35%,#7a2b28,#250a09)}
.is-game .roster-portrait.side-neutral{background:radial-gradient(circle at 50% 35%,#7a6430,#241b0a)}
.is-game .roster-portrait.side-friendly{background:radial-gradient(circle at 50% 35%,#2b6e6a,#0a2423)}
.is-game .roster-name{grid-column:2;grid-row:1;font:600 17px var(--g-title-font);color:var(--g-gold-hi);overflow-wrap:anywhere}
.is-game .roster-name .muted{display:block;margin-top:3px;font:400 13px/1.35 var(--g-body-font);color:var(--g-text-dim)}
.is-game .roster-actions{grid-column:2;grid-row:2}
.is-game .roster-actions button{min-height:30px;padding:3px 10px;font-size:12px}
.is-game .access-panel{margin:12px 0 0}
.is-game .access-row{flex-wrap:wrap}
.is-game .access-row select{max-width:100%}
.is-game .danger{color:#ff9c8c}
</style>
