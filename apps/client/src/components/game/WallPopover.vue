<script lang="ts">
import type { WallKind, WallSegment, WallStyle } from '../../tabletop/scene';

export const WALL_STYLES: Array<{ id: Exclude<WallStyle, 'image'>; label: string }> = [
  { id: 'stone', label: 'Камень' },
  { id: 'brick', label: 'Кирпич' },
  { id: 'wood', label: 'Дерево' },
  { id: 'hedge', label: 'Живая изгородь' },
  { id: 'rock', label: 'Скала' },
  { id: 'plain', label: 'Простая' },
];

export const WALL_KIND_OPTIONS: Array<{ id: WallKind; label: string }> = [
  { id: 'wall', label: 'Стена' },
  { id: 'door', label: 'Дверь' },
  { id: 'window', label: 'Окно (видно насквозь, не пройти)' },
];

export function wallSteps(wall: Pick<WallSegment, 'x1' | 'z1' | 'x2' | 'z2'>): number {
  return Math.max(1, Math.round(Math.max(Math.abs(wall.x2 - wall.x1), Math.abs(wall.z2 - wall.z1))));
}
export function wallTileAt(wall: Pick<WallSegment, 'x1' | 'z1' | 'x2' | 'z2'>, point: { x: number; z: number } | null): number {
  if (!point) return 0;
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1;
  const t = Math.max(0, Math.min(1, ((point.x - wall.x1) * dx + (point.z - wall.z1) * dz) / (dx * dx + dz * dz || 1)));
  return Math.min(wallSteps(wall) - 1, Math.floor(t * wallSteps(wall)));
}
export function defaultWallHp(wall: Pick<WallSegment, 'kind' | 'style'>): number {
  if (wall.kind === 'door') return 18;
  if (wall.kind === 'window') return 4;
  return ({ rock: 54, wood: 18, hedge: 10 } as Record<string, number>)[wall.style ?? 'stone'] ?? 27;
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { cssZoom } from '../../settings/uiScale';

export type WallChange = {
  style?: WallStyle; kind?: WallKind; open?: boolean; locked?: boolean; broken?: boolean; hpMax?: number | null; remove?: true;
};

const props = defineProps<{
  at: { x: number; y: number };
  wall: WallSegment;
  tile: number;
  editMode: boolean;
  canManage: boolean;
  hasPicture: boolean;
  total: number;
  busy: boolean;
  actorName: string | null;
  weapons: Array<{ id: string; name: string }>;
}>();
const emit = defineEmits<{
  edit: [change: WallChange, scope: 'tile' | 'wall'];
  strike: [weaponId: string];
  picture: [file: File];
  everywhere: [];
  close: [];
}>();

const root = ref<HTMLElement | null>(null);
const zoom = cssZoom;
const height = ref(300);
const position = computed(() => ({
  left: `${Math.max(8, Math.min(props.at.x / zoom.value + 8, window.innerWidth / zoom.value - 320))}px`,
  top: `${Math.max(8, Math.min(props.at.y / zoom.value + 8, window.innerHeight / zoom.value - height.value - 8))}px`,
}));

const steps = computed(() => wallSteps(props.wall));
const scope = ref<'tile' | 'wall'>('tile');
const kindLabel = computed(() => ({ wall: 'Стена', door: 'Дверь', window: 'Окно' } as Record<string, string>)[props.wall.kind ?? 'wall']);
const hpMax = computed(() => props.wall.hp_max ?? defaultWallHp(props.wall));
const hpText = computed(() => (props.wall.broken ? 'разрушена' : `${props.wall.hp ?? hpMax.value} из ${hpMax.value}`));
const weaponId = ref(props.weapons[0]?.id ?? '');
watch(() => props.weapons, list => { if (!list.some(weapon => weapon.id === weaponId.value)) weaponId.value = list[0]?.id ?? ''; });
const ownMax = ref<number | ''>(props.wall.hp_max ?? '');

function change(next: WallChange) {
  emit('edit', next, steps.value > 1 ? scope.value : 'wall');
}

function setMax() {
  const value = ownMax.value === '' ? null : Math.max(1, Math.min(10000, Math.round(Number(ownMax.value))));
  if (value === (props.wall.hp_max ?? null)) return;
  change({ hpMax: value });
}

function onDocument(event: PointerEvent) {
  if (root.value && !root.value.contains(event.target as Node) && !(event.target instanceof HTMLCanvasElement)) emit('close');
}
function onKey(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close');
}
onMounted(() => {
  height.value = Math.min(root.value?.offsetHeight ?? 300, window.innerHeight / zoom.value - 16);
  document.addEventListener('pointerdown', onDocument, true);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocument, true);
  window.removeEventListener('keydown', onKey);
});

function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) emit('picture', file);
}
</script>

<template>
  <div ref="root" class="wall-popover g-frame" :style="position" role="dialog" :aria-label="kindLabel" @contextmenu.prevent>
    <div class="head">
      <b>{{ kindLabel }}<small v-if="steps > 1" class="muted"> · участок {{ tile + 1 }} из {{ steps }}</small></b>
      <button type="button" class="close" aria-label="Закрыть" @click="emit('close')">×</button>
    </div>
    <div class="wall-popover-body">

    <section class="play">
      <p class="state">
        <template v-if="canManage">Прочность: {{ hpText }}</template>
        <template v-else>Выглядит: {{ wall.condition ?? (wall.broken ? 'разрушена' : 'целая') }}</template>
        <template v-if="wall.kind === 'door' && !wall.broken"> · {{ wall.open ? 'открыта' : 'закрыта' }}{{ canManage && wall.locked ? ', заперта' : '' }}</template>
      </p>
      <div class="buttons">
        <button v-if="wall.kind === 'door' && !wall.broken" type="button" :disabled="busy" @click="emit('edit', { open: !wall.open }, 'wall')">
          {{ wall.open ? 'Закрыть дверь' : 'Открыть дверь' }}
        </button>
      </div>
      <div v-if="!wall.broken && actorName && weapons.length" class="strike">
        <select v-model="weaponId" :disabled="busy" aria-label="Чем бить">
          <option v-for="weapon in weapons" :key="weapon.id" :value="weapon.id">{{ weapon.name }}</option>
        </select>
        <button type="button" :disabled="busy || !weaponId" :title="`${actorName} бьёт этот участок: атака против КД материала, урон — по прочности`" @click="emit('strike', weaponId)">Ударить</button>
      </div>
      <small v-else-if="!wall.broken && !actorName" class="muted">Ударить — выберите, кем действовать.</small>
    </section>

    <section v-if="canManage" class="edit" :class="{ first: editMode }">
      <label v-if="steps > 1" class="row">
        <span>Менять</span>
        <select v-model="scope" :disabled="busy">
          <option value="tile">этот участок (5 фт.)</option>
          <option value="wall">всю стену ({{ steps * 5 }} фт.)</option>
        </select>
      </label>
      <label class="row">
        <span>Тип</span>
        <select :value="wall.kind ?? 'wall'" :disabled="busy" @change="change({ kind: ($event.target as HTMLSelectElement).value as WallKind })">
          <option v-for="entry in WALL_KIND_OPTIONS" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
        </select>
      </label>
      <label class="row">
        <span>Вид</span>
        <select :value="wall.style ?? 'stone'" :disabled="busy" @change="change({ style: ($event.target as HTMLSelectElement).value as WallStyle })">
          <option v-for="entry in WALL_STYLES" :key="entry.id" :value="entry.id">{{ entry.label }}</option>
          <option v-if="hasPicture" value="image">Своя картинка</option>
        </select>
      </label>
      <label class="picture">
        <span>Своя картинка…</span>
        <input type="file" accept="image/png,image/jpeg,image/webp" :disabled="busy" @change="onFile" />
      </label>
      <div v-if="wall.kind === 'door' && !wall.broken" class="flags">
        <label class="checkbox-label"><input type="checkbox" :checked="wall.locked" :disabled="busy" @change="change({ locked: ($event.target as HTMLInputElement).checked })" /> заперта (игрок не откроет)</label>
      </div>
      <label class="row" :title="`По материалу — ${defaultWallHp(wall)}; пусто — по материалу`">
        <span>Прочность</span>
        <input v-model.number="ownMax" type="number" min="1" max="10000" :placeholder="String(defaultWallHp(wall))" :disabled="busy" @change="setMax" />
      </label>
      <div class="buttons">
        <button type="button" :disabled="busy" @click="change({ broken: !wall.broken })">{{ wall.broken ? 'Починить' : 'Разрушить' }}</button>
        <button type="button" :disabled="busy || total < 2" :title="`Этот вид — всем ${total} стенам сцены`" @click="emit('everywhere')">Вид всем стенам</button>
        <button type="button" class="danger" :disabled="busy" @click="change({ remove: true })">{{ steps > 1 && scope === 'tile' ? 'Убрать участок' : 'Убрать' }}</button>
      </div>
    </section>
    </div>
  </div>
</template>

<style scoped>
.wall-popover{position:fixed;z-index:2600;width:300px;max-height:calc(100vh / var(--ui-zoom, 1) - 16px);box-sizing:border-box;display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.wall-popover-body{display:flex;flex-direction:column;gap:8px;min-height:0;overflow-y:auto;overflow-x:hidden}
.head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.head small{font-weight:400}
.close{min-height:26px;width:26px;padding:0}
section{display:flex;flex-direction:column;gap:6px}
section.edit{padding-top:8px;border-top:1px solid var(--g-line, #fff2)}
section.edit.first{order:-1;padding-top:0;border-top:0;padding-bottom:8px;border-bottom:1px solid var(--g-line, #fff2)}
.state{margin:0;font-size:13px}
.row{display:grid;grid-template-columns:86px 1fr;align-items:center;gap:8px;margin:0}
.row input{min-height:28px}
.picture{display:flex;flex-direction:column;gap:2px;font-size:12px}
.buttons{display:flex;flex-wrap:wrap;gap:6px}
.buttons button{min-height:28px;padding:2px 10px;font-size:12px}
.strike{display:flex;gap:6px;align-items:center}
.strike select{flex:1;min-width:0}
.strike button{min-height:28px;padding:2px 12px}
.flags{display:flex;flex-direction:column;gap:2px;font-size:12px}
.danger{color:#ffb3b3}
</style>
