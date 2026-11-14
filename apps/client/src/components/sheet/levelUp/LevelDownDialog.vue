<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useEscapeClose } from '../../../ui/escapeStack';
import GameIcon from '../../game/GameIcon.vue';

type Preview = {
  name: string; from: number; to: number; recorded: boolean; hpLoss: number; needsClass: boolean; stillReady: boolean;
  classes: Array<{ id: string; name: string; level: number }>; lines: string[];
};

const props = defineProps<{
  campaignId: string;
  characterId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ close: []; done: [] }>();
useEscapeClose(() => emit('close'));

const preview = ref<Preview | null>(null);
const classId = ref('');
const error = ref('');
const working = ref(false);
const loading = ref(false);
const opener = document.activeElement as HTMLElement | null;
onBeforeUnmount(() => opener?.focus?.());
const done = ref<{ level: number } | null>(null);
const path = computed(() => `/campaigns/${props.campaignId}/characters/${props.characterId}/level-down`);

async function load() {
  error.value = '';
  loading.value = true;
  try {
    preview.value = await props.request(`${path.value}${classId.value ? `?classId=${classId.value}` : ''}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
watch(classId, load);

const ready = computed(() => Boolean(preview.value && !loading.value && (!preview.value.needsClass || classId.value)));

async function confirm() {
  if (!ready.value || working.value) return;
  working.value = true;
  error.value = '';
  try {
    done.value = await props.request(path.value, 'POST', { expectedLevel: preview.value!.from, ...(classId.value ? { classId: classId.value } : {}) });
    emit('done');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    await load();
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" :aria-label="preview ? `Понизить уровень: ${preview.name}` : 'Понизить уровень'">
    <section class="modal-card level-down">
      <header class="down-head">
        <h2 v-if="done && preview">{{ preview.name }} — {{ done.level }}-й уровень</h2>
        <h2 v-else-if="preview">Понизить {{ preview.name }} до {{ preview.to }}-го уровня?</h2>
        <h2 v-else>Понизить уровень</h2>
        <button class="icon-only" type="button" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <p v-if="!preview && !error" class="muted">Загружаю…</p>

      <template v-if="preview && !done">
        <label v-if="preview.classes.length && !preview.recorded" class="class-pick">
          Уровень какого класса понизить
          <select v-model="classId">
            <option value="" disabled>— выберите класс —</option>
            <option v-for="entry in preview.classes" :key="entry.id" :value="entry.id">{{ entry.name }} {{ entry.level }}</option>
          </select>
        </label>
        <p class="muted">{{ preview.recorded ? 'Отменится ровно то, что дал этот уровень:' : 'Что изменится:' }}</p>
        <ul class="down-lines">
          <li v-for="line in preview.lines" :key="line">{{ line }}</li>
        </ul>
        <p class="muted">Опыт не меняется.<template v-if="preview.stillReady"> Его хватает на {{ preview.from }}-й уровень — стрелка нового уровня загорится снова.</template></p>
        <footer class="down-foot">
          <button type="button" @click="emit('close')">Отмена</button>
          <button type="button" class="danger" :disabled="!ready || working" @click="confirm">
            <GameIcon class="inline-icon" name="levelDown" :size="16" /> Понизить до {{ preview.to }}-го уровня
          </button>
        </footer>
      </template>

      <footer v-if="done" class="down-foot">
        <button type="button" class="primary" @click="emit('close')">Готово</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3600;display:flex;align-items:center;justify-content:center;padding:18px;background:#0b0704cc}
.level-down{width:min(480px,calc(100vw - 32px));max-height:calc(100dvh - 36px);display:flex;flex-direction:column;gap:10px;padding:16px 18px}
.down-head,.down-foot{flex-shrink:0}
.down-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.down-head h2{margin:0;font-size:20px}
.down-head button{min-height:32px;width:32px;padding:0;flex:none}
.class-pick{display:flex;flex-direction:column;gap:4px;font-weight:600}
.down-lines{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px;min-height:0;overflow-y:auto}
.down-foot{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:6px}
.down-foot button{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:4px 14px}
.danger{color:#ffd9d2;background:linear-gradient(180deg,#7a2b28,#4a1311);box-shadow:inset 0 0 0 1px #c56a5e}
.danger:disabled{opacity:.55}
p{margin:0}
</style>
