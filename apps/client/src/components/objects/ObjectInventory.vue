<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import ItemArt from '../rpg/ItemArt.vue';

type Content = { id: string; name: string; kind: string; contents_count: number };
type Target = { id: string; name: string; kind: 'character' | 'npc' | 'object' };

const props = defineProps<{
  campaignId: string;
  sceneId: string;
  characterId: string;
  name: string;
  kind: 'character' | 'npc' | 'object';
  canHandle: boolean;
  targets: Target[];
  busy: boolean;
  revision: number;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ changed: [message: string] }>();

const contents = ref<Content[] | null>(null);
const error = ref('');
const target = ref('');
const working = ref(false);

const choices = computed(() => props.targets.filter(entry => entry.id !== props.characterId));

async function load() {
  error.value = '';
  try {
    contents.value = (await props.request(`/campaigns/${props.campaignId}/characters/${props.characterId}/contents`)).contents;
  } catch {
    contents.value = null;
  }
}

watch(() => [props.characterId, props.revision], load, { immediate: true });
watch(() => props.characterId, () => { target.value = ''; });

async function move(itemId: string, body: Record<string, unknown>, message: string) {
  working.value = true;
  error.value = '';
  try {
    await props.request(`/campaigns/${props.campaignId}/characters/${itemId}/container`, 'PUT', body);
    emit('changed', message);
    await load();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    working.value = false;
  }
}

function takeOut(item: Content) {
  return move(item.id, { containerId: null, sceneId: props.sceneId }, `«${item.name}» — на столе`);
}

function putInto() {
  const destination = choices.value.find(entry => entry.id === target.value);
  if (!destination) return;
  const verb = destination.kind === 'object' ? `в «${destination.name}»` : `отдан: ${destination.name}`;
  return move(props.characterId, { containerId: destination.id }, `«${props.name}» ${verb}`);
}
</script>

<template>
  <section class="object-inventory" aria-label="Инвентарь">
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="contents?.length">
      <h4>Внутри</h4>
      <ul class="contents">
        <li v-for="item in contents" :key="item.id">
          <span class="item-line"><ItemArt :name="item.name" :size="28" placeholder /><span>{{ item.name }}<small v-if="item.contents_count" class="muted"> (внутри ещё {{ item.contents_count }})</small></span></span>
          <button type="button" :disabled="busy || working" title="Достать и поставить рядом" @click="takeOut(item)">Достать на стол</button>
        </li>
      </ul>
    </template>

    <div v-if="kind === 'object' && canHandle && choices.length" class="put-into">
      <label>
        Положить или отдать
        <select v-model="target" :disabled="busy || working">
          <option value="">— куда —</option>
          <option v-for="entry in choices" :key="entry.id" :value="entry.id">
            {{ entry.kind === 'object' ? `в «${entry.name}»` : `отдать: ${entry.name}` }}
          </option>
        </select>
      </label>
      <button type="button" :disabled="busy || working || !target" @click="putInto">Положить</button>
      <small class="muted">Положенный предмет уходит со стола. Отданный персонажу становится вещью его владельца.</small>
    </div>
  </section>
</template>

<style scoped>
.object-inventory{display:grid;gap:6px;margin-top:10px}
.object-inventory h4{margin:0}
.contents{list-style:none;margin:0;padding:0;display:grid;gap:4px}
.contents li{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:13px}
.contents button{min-height:28px;padding:2px 8px;font-size:12px;flex-shrink:0}
.item-line{display:flex;align-items:center;gap:6px;min-width:0}
.put-into{display:grid;gap:4px}
</style>
