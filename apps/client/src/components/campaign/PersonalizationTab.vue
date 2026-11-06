<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue';

import { confirmAction } from '../../ui/confirmDialog';
import { NO_ART } from '../../art/itemArt';
import { artLibraryGroups } from '../../art/artPacks';
import { artPrefs, artStorage, removeUpload, resetAllArt, resetArt, setArt, setNoArt } from '../../art/artPersonalization';
import { campaignArt, deleteCampaignSprite, resetCampaignArt, setCampaignArt } from '../../art/campaignArt';
import type { ElementSources, LibraryGroup } from '../../personalization/catalog';
import { useArtElements } from '../../personalization/elements';
import { usePictureLibrary } from '../../personalization/pictureLibrary';
import { useSpriteUpload } from '../../personalization/spriteUpload';
import PersonalizationElementCard from './PersonalizationElementCard.vue';
import PersonalizationElements from './PersonalizationElements.vue';
import PersonalizationLibrary from './PersonalizationLibrary.vue';
import PersonalizationSpriteSheet from './PersonalizationSpriteSheet.vue';

const props = defineProps<{
  request: (path: string, method?: string, body?: unknown, file?: File) => Promise<any>;
  campaignId: string;
  campaignName: string;
}>();

const weapons = ref<ElementSources['weapons']>([]);
const gear = ref<ElementSources['gear']>([]);
const magic = ref<ElementSources['magic']>([]);
const library = ref<LibraryGroup[]>([]);
const loadError = ref('');
const loading = ref(true);

onMounted(async () => {
  const [libraryModule, weaponList, gearList, magicList] = await Promise.allSettled([
    artLibraryGroups(), props.request('/srd/weapons'), props.request('/srd/gear'), props.request('/srd/magic-items'),
  ]);
  if (libraryModule.status === 'fulfilled') library.value = libraryModule.value;
  if (weaponList.status === 'fulfilled') weapons.value = weaponList.value.weapons ?? [];
  if (gearList.status === 'fulfilled') gear.value = gearList.value.gear ?? [];
  if (magicList.status === 'fulfilled') magic.value = magicList.value.items ?? [];
  if ([weaponList, gearList, magicList].some(result => result.status === 'rejected')) {
    loadError.value = 'Часть справочника не загрузилась — показано то, что есть. Свои названия можно добавить внизу списка.';
  }
  loading.value = false;
});

const scope = ref<'mine' | 'all'>('mine');
const campaignReady = computed(() => Boolean(props.campaignId) && campaignArt.campaignId === props.campaignId && campaignArt.loaded);
const canEditAll = computed(() => campaignReady.value && campaignArt.canManage);
watch(canEditAll, value => { if (!value) scope.value = 'mine'; });
const forAll = computed(() => scope.value === 'all' && canEditAll.value);
const layer = computed<Record<string, string>>(() => (forAll.value ? campaignArt.overrides : artPrefs.overrides));

const busy = ref(false);
const notice = ref('');
const actionError = ref('');

const elements = useArtElements({
  weapons, gear, magic, forAll, layer, campaignReady, notice,
  onSelect: element => {
    pictures.pictureSection = element.kind === 'rarity' ? 'ui/frames' : element.section;
    pictures.pictureQuery = '';
    notice.value = '';
    cancelSheet();
  },
});
const selected = toRef(elements, 'selected');

async function change(action: () => void | Promise<void>, done: string) {
  if (busy.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    await action();
    notice.value = done;
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : 'Не получилось.';
  } finally {
    busy.value = false;
  }
}
function choose(value: string, label: string) {
  const element = selected.value;
  if (!element) return;
  void change(() => (forAll.value ? setCampaignArt(element.key, value) : setArt(element.key, value)),
    `«${element.name}» — теперь «${label}»${forAll.value ? ' у всех' : ''}.`);
}
function chooseNone() {
  const element = selected.value;
  if (!element) return;
  void change(() => (forAll.value ? setCampaignArt(element.key, NO_ART) : setNoArt(element.key)),
    `«${element.name}» — без картинки${forAll.value ? ' у всех' : ''} (останется значок).`);
}
function chooseDefault() {
  const element = selected.value;
  if (!element) return;
  const fallback = !forAll.value && campaignArt.overrides[element.key] !== undefined ? 'как у всех в кампании' : 'исходная картинка';
  void change(() => (forAll.value ? setCampaignArt(element.key, null) : resetArt(element.key)), `«${element.name}» — снова ${fallback}.`);
}

async function resetEverything() {
  if (!elements.counts.changed) return;
  const ok = await confirmAction(forAll.value
    ? `Вернуть все ${elements.counts.changed} картинок кампании «${props.campaignName}» к исходным — у всех участников? Спрайты кампании останутся.`
    : `Вернуть все ${elements.counts.changed} выбранных картинок к исходным? Свои загруженные картинки останутся в «Моих картинках».`, {
    title: forAll.value ? 'Сбросить вид для всех' : 'Сбросить мой вид', confirmLabel: 'Сбросить', danger: true,
  });
  if (ok) void change(() => (forAll.value ? resetCampaignArt() : resetAllArt()), 'Сброшено.');
}

const pictures = usePictureLibrary({ library, forAll, notice });

async function deleteOwn(picture: { id: string; label: string; value: string }) {
  const users = Object.values(layer.value).filter(value => value === picture.value).length;
  const where = forAll.value ? 'у всех участников' : '';
  const ok = await confirmAction(users
    ? `Удалить «${picture.label}»? Её используют ${users} — они вернутся к исходным ${where}.`
    : `Удалить «${picture.label}»?`, { title: forAll.value ? 'Удалить спрайт кампании' : 'Удалить картинку', confirmLabel: 'Удалить', danger: true });
  if (ok) void change(() => (forAll.value ? deleteCampaignSprite(picture.id) : removeUpload(picture.id)), `«${picture.label}» удалена.`);
}

const { sheet, sheetGrid, cancelSheet, onFile, addWhole, addPictures } = useSpriteUpload({
  selected, forAll, busy, notice, actionError, pictures,
});

watch(() => elements.filter, () => { notice.value = ''; });
</script>

<template>
  <section class="personalization panel">
    <header class="pz-head">
      <div>
        <h2>Облик</h2>
        <p class="muted">
          Свои картинки для оружия, вещей, магических предметов, школ магии и рамок редкости. Выберите элемент слева —
          справа откроется библиотека; можно загрузить свой спрайт или целый лист спрайтов.
        </p>
      </div>
      <div class="pz-head-actions">
        <span class="muted">Изменено: <b>{{ elements.counts.changed }}</b> · без картинки: <b>{{ elements.counts.missing }}</b> из {{ elements.counts.all }}</span>
        <button type="button" :disabled="!elements.counts.changed || busy" @click="resetEverything">Сбросить всё</button>
      </div>
    </header>

    <div class="pz-scope" role="group" aria-label="Чей вид меняем">
      <button type="button" :aria-pressed="!forAll" @click="scope = 'mine'">Мой вид</button>
      <button
        type="button" :aria-pressed="forAll" :disabled="!canEditAll"
        :title="!campaignId ? 'Выберите кампанию' : canEditAll ? '' : 'Вид для всех задаёт мастер кампании'"
        @click="scope = 'all'"
      >Для всех{{ campaignId ? ` · «${campaignName}»` : '' }}</button>
      <p class="muted pz-scope-hint">
        <template v-if="forAll">Картинки увидят все участники кампании «{{ campaignName }}» — у кого выбрана своя, у того своя.</template>
        <template v-else-if="campaignReady && Object.keys(campaignArt.overrides).length">
          Мастер задал {{ Object.keys(campaignArt.overrides).length }} картинок для всех (метка «от мастера»); ваш выбор важнее и хранится на этом компьютере.
        </template>
        <template v-else>Ваш выбор хранится на этом компьютере, другим игрокам не виден.<template v-if="campaignId && !canEditAll"> Вид для всех задаёт мастер.</template></template>
      </p>
    </div>
    <p v-if="loadError" class="notice" role="status">{{ loadError }}</p>
    <p v-if="artStorage.error && !forAll" class="notice error" role="alert">{{ artStorage.error }}</p>
    <p v-if="actionError" class="notice error" role="alert">{{ actionError }}</p>

    <div class="pz-layout">
      <PersonalizationElements :elements="elements" :loading="loading" />

      <section class="pz-picker" aria-label="Выбор картинки">
        <template v-if="selected">
          <PersonalizationElementCard
            :elements="elements" :selected="selected" :current="layer[selected.key]" :for-all="forAll" :busy="busy" :notice="notice"
            @default="chooseDefault" @none="chooseNone" @file="onFile"
          />

          <PersonalizationSpriteSheet
            v-if="sheet.image" :sheet="sheet" :image="sheet.image" :sheet-grid="sheetGrid" :busy="busy" :for-all="forAll"
            @cut="addPictures(sheet.cells, sheet.name, false)" @whole="addWhole" @cancel="cancelSheet"
          />

          <PersonalizationLibrary :pictures="pictures" :busy="busy" :current="layer[selected.key]" @choose="choose" @delete="deleteOwn" />
        </template>
        <div v-else class="pz-empty">
          <p>Выберите элемент слева — здесь откроется библиотека: {{ library.reduce((sum, group) => sum + group.items.length, 0) }} картинок по разделам, поиск и загрузка своего спрайта.</p>
          <p class="muted">Подсказка: фильтр «Без картинки» покажет всё, что пока со значком, — например доспехи и булаву.</p>
          <p v-if="canEditAll" class="muted">Вы мастер кампании «{{ campaignName }}»: «Для всех» вверху — и выбранные картинки увидят все участники.</p>
        </div>
      </section>
    </div>

    <p class="muted pz-credits">
      Картинки библиотеки — «RPG Essentials: Ultimate Fantasy Icons &amp; GUI Pack», автор helloiamsinan (itch.io), с разрешения автора; наборы картинок из окна «Моды» — по их описанию; все авторы — «?» → «Авторы и благодарности».
    </p>
  </section>
</template>

<style scoped>
.personalization{display:flex;flex-direction:column;gap:12px}
.pz-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
.pz-head h2{margin:0 0 4px}
.pz-head p{margin:0;max-width:760px}
.pz-head-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pz-scope{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.pz-scope button{min-height:34px;padding:3px 14px}
.pz-scope-hint{margin:0 0 0 6px;font-size:12px;flex:1 1 260px}
.pz-layout{display:grid;grid-template-columns:minmax(280px,380px) minmax(0,1fr);gap:14px;align-items:start}
.pz-picker{border:1px solid var(--brass-light);border-radius:6px;background:var(--surface-inset);padding:10px;min-width:0}
.pz-picker{display:flex;flex-direction:column;gap:10px;position:sticky;top:8px;max-height:calc(100vh - 260px);overflow:hidden}
.pz-empty{padding:20px 10px}
.pz-credits{font-size:11px;margin:0}
@media (max-width:900px){
  .pz-layout{grid-template-columns:1fr}
  .pz-picker{max-height:none;position:static}
}
</style>
