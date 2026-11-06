<script setup lang="ts">
import { useEscapeClose } from '../../ui/escapeStack';
import { confirmAction } from '../../ui/confirmDialog';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { formatBytes, githubUpdate, refreshUpdateState, updateState } from '../../connection/updateStore';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{
  serverUrl: string;
  ownServer: boolean;
}>();

const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

const serverUpdate = ref<ServerUpdate | null>(null);
const serverError = ref('');
const githubError = ref('');
const repository = ref('');
const busy = ref('');
const progress = ref<{ source: string; received: number; total: number } | null>(null);
const readyVersion = ref('');
const message = ref('');

const state = computed(() => updateState.value);
const percent = computed(() =>
  progress.value && progress.value.total ? Math.floor((progress.value.received / progress.value.total) * 100) : null,
);

function errorText(cause: unknown, fallback: string) {
  const text = cause instanceof Error ? cause.message : fallback;
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

async function checkServer() {
  if (!window.desktop || !props.serverUrl || props.ownServer) return;
  serverError.value = '';

  try {
    serverUpdate.value = await window.desktop.updates.checkServer();
  } catch (cause) {
    serverError.value = errorText(cause, 'Не удалось узнать версию мастера. Попробуйте ещё раз.');
  }
}

async function downloadFromServer() {
  if (!window.desktop) return;
  busy.value = 'server';
  serverError.value = '';

  try {
    let result = await window.desktop.updates.downloadServer();
    if (result.unverified) {
      const trusted = await confirmAction(
        `Я не смог сверить установщик мастера с официальным выпуском на GitHub: ${result.reason ?? ''} Установщик запустит программу на вашем компьютере, поэтому скачивайте его, только если доверяете мастеру.`,
        { title: 'Скачать без проверки', confirmLabel: 'Скачать у мастера' },
      );
      if (!trusted) return;
      result = await window.desktop.updates.downloadServer({ allowUnverified: true });
    }
    readyVersion.value = result.version;
    await refreshUpdateState();
  } catch (cause) {
    serverError.value = errorText(cause, 'Не удалось скачать обновление у мастера. Попробуйте ещё раз.');
  } finally {
    busy.value = '';
    progress.value = null;
  }
}

async function saveRepository() {
  if (!window.desktop) return;
  await window.desktop.updates.saveSettings({ repository: repository.value });
  await refreshUpdateState();
}

async function setAutoCheck(value: boolean) {
  if (!window.desktop) return;
  await window.desktop.updates.saveSettings({ autoCheck: value });
  await refreshUpdateState();
}

async function checkGitHub() {
  if (!window.desktop) return;
  busy.value = 'check';
  githubError.value = '';

  try {
    await saveRepository();
    githubUpdate.value = await window.desktop.updates.checkGitHub();
  } catch (cause) {
    githubUpdate.value = null;
    githubError.value = errorText(cause, 'Не удалось проверить обновления. Попробуйте ещё раз.');
  } finally {
    busy.value = '';
  }
}

async function downloadGitHub() {
  if (!window.desktop) return;
  busy.value = 'github';
  githubError.value = '';

  try {
    githubUpdate.value = await window.desktop.updates.downloadGitHub();
    readyVersion.value = githubUpdate.value.version;
    await refreshUpdateState();
  } catch (cause) {
    githubError.value = errorText(cause, 'Не удалось скачать обновление. Попробуйте ещё раз.');
  } finally {
    busy.value = '';
    progress.value = null;
  }
}

async function importInstaller() {
  if (!window.desktop) return;
  message.value = '';

  try {
    const result = await window.desktop.updates.importInstaller();
    if ('canceled' in result) return;
    message.value = `Установщик версии ${result.version} сохранён.`;
    await refreshUpdateState();
  } catch (cause) {
    message.value = errorText(cause, 'Не удалось сохранить установщик. Попробуйте ещё раз.');
  }
}

async function install(version: string) {
  if (!window.desktop) return;
  if (!(await confirmAction(`Закрыть приложение и установить версию ${version}? Сервер и база корректно остановятся, данные сохранятся. Установщик откроется сам — пройдите его шаги.`, { title: 'Установить обновление', confirmLabel: 'Установить' }))) return;
  await window.desktop.updates.install(version);
}

let stopProgress: (() => void) | undefined;

onMounted(async () => {
  stopProgress = window.desktop?.updates.onProgress(value => { progress.value = value; });
  const loaded = await refreshUpdateState();
  repository.value = loaded?.repository ?? '';
  await checkServer();
});

onBeforeUnmount(() => {
  stopProgress?.();
});
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="updates-title" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <h3 id="updates-title">Обновления</h3>
        <button type="button" class="modal-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <p v-if="!state" class="muted">Обновления доступны только в настольном приложении.</p>

      <template v-else>
        <p>Установлена версия <strong>{{ state.currentVersion }}</strong>.</p>
        <p v-if="!state.packaged" class="notice warning">
          Приложение запущено из исходников: скачивание работает, но установку делайте
          собранным установщиком (npm run desktop:dist).
        </p>

        <div v-if="readyVersion" class="notice success ready">
          <p>✔ Версия {{ readyVersion }} скачана и проверена.</p>
          <button type="button" class="primary" @click="install(readyVersion)">Установить и перезапустить</button>
        </div>

        <div v-if="progress" class="progress" role="status">
          Скачивание{{ progress.source === 'server' ? ' у мастера' : ' с GitHub' }}:
          {{ percent !== null ? `${percent}%` : formatBytes(progress.received) }}
          <progress :value="progress.received" :max="progress.total || undefined" />
        </div>

        <section v-if="props.serverUrl && !props.ownServer" class="modal-section">
          <h4>От мастера</h4>
          <p class="muted">
            Обновление скачивается прямо с сервера мастера по вашей сети (домашний Wi-Fi или виртуальная локальная сеть),
            и версия будет ровно как у мастера. Если есть интернет, я сверяю установщик с официальным выпуском на GitHub.
          </p>

          <p v-if="serverError" class="notice error">{{ serverError }}</p>

          <template v-else-if="serverUpdate">
            <p v-if="!serverUpdate.newer && !serverUpdate.older">✔ У вас та же версия, что у мастера ({{ serverUpdate.serverVersion }}).</p>
            <p v-else-if="serverUpdate.older" class="notice warning">
              У мастера версия старее вашей ({{ serverUpdate.serverVersion }}). Попросите мастера обновиться —
              при разных версиях что-то может работать не так.
            </p>
            <template v-else>
              <p>У мастера версия <strong>{{ serverUpdate.serverVersion }}</strong> — новее вашей.</p>
              <button
                v-if="serverUpdate.installerAvailable"
                type="button"
                class="primary"
                :disabled="Boolean(busy)"
                @click="downloadFromServer"
              >
                {{ busy === 'server' ? 'Скачиваю…' : 'Скачать у мастера' }}
              </button>
              <p v-else class="notice warning">
                На сервере мастера нет установщика его версии. Попросите мастера открыть «Обновления» и
                скачать обновление или выбрать установщик — тогда он появится здесь.
              </p>
            </template>
          </template>

          <p v-else class="muted">Проверяю…</p>
        </section>

        <section class="modal-section">
          <h4>Из интернета (GitHub)</h4>
          <p class="muted">
            Новые версии публикуются как релизы в репозитории GitHub: тег вида <code>v0.3.0</code> и файл
            установщика <code>Ochag-Setup-0.3.0.exe</code>.
          </p>

          <label>
            Репозиторий
            <input v-model="repository" placeholder="владелец/репозиторий" spellcheck="false" :disabled="Boolean(busy)" @change="saveRepository" />
          </label>

          <label class="checkbox-label">
            <input type="checkbox" :checked="state.autoCheck" @change="setAutoCheck(($event.target as HTMLInputElement).checked)" />
            Проверять при запуске приложения
          </label>

          <button type="button" :disabled="Boolean(busy) || !repository.trim()" @click="checkGitHub">
            {{ busy === 'check' ? 'Проверяю…' : 'Проверить обновления' }}
          </button>

          <p v-if="githubError" class="notice error">{{ githubError }}</p>

          <template v-if="githubUpdate && !githubError">
            <p v-if="!githubUpdate.newer">✔ У вас последняя версия (на GitHub — {{ githubUpdate.version }}).</p>
            <template v-else>
              <p>
                Доступна версия <strong>{{ githubUpdate.version }}</strong>
                ({{ formatBytes(githubUpdate.asset.size) }}).
              </p>
              <details v-if="githubUpdate.notes" class="notes">
                <summary>Что нового</summary>
                <pre>{{ githubUpdate.notes }}</pre>
              </details>
              <button
                v-if="!githubUpdate.downloaded"
                type="button"
                class="primary"
                :disabled="Boolean(busy)"
                @click="downloadGitHub"
              >
                {{ busy === 'github' ? 'Скачиваю…' : 'Скачать' }}
              </button>
              <button v-else type="button" class="primary" @click="install(githubUpdate.version)">
                Установить {{ githubUpdate.version }} и перезапустить
              </button>
            </template>
          </template>
        </section>

        <section class="modal-section">
          <h4>Раздача игрокам</h4>
          <p v-if="state.sharingCurrent">
            ✔ Установщик вашей версии ({{ state.currentVersion }}) сохранён: игроки, подключённые к вашему серверу,
            смогут обновиться у вас без интернета.
          </p>
          <p v-else class="muted">
            Если вы мастер: чтобы игроки обновлялись с вашего сервера, у вас должен быть установщик вашей версии.
            После обновления через GitHub он сохраняется сам; иначе выберите файл
            «Ochag-Setup-{{ state.currentVersion }}.exe» вручную.
          </p>
          <button type="button" @click="importInstaller">Выбрать установщик…</button>
          <p v-if="message" class="muted">{{ message }}</p>

          <details v-if="state.installers.length" class="installers">
            <summary>Сохранённые установщики ({{ state.installers.length }})</summary>
            <ul>
              <li v-for="installer in state.installers" :key="installer.version">
                {{ installer.version }} — {{ formatBytes(installer.size) }},
                {{ installer.source === 'github' ? 'с GitHub' : installer.source === 'server' ? 'от мастера' : 'выбран вручную' }}
                <button
                  v-if="installer.version !== state.currentVersion"
                  type="button"
                  class="small"
                  @click="install(installer.version)"
                >
                  Установить
                </button>
              </li>
            </ul>
          </details>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3000;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-card{width:min(640px,100%);max-height:90vh;overflow-y:auto;padding:24px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.modal-header h3{margin:0}
.modal-close{min-height:32px;width:32px;padding:0}
.modal-section{margin-top:16px;padding-top:12px;border-top:1px solid var(--brass-light)}
.modal-section h4{margin:0 0 6px;font-size:17px}
.modal-section .muted{font-size:14px}
.progress{display:flex;align-items:center;gap:10px;margin:10px 0}
.progress progress{flex:1}
.ready{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.notes pre{white-space:pre-wrap;font-size:13px}
.installers ul{padding-left:18px;font-size:14px}
.small{min-height:28px;padding:2px 10px;font-size:12px;margin-left:8px}
code{font-family:Consolas,monospace}
</style>
