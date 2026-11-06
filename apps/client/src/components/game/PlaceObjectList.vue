<script setup lang="ts">
import { computed, ref } from 'vue';

type Placeable = { id: string; name: string; kind: string };
type Group = { kind: string; label: string; items: Placeable[] };

const props = defineProps<{
  groups: Group[];
  busy: boolean;
  disabled: boolean;
  imageFor: (item: Placeable) => string | null;
}>();
const emit = defineEmits<{ place: [characterId: string] }>();

const query = ref('');
const kind = ref('');
const total = computed(() => props.groups.reduce((sum, group) => sum + group.items.length, 0));
const items = computed(() => {
  const text = query.value.trim().toLowerCase().replace(/ё/g, 'е');
  return props.groups
    .filter(group => !kind.value || group.kind === kind.value)
    .flatMap(group => group.items.map(item => ({ ...item, group: group.label })))
    .filter(item => !text || item.name.toLowerCase().replace(/ё/g, 'е').includes(text))
    .slice(0, 200);
});
</script>

<template>
  <!-- A div, not a labelled section: the tabbed window layout would move a section into a tab of its own. -->
  <div class="place-list" role="group" aria-label="Поставить на сцену">
    <header class="place-head">
      <h4>Поставить на сцену</h4>
      <span class="muted">{{ total ? `не на сцене: ${total}` : 'всё уже на сцене' }}</span>
    </header>
    <div v-if="total" class="place-filters">
      <input v-model="query" type="search" placeholder="Найти по имени…" aria-label="Найти объект по имени" />
      <select v-model="kind" aria-label="Вид объекта">
        <option value="">Все</option>
        <option v-for="group in groups" :key="group.kind" :value="group.kind">{{ group.label }} ({{ group.items.length }})</option>
      </select>
    </div>
    <ul v-if="items.length" class="place-items">
      <li v-for="item in items" :key="item.id">
        <button type="button" :disabled="busy || disabled" :title="`Поставить «${item.name}» в середину карты`" @click="emit('place', item.id)">
          <span class="place-portrait" :class="`kind-${item.kind}`" aria-hidden="true">
            <img v-if="imageFor(item)" :src="imageFor(item)!" alt="" />
            <template v-else>{{ item.name.slice(0, 1).toUpperCase() }}</template>
          </span>
          <span class="place-copy"><strong>{{ item.name }}</strong><small>{{ item.group }}</small></span>
          <span class="place-go" aria-hidden="true">＋</span>
        </button>
      </li>
    </ul>
    <p v-else-if="total" class="muted">Ничего не нашлось.</p>
  </div>
</template>

<style scoped>
.place-list{display:flex;flex-direction:column;gap:8px}
.place-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.place-head h4{margin:0}
.place-filters{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}
.place-filters input,.place-filters select{min-width:0}
.place-items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;max-height:min(40vh,320px);overflow-y:auto}
.place-items button{width:100%;display:flex;align-items:center;gap:9px;min-height:46px;padding:4px 8px;justify-content:flex-start;text-align:left}
.place-portrait{flex:none;display:grid;place-items:center;width:36px;height:36px;overflow:hidden;border-radius:3px;font-weight:700;background:#00000055;box-shadow:inset 0 0 0 1px var(--g-gold-lo,#8a6a35)}
.place-portrait img{width:100%;height:100%;object-fit:cover;object-position:top;image-rendering:pixelated}
.place-portrait.kind-character{background:radial-gradient(circle at 50% 35%,#3b5384,#0e1628)}
.place-portrait.kind-npc{background:radial-gradient(circle at 50% 35%,#7a6430,#241b0a)}
.place-copy{display:flex;flex-direction:column;min-width:0}
.place-copy strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.place-copy small{font-size:11px;opacity:.7}
.place-go{margin-left:auto;font-size:16px;opacity:.7}
</style>
