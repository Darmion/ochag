<script setup lang="ts">
import { computed, ref } from 'vue';

import GameIcon from '../game/GameIcon.vue';
import { assetImageUrl, forgetAssetImage } from '../../art/assetImages';
import {
  FILE_FILTERS, allPlaces, fileKindIcon, fileKindLabel, isPicture, usesSummary, type CampaignFile, type FileFilter,
} from '../../campaign/campaignFiles';
import { formatBytes } from '../../connection/updateStore';
import { locale, t, tn } from '../../i18n/i18n';

const props = defineProps<{
  campaignId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const PAGE = 30;

const files = ref<CampaignFile[]>([]);
const cleanupKinds = ref<string[]>([]);
const loaded = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const filter = ref<FileFilter>('pictures');
const shown = ref(PAGE);
const confirming = ref('');
const previewId = ref('');

const kinds = computed(() => FILE_FILTERS.find(entry => entry.id === filter.value)?.kinds ?? null);
const visible = computed(() => files.value.filter(file => !kinds.value || kinds.value.includes(file.kind)));
const visibleBytes = computed(() => visible.value.reduce((sum, file) => sum + Number(file.byte_size), 0));
const stray = computed(() => files.value.filter(file => cleanupKinds.value.includes(file.kind) && !file.uses.length));
const strayBytes = computed(() => stray.value.reduce((sum, file) => sum + Number(file.byte_size), 0));

const failure = (cause: unknown) => (cause instanceof Error ? cause.message : t('Не удалось загрузить файлы кампании. Попробуйте ещё раз.'));
const day = (value: string) => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
const previewUrl = (file: CampaignFile) => assetImageUrl(props.campaignId, file.id, props.request);

async function refresh() {
  error.value = '';
  try {
    const result = await props.request(`/campaigns/${props.campaignId}/assets/usage`);
    files.value = result.assets;
    cleanupKinds.value = result.cleanupKinds;
    loaded.value = true;
  } catch (cause) {
    error.value = failure(cause);
  }
}

function changeFilter() {
  shown.value = PAGE;
  confirming.value = '';
  previewId.value = '';
}

const fileName = (file: CampaignFile) => file.original_filename || t('без имени');

// A file nothing uses goes on a second press; one in use first shows where it will leave an empty place.
async function remove(file: CampaignFile, everywhere = false) {
  if (!everywhere && confirming.value !== file.id) {
    confirming.value = file.id;
    return;
  }
  busy.value = true;
  notice.value = '';
  try {
    const path = everywhere
      ? `/campaigns/${props.campaignId}/assets/${file.id}?everywhere=1`
      : `/campaigns/${props.campaignId}/assets/${file.id}`;
    await props.request(path, 'DELETE');
    forgetAssetImage(props.campaignId, file.id);
    notice.value = everywhere ? t('Файл «{name}» удалён отовсюду.', { name: fileName(file) }) : t('Файл «{name}» удалён.', { name: fileName(file) });
  } catch (cause) {
    error.value = failure(cause);
  } finally {
    confirming.value = '';
    busy.value = false;
    await refresh();
  }
}

async function cleanup() {
  if (confirming.value !== 'cleanup') {
    confirming.value = 'cleanup';
    return;
  }
  busy.value = true;
  notice.value = '';
  const gone = stray.value.map(file => file.id);
  try {
    const result = await props.request(`/campaigns/${props.campaignId}/assets/cleanup`, 'POST');
    for (const id of gone) forgetAssetImage(props.campaignId, id);
    notice.value = tn(result.deleted, 'Удалена {n} картинка, освободилось {size}.|Удалены {n} картинки, освободилось {size}.|Удалено {n} картинок, освободилось {size}.', { size: formatBytes(result.bytes) });
  } catch (cause) {
    error.value = failure(cause);
  } finally {
    confirming.value = '';
    busy.value = false;
    await refresh();
  }
}
</script>

<template>
  <details class="campaign-files" @toggle="($event.target as HTMLDetailsElement).open && refresh()">
    <summary>Файлы кампании</summary>

    <p class="muted">
      Картинки, модели и звуки, загруженные в эту кампанию. Удалённый файл пропадёт из кампании и из
      следующих резервных копий; если он где-то используется, там станет пусто.
    </p>

    <div class="files-toolbar">
      <label>Показать
        <select v-model="filter" @change="changeFilter">
          <option v-for="entry in FILE_FILTERS" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
        </select>
      </label>
      <span v-if="loaded" class="muted">{{ tn(visible.length, '{n} файл|{n} файла|{n} файлов') }} · {{ formatBytes(visibleBytes) }}</span>
    </div>

    <div v-if="stray.length" class="files-cleanup">
      <button type="button" class="link-button file-danger" :disabled="busy" @click="cleanup">
        {{ confirming === 'cleanup'
          ? tn(stray.length, 'Точно удалить {n} картинку? Вернуть её не получится|Точно удалить {n} картинки? Вернуть их не получится|Точно удалить {n} картинок? Вернуть их не получится')
          : t('Удалить неиспользуемые картинки: {n} ({size})', { n: stray.length, size: formatBytes(strayBytes) }) }}
      </button>
      <small class="muted">Модели, музыка и спрайты остаются в библиотеках — их удаляйте по одному.</small>
    </div>

    <p v-if="notice" class="notice">{{ notice }}</p>
    <p v-if="error" class="notice error">{{ error }}</p>

    <template v-if="loaded">
      <p v-if="!visible.length" class="muted">Здесь пока пусто.</p>
      <ul v-else class="file-list">
        <li v-for="file in visible.slice(0, shown)" :key="file.id" :class="{ unused: !file.uses.length }">
          <button
            v-if="isPicture(file)" type="button" class="file-thumb icon-only" :aria-expanded="previewId === file.id"
            :aria-label="t('Показать картинку')" @click="previewId = previewId === file.id ? '' : file.id"
          >
            <GameIcon :name="previewId === file.id ? 'eyeOff' : fileKindIcon(file.kind)" :size="18" />
          </button>
          <span v-else class="file-thumb" aria-hidden="true"><GameIcon :name="fileKindIcon(file.kind)" :size="18" /></span>

          <div class="file-info">
            <strong translate="no">{{ fileName(file) }}</strong>
            <small>
              {{ fileKindLabel(file.kind) }} · {{ formatBytes(Number(file.byte_size)) }} · {{ day(file.created_at) }}
              <template v-if="file.uploaded_by_name"> · <span translate="no">{{ file.uploaded_by_name }}</span></template>
            </small>
            <small class="file-uses" translate="no">{{ usesSummary(file, !cleanupKinds.includes(file.kind)) }}</small>
            <img v-if="previewId === file.id && previewUrl(file)" class="file-preview" :src="previewUrl(file) ?? undefined" alt="" />
            <div v-if="confirming === `everywhere:${file.id}`" class="file-confirm" role="group" :aria-label="t('Удалить файл отовсюду')">
              <strong translate="no">{{ t('Удалить «{name}» отовсюду?', { name: fileName(file) }) }}</strong>
              <small translate="no">{{ t('Там станет пусто: {list}. Вернуть файл не получится.', { list: allPlaces(file) }) }}</small>
              <span class="file-confirm-actions">
                <button type="button" class="file-confirm-delete" :disabled="busy" @click="remove(file, true)">Удалить отовсюду</button>
                <button type="button" :disabled="busy" @click="confirming = ''">Отмена</button>
              </span>
            </div>
          </div>

          <button v-if="!file.uses.length" type="button" class="link-button file-danger" :disabled="busy" @click="remove(file)">
            {{ confirming === file.id ? t('Точно удалить?') : t('Удалить') }}
          </button>
          <button
            v-else type="button" class="link-button file-danger" :disabled="busy"
            :aria-expanded="confirming === `everywhere:${file.id}`" @click="confirming = `everywhere:${file.id}`"
          >Удалить отовсюду…</button>
        </li>
      </ul>
      <button v-if="visible.length > shown" type="button" @click="shown += PAGE">Показать ещё</button>
    </template>
    <p v-else-if="!error" class="muted">Загрузка…</p>
  </details>
</template>

<style scoped>
.campaign-files{margin-top:20px;border-top:1px solid var(--brass-light);padding-top:10px}
.files-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;margin:10px 0}
.files-toolbar label{display:flex;align-items:center;gap:8px}
.files-cleanup{display:flex;flex-direction:column;gap:2px;margin:6px 0 10px}
.files-cleanup .file-danger{align-self:flex-start}
.file-danger{color:var(--burgundy-light);text-decoration:underline;font-size:13px}
.file-list{list-style:none;padding:0;margin:8px 0;display:flex;flex-direction:column;gap:6px}
.file-list li{display:flex;align-items:flex-start;gap:10px;padding:8px 10px;border:1px solid var(--brass-light);border-radius:3px}
.file-list li.unused{border-style:dashed}
.file-thumb{flex:none;display:grid;place-items:center;width:32px;height:32px;padding:0;border-radius:3px}
.file-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.file-info strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-uses{opacity:.85}
.file-preview{max-width:100%;max-height:180px;margin-top:6px;object-fit:contain;align-self:flex-start;border-radius:3px}
.file-confirm{display:flex;flex-direction:column;gap:4px;margin-top:8px;padding:8px 10px;border:1px solid var(--burgundy-light);border-radius:3px}
.file-confirm strong{white-space:normal}
.file-confirm-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.file-confirm-delete{color:var(--burgundy-light)}
</style>
