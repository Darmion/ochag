<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{
  campaignId: string;
  campaignName: string;
  isOwner: boolean;
  canImport: boolean;
  token: string;
}>();

const emit = defineEmits<{ imported: [CampaignImportReport] }>();

const busy = ref(false);
const error = ref('');
const hints = ref<string[]>([]);
const exported = ref<{ filePath: string; sizeBytes: number } | null>(null);
const report = ref<CampaignImportReport | null>(null);

const available = Boolean(window.desktop);

const countsText = computed(() => {
  if (!report.value) return '';
  const c = report.value.counts;
  return [
    `персонажей: ${c.characters}`,
    `сцен: ${c.scenes}`,
    `объектов на картах: ${c.objects}`,
    `заметок: ${c.notes}`,
    `файлов карт и моделей: ${c.assets}`,
    `своих заклинаний: ${c.spells}`,
    `правил кампании: ${c.rules}`,
  ].join(', ');
});

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function reset() {
  error.value = '';
  hints.value = [];
  exported.value = null;
  report.value = null;
}

async function exportCampaign() {
  if (!window.desktop || !props.campaignId) return;
  reset();
  busy.value = true;

  try {
    const result = await window.desktop.campaign.exportToFile({
      campaignId: props.campaignId,
      campaignName: props.campaignName,
      token: props.token,
    });

    if ('canceled' in result) return;
    if (result.ok) exported.value = result;
    else {
      error.value = result.message;
      hints.value = result.hints ?? [];
    }
  } finally {
    busy.value = false;
  }
}

async function importCampaign() {
  if (!window.desktop) return;
  reset();
  busy.value = true;

  try {
    const result = await window.desktop.campaign.importFromFile({ token: props.token });

    if ('canceled' in result) return;
    if (result.ok) {
      report.value = result.report;
      emit('imported', result.report);
    } else {
      error.value = result.message;
      hints.value = result.hints ?? [];
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <details v-if="!available || isOwner || canImport" class="campaign-transfer">
    <summary>Перенос кампании на другой сервер</summary>

    <p class="muted">
      Кампания хранится только на сервере, где её создали. Сама она на другой
      компьютер не переходит. Перенос делается файлом:
    </p>
    <ol class="muted steps">
      <li>Подключитесь к серверу, где кампания сейчас, и нажмите «Сохранить в файл».</li>
      <li>
        Подключитесь к новому серверу («Выйти / сменить сервер» в шапке) и нажмите
        «Загрузить кампанию из файла».
      </li>
    </ol>
    <p class="muted">
      На новом сервере появится копия, где главный мастер — вы. Исходная кампания не меняется.
      Игроки, у которых на новом сервере есть аккаунт с тем же логином, добавятся в кампанию сами.
      Персонажи остальных станут NPC мастера.
    </p>

    <p v-if="!available" class="notice warning">Перенос доступен только в настольном приложении (не в браузере).</p>

    <div v-else class="transfer-actions">
      <button v-if="campaignId && isOwner" type="button" :disabled="busy" @click="exportCampaign">
        {{ campaignName ? `Сохранить «${campaignName}» в файл` : 'Сохранить в файл' }}
      </button>
      <button v-if="canImport" type="button" class="primary" :disabled="busy" @click="importCampaign">
        Загрузить кампанию из файла
      </button>
    </div>
    <small v-if="available && campaignId && !isOwner">
      Сохранить кампанию в файл может только её главный мастер.
    </small>
    <small v-if="available && !canImport">
      Загрузить кампанию из файла может хозяин сервера или тот, кому он разрешил создавать кампании.
    </small>

    <p v-if="busy" class="muted" role="status">Идёт перенос — большие карты и модели могут занять до нескольких минут…</p>

    <div v-if="error" class="notice error" role="alert">
      <p>{{ error }}</p>
      <ul v-if="hints.length">
        <li v-for="hint in hints" :key="hint">{{ hint }}</li>
      </ul>
    </div>

    <p v-if="exported" class="notice success" role="status">
      ✔ Кампания сохранена ({{ formatSize(exported.sizeBytes) }}): <code>{{ exported.filePath }}</code>.
      Перенесите файл на другой компьютер (флешка, мессенджер) или загрузите его после смены сервера.
    </p>

    <div v-if="report" class="notice success" role="status">
      <p>
        ✔ Кампания «{{ report.name }}» перенесена
        {{ report.source.hostName ? `с компьютера «${report.source.hostName}»` : '' }}:
        {{ countsText }}.
      </p>
      <p v-if="report.matchedPlayers.length">
        Игроки добавлены в кампанию: {{ report.matchedPlayers.join(', ') }}.
      </p>
      <div v-if="report.missingPlayers.length" class="missing">
        <p>На этом сервере нет аккаунтов игроков:</p>
        <ul>
          <li v-for="player in report.missingPlayers" :key="player.username">
            <strong>{{ player.displayName }}</strong> (логин «{{ player.username }}»)
            <template v-if="player.characters.length">: персонажи {{ player.characters.join(', ') }} стали НПС мастера</template>
          </li>
        </ul>
        <p>
          Пригласите их в кампанию обычным приглашением. Если персонажи должны остаться у игроков,
          пусть сначала зарегистрируются на этом сервере с теми же логинами, а потом загрузите файл ещё раз:
          появится новая копия кампании с их персонажами.
        </p>
      </div>
      <p v-for="warning in report.warnings" :key="warning">⚠ {{ warning }}</p>
    </div>
  </details>
</template>

<style scoped>
.steps{margin:0 0 10px;padding-left:22px;line-height:1.6}
.transfer-actions{display:flex;gap:10px;flex-wrap:wrap}
.missing ul{margin:4px 0 6px;padding-left:20px}
.notice p{margin:0 0 6px}
code{font-family:Consolas,monospace;overflow-wrap:anywhere}
</style>
