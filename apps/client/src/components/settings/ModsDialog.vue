<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useEscapeClose } from '../../ui/escapeStack';
import { hasVisualMods, loadVisualMods, openModsFolder, setVisualModOn, visualMods, visualModsOff } from '../../settings/visualMods';
import { artPackError, artPacks, hasArtPacks, loadArtPacks, packOn, sectionOn, setArtPackOn, setArtPackSection } from '../../art/artPacks';
import { modSectionText, modText, type ModTranslations } from '../../settings/modText';
import GameIcon from '../game/GameIcon.vue';

const props = defineProps<{ request?: (path: string, method?: string) => Promise<any> }>();
const emit = defineEmits<{ close: [] }>();
useEscapeClose(() => emit('close'));

type ServerMod = { id: string; name: string; version: string; description: string; author: string; status: 'loaded' | 'disabled' | 'error'; error: string | null; changes: string[]; folder?: string; bundled?: boolean; translations?: ModTranslations };
const serverMods = ref<ServerMod[]>([]);
const canInstall = ref(false);
const serverError = ref('');
const busy = ref(false);
const STATUS: Record<ServerMod['status'], string> = { loaded: 'подключён', disabled: 'выключен', error: 'не подключён' };
const bundledOn = ref<Set<string> | null>(null);
const restartNeeded = ref(false);
const restartError = ref('');
const canToggleBundled = computed(() => canInstall.value && Boolean(window.desktop?.mods?.setBundled));
const shownServerMods = computed(() => serverMods.value.filter(mod => !mod.bundled || mod.status !== 'disabled' || canInstall.value));
const bundledChecked = (mod: ServerMod) => (bundledOn.value ? bundledOn.value.has(mod.id) : mod.status === 'loaded');

async function loadBundled() {
  if (window.desktop?.mods?.bundled) bundledOn.value = new Set((await window.desktop.mods.bundled()).enabled);
}
async function setBundled(mod: ServerMod, on: boolean) {
  const result = await window.desktop?.mods?.setBundled?.(mod.id, on);
  if (!result) return;
  bundledOn.value = new Set(result.enabled);
  restartNeeded.value = serverMods.value.some(entry => entry.bundled && bundledChecked(entry) !== (entry.status === 'loaded'));
}
async function restartServer() {
  if (!window.desktop) return;
  busy.value = true;
  restartError.value = '';
  try {
    await window.desktop.host.stop();
    await window.desktop.host.start();
    restartNeeded.value = false;
    await loadServer();
  } catch (cause) {
    restartError.value = cause instanceof Error ? cause.message : 'Сервер не перезапустился.';
  } finally {
    busy.value = false;
  }
}

async function loadServer() {
  if (!props.request) {
    serverError.value = 'Войдите на сервер, чтобы увидеть его моды.';
    return;
  }
  try {
    const data = await props.request('/mods');
    serverMods.value = data.mods ?? [];
    canInstall.value = data.canInstall === true;
    serverError.value = '';
  } catch (cause) {
    serverError.value = cause instanceof Error ? cause.message : 'Не удалось получить список модов. Нажмите «Обновить список».';
  }
}
async function reload() {
  busy.value = true;
  try {
    await Promise.all([loadServer(), loadVisualMods(), loadArtPacks(), loadBundled()]);
  } finally {
    busy.value = false;
  }
}
onMounted(reload);
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" :aria-label="'Моды'" @click.self="emit('close')">
    <div class="modal-card">
      <header class="modal-header">
        <h3>Моды</h3>
        <button type="button" class="modal-close" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>

      <section class="modal-section">
        <h4>Механика — на сервере мастера</h4>
        <small class="muted">Меняют правила игры. Ставит только мастер на компьютере, где запущен сервер: папка мода в «Папке модов», затем перезапуск сервера. Что мод заменил, работает вместо встроенного.</small>
        <p v-if="serverError" class="muted">{{ serverError }}</p>
        <p v-else-if="!shownServerMods.length" class="muted">На этом сервере модов нет — правила как в приложении.</p>
        <ul v-else class="mod-list">
          <li v-for="mod in shownServerMods" :key="`${mod.id}@${mod.version}`" :class="mod.status">
            <div class="mod-head">
              <label v-if="mod.bundled && canToggleBundled" class="checkbox-label">
                <input type="checkbox" :checked="bundledChecked(mod)" :disabled="busy" @change="setBundled(mod, ($event.target as HTMLInputElement).checked)" />
                <b translate="no">{{ modText(mod, 'name', mod.name) }}</b>
              </label>
              <b v-else translate="no">{{ modText(mod, 'name', mod.name) }}</b>
              <small class="muted" translate="no">{{ mod.version }}{{ mod.author ? ` · ${modText(mod, 'author', mod.author)}` : '' }}</small>
              <span class="mod-status">{{ mod.bundled ? `в комплекте · ${STATUS[mod.status]}` : STATUS[mod.status] }}</span>
            </div>
            <p v-if="mod.description" class="mod-text" translate="no">{{ modText(mod, 'description', mod.description) }}</p>
            <p v-if="mod.error" class="mod-error">{{ mod.error }}</p>
            <ul v-if="mod.changes.length" class="mod-changes">
              <li v-for="(change, index) in mod.changes" :key="index">{{ change }}</li>
            </ul>
            <small v-if="mod.folder" class="muted mod-folder" translate="no">{{ mod.folder }}</small>
          </li>
        </ul>
        <p v-if="restartNeeded" class="mod-error">Изменится после перезапуска сервера; игроки переподключатся сами.</p>
        <p v-if="restartError" class="mod-error">{{ restartError }}</p>
        <div v-if="canInstall && hasVisualMods" class="mod-buttons">
          <button v-if="restartNeeded" type="button" class="primary" :disabled="busy" @click="restartServer()">Перезапустить сервер</button>
          <button type="button" @click="openModsFolder()">Открыть папку модов</button>
        </div>
      </section>

      <section class="modal-section">
        <h4>Картинки — у меня</h4>
        <small class="muted">Наборы картинок: портреты, гербы, знаки рас, предметы. Без набора на их месте — буква имени или ничего. Включаются у себя, по разделам; другие игроки ничего не заметят.</small>
        <template v-if="hasArtPacks">
          <p v-if="!artPacks.length" class="muted">Наборов картинок нет.</p>
          <ul v-else class="mod-list">
            <li v-for="pack in artPacks" :key="pack.id">
              <div class="mod-head">
                <label class="checkbox-label">
                  <input type="checkbox" :checked="packOn(pack)" :disabled="Boolean(pack.error) || pack.off || busy" @change="setArtPackOn(pack.id, ($event.target as HTMLInputElement).checked)" />
                  <b translate="no">{{ modText(pack, 'name', pack.name) }}</b>
                </label>
                <small class="muted" translate="no">{{ pack.version }}{{ pack.author ? ` · ${modText(pack, 'author', pack.author)}` : '' }}</small>
                <span v-if="pack.bundled" class="mod-status">в комплекте</span>
              </div>
              <p v-if="pack.description" class="mod-text" translate="no">{{ modText(pack, 'description', pack.description) }}</p>
              <p v-if="pack.error" class="mod-error">{{ pack.error }}</p>
              <p v-else-if="pack.off" class="muted">выключен в mod.json</p>
              <div v-else-if="packOn(pack)" class="pack-sections" role="group" :aria-label="`Разделы: ${modText(pack, 'name', pack.name)}`">
                <label v-for="section in pack.sections" :key="section.id" class="checkbox-label" :title="section.description || undefined">
                  <input type="checkbox" :checked="sectionOn(pack, section.id)" :disabled="busy" @change="setArtPackSection(pack.id, section.id, ($event.target as HTMLInputElement).checked)" />
                  <span translate="no">{{ modSectionText(pack, section.id, section.name) }}</span> <small class="muted">{{ section.count }}</small>
                </label>
              </div>
            </li>
          </ul>
          <p v-if="artPackError" class="mod-error">{{ artPackError }}</p>
        </template>
        <p v-else class="muted">Наборы картинок ставятся в приложении «Очаг» на компьютере, не в браузере.</p>
      </section>

      <section class="modal-section">
        <h4>Оформление — у меня</h4>
        <small class="muted">Меняют только вид, без кода: стили, картинки, шрифты. Каждый ставит себе сам — в «Папку модов» этого компьютера; другие игроки ничего не заметят.</small>
        <template v-if="hasVisualMods">
          <p v-if="!visualMods.length" class="muted">Оформлений пока нет.</p>
          <ul v-else class="mod-list">
            <li v-for="mod in visualMods" :key="mod.id">
              <div class="mod-head">
                <label class="checkbox-label">
                  <input type="checkbox" :checked="!mod.off && !visualModsOff.has(mod.id)" :disabled="Boolean(mod.error) || mod.off" @change="setVisualModOn(mod.id, ($event.target as HTMLInputElement).checked)" />
                  <b translate="no">{{ modText(mod, 'name', mod.name) }}</b>
                </label>
                <small class="muted" translate="no">{{ mod.version }}{{ mod.author ? ` · ${modText(mod, 'author', mod.author)}` : '' }}</small>
              </div>
              <p v-if="mod.description" class="mod-text" translate="no">{{ modText(mod, 'description', mod.description) }}</p>
              <p v-if="mod.error" class="mod-error">{{ mod.error }}</p>
              <p v-else-if="mod.off" class="muted">выключен в mod.json</p>
            </li>
          </ul>
        </template>
        <p v-else class="muted">Оформления ставятся в приложении «Очаг» на компьютере, не в браузере.</p>
        <div class="mod-buttons">
          <button v-if="hasVisualMods" type="button" @click="openModsFolder()">Открыть папку модов</button>
          <button type="button" :disabled="busy" @click="reload()">Обновить список</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3100;background:#000a;display:flex;align-items:center;justify-content:center;padding:20px}
.modal-card{width:min(620px,100%);max-height:90vh;overflow-y:auto;padding:24px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 16px 40px #0008}
.modal-header{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}
.modal-header h3{margin:0}
.modal-close{min-height:32px;width:32px;padding:0}
.modal-section{margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--brass-light)}
.modal-section:last-child{border-bottom:0;margin-bottom:0;padding-bottom:0}
.modal-section h4{margin:0 0 8px}
.modal-section .muted{font-size:13px;margin:0 0 10px;display:block}
.mod-list{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:10px}
.mod-list > li{padding:8px 10px;border:1px solid var(--brass-light);border-radius:4px}
.mod-list > li.error{border-color:var(--burgundy)}
.mod-list > li.disabled{opacity:.7}
.mod-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
.mod-head .muted{margin:0;display:inline}
.mod-head .checkbox-label{gap:8px;margin:0}
.mod-status{margin-left:auto;font-size:12px}
.mod-text{margin:4px 0 0;font-size:13px}
.mod-error{margin:4px 0 0;font-size:12px;color:var(--burgundy)}
.mod-changes{margin:4px 0 0;padding-left:18px;font-size:12px}
.mod-folder{margin:4px 0 0;word-break:break-all}
.pack-sections{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px 12px;margin-top:6px}
.pack-sections .checkbox-label{display:flex;align-items:baseline;gap:6px;margin:0;font-size:13px}
.pack-sections small{margin:0;display:inline}
.mod-buttons{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.mod-buttons button{min-height:30px;padding:2px 12px;font-size:13px}
</style>
