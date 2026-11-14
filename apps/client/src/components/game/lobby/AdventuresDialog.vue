<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useEscapeClose } from '../../../ui/escapeStack';
import { adventureCountsText, adventureFacts, type Adventure, type AdventureCampaign } from '../../../lobby/adventures';
import GameIcon from '../GameIcon.vue';

const props = defineProps<{
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ close: []; created: [result: AdventureCampaign] }>();
useEscapeClose(() => emit('close'));

const adventures = ref<Adventure[]>([]);
const canCreate = ref(false);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const selectedId = ref('');
const name = ref('');

const selected = computed(() => adventures.value.find(entry => entry.id === selectedId.value) ?? null);
watch(selected, adventure => { name.value = adventure?.title ?? ''; });

onMounted(async () => {
  try {
    const data = await props.request('/adventures');
    adventures.value = Array.isArray(data?.adventures) ? data.adventures : [];
    canCreate.value = data?.canCreate === true;
    selectedId.value = adventures.value.find(entry => !entry.error)?.id ?? adventures.value[0]?.id ?? '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось получить список приключений. Закройте окно и откройте снова.';
  } finally {
    loading.value = false;
  }
});

async function create() {
  const adventure = selected.value;
  if (!adventure || adventure.error || busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const result = await props.request(`/adventures/${adventure.id}/campaign`, 'POST', { name: name.value.trim() || adventure.title });
    emit('created', result as AdventureCampaign);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Кампания не создалась. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="modal-overlay" role="dialog" aria-modal="true" aria-label="Готовые приключения" @click.self="emit('close')">
    <section class="modal-card adventures g-frame">
      <header class="adventures-head">
        <h2><GameIcon name="scroll" :size="22" /> Готовые приключения</h2>
        <button type="button" class="icon-only" aria-label="Закрыть" @click="emit('close')"><GameIcon class="inline-icon" name="close" :size="16" /></button>
      </header>
      <p v-if="loading" class="muted" role="status">Читаю папку модов…</p>
      <template v-else-if="!adventures.length">
        <p class="muted">Приключений на этом сервере нет.</p>
        <p class="hint">Приключение — мод вида «adventure» в папке модов сервера: файлы сцен .ochag-scene и adventure.json с заметками, заданиями и раздаточными. Как его собрать — docs/MODS.md.</p>
      </template>
      <div v-else class="adventures-body">
        <ul class="adventure-list" role="listbox" aria-label="Приключения">
          <li v-for="adventure in adventures" :key="adventure.id">
            <button
              type="button" role="option" :aria-selected="adventure.id === selectedId" :class="{ active: adventure.id === selectedId, broken: adventure.error }"
              @click="selectedId = adventure.id"
            >
              <img v-if="adventure.cover" :src="adventure.cover" alt="" />
              <GameIcon v-else name="scroll" :size="28" />
              <span>
                <strong translate="no">{{ adventure.title }}</strong>
                <small>{{ adventure.error ? 'не готово' : adventureFacts(adventure).join(' · ') }}</small>
              </span>
            </button>
          </li>
        </ul>
        <article v-if="selected" class="adventure-detail">
          <img v-if="selected.cover" class="cover" :src="selected.cover" :alt="`Обложка: ${selected.title}`" />
          <h3 translate="no">{{ selected.title }}</h3>
          <p class="mod-line">{{ `мод «${selected.name}» ${selected.version}` }}<template v-if="selected.author"> · <span translate="no">{{ selected.author }}</span></template></p>
          <p v-if="adventureFacts(selected).length" class="facts">
            <span v-for="fact in adventureFacts(selected)" :key="fact" translate="no">{{ fact }}</span>
          </p>
          <p v-if="selected.intro || selected.description" class="intro" translate="no">{{ selected.intro || selected.description }}</p>
          <p v-if="adventureCountsText(selected.counts)" class="counts">В кампании будет: {{ adventureCountsText(selected.counts) }}.</p>
          <p v-if="selected.error" class="error" role="alert">Приключение не готово: {{ selected.error }}.</p>
          <details v-if="selected.problems.length" class="problems">
            <summary>Пропущено при чтении: {{ selected.problems.length }}</summary>
            <ul><li v-for="problem in selected.problems" :key="problem" translate="no">{{ problem }}</li></ul>
          </details>
          <form v-if="!selected.error && canCreate" class="create" @submit.prevent="create">
            <label>
              Название кампании
              <input v-model="name" maxlength="200" :disabled="busy" />
            </label>
            <button type="submit" class="primary" :disabled="busy">{{ busy ? 'Создаю…' : 'Создать кампанию' }}</button>
          </form>
          <p v-else-if="!canCreate" class="muted">Создать кампанию может хозяин сервера или тот, кому он разрешил.</p>
        </article>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
.modal-overlay{position:fixed;inset:0;z-index:3500;display:flex;align-items:center;justify-content:center;padding:18px;background:#0b0704cc}
.adventures{width:min(920px,100%);max-height:90vh;overflow-y:auto;overflow-x:hidden;padding:16px 20px;background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:6px;box-shadow:0 16px 40px #000a;display:flex;flex-direction:column;gap:10px}
.adventures-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.adventures-head h2{margin:0;display:flex;align-items:center;gap:8px}
.adventures-body{display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:16px;min-height:0}
.adventure-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;max-height:60vh;overflow-y:auto}
.adventure-list button{width:100%;display:flex;align-items:center;gap:10px;padding:8px;text-align:left;justify-content:flex-start}
.adventure-list button.active{box-shadow:inset 3px 0 0 var(--burgundy,#7a2e2e)}
.adventure-list button.broken{opacity:.7}
.adventure-list img{flex:none;width:48px;height:48px;object-fit:cover;border-radius:4px}
.adventure-list span{display:flex;flex-direction:column;gap:2px;min-width:0}
.adventure-list small{font-weight:400;font-size:12px;opacity:.85}
.adventure-detail{display:flex;flex-direction:column;gap:8px;min-width:0}
.adventure-detail .cover{width:100%;max-height:220px;object-fit:cover;border-radius:4px}
.adventure-detail h3{margin:0}
.mod-line{margin:0;font-size:12px;font-style:italic;color:var(--muted-ink)}
.facts{display:flex;flex-wrap:wrap;gap:6px;margin:0}
.facts span{padding:1px 8px;border:1px solid var(--brass-light);border-radius:10px;font-size:12px}
.intro{margin:0;white-space:pre-line}
.counts{margin:0;font-size:13px}
.problems{font-size:13px}
.problems ul{margin:6px 0 0;padding-left:18px}
.create{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-top:6px}
.create label{display:flex;flex-direction:column;gap:4px;flex:1 1 220px;font-size:13px;font-weight:600}
.create button{min-height:36px}
.hint{font-size:13px;color:var(--muted-ink)}
.error{color:var(--burgundy)}
@media (max-width:720px){.adventures-body{grid-template-columns:1fr}.adventure-list{max-height:30vh}}
</style>
