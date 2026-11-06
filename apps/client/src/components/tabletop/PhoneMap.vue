<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { footprintCells } from '../../tabletop/grid';

const props = defineProps<{
  campaignId: string;
  token: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();
const emit = defineEmits<{ back: [] }>();

type SceneSummary = { id: string; name: string };
const scenes = ref<SceneSummary[]>([]);
const sceneId = ref('');
const sceneData = ref<any | null>(null);
const error = ref('');
const busy = ref(false);
const canvas = ref<HTMLCanvasElement | null>(null);
const wrap = ref<HTMLElement | null>(null);

const STORAGE_KEY = `ttrpg.phoneMapScene.${props.campaignId}`;

let backgroundAssetId: string | null = null;
let backgroundUrl: string | null = null;
let backgroundImage: HTMLImageElement | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;

async function loadScenes() {
  busy.value = true;
  error.value = '';
  try {
    const data = await props.request(`/campaigns/${props.campaignId}/scenes`);
    scenes.value = data.scenes;
    const saved = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
    sceneId.value = (saved && data.scenes.some((s: SceneSummary) => s.id === saved)) ? saved : data.scenes[0]?.id ?? '';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить список сцен. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}

async function loadBackground(assetId: string | null) {
  if (assetId === backgroundAssetId) return;
  backgroundAssetId = assetId;
  if (backgroundUrl) { URL.revokeObjectURL(backgroundUrl); backgroundUrl = null; }
  backgroundImage = null;
  if (!assetId) return;
  try {
    const response = await fetch(`/campaigns/${props.campaignId}/assets/${assetId}`, {
      headers: { authorization: `Bearer ${props.token}` },
    });
    if (!response.ok) return;
    const blob = await response.blob();
    backgroundUrl = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(); image.src = backgroundUrl!; });
    backgroundImage = image;
  } catch {
    backgroundImage = null;
  }
}

async function loadScene(silent = false) {
  if (!sceneId.value) return;
  if (!silent) busy.value = true;
  try {
    const data = await props.request(`/campaigns/${props.campaignId}/scenes/${sceneId.value}`);
    sceneData.value = data;
    error.value = '';
    await loadBackground(data.scene.background_asset_id ?? null);
    await nextTick();
    draw();
  } catch (cause) {
    if (!silent) error.value = cause instanceof Error ? cause.message : 'Не удалось загрузить сцену. Попробуйте ещё раз.';
  } finally {
    if (!silent) busy.value = false;
  }
}

function onSceneChange() {
  try { localStorage.setItem(STORAGE_KEY, sceneId.value); } catch {  }
  backgroundAssetId = null;
  void loadScene();
}

const DISPOSITION_COLOR: Record<string, string> = {
  hostile: '#b7372b', friendly: '#3f8a4e', neutral: '#a98a3f',
};

function colorOf(object: any): string {
  if (object.kind === 'object') return '#8a7b66';
  if (object.side === 'enemy') return DISPOSITION_COLOR.hostile;
  if (object.side === 'neutral') return DISPOSITION_COLOR.neutral;
  if (object.side && object.kind === 'npc') return DISPOSITION_COLOR.friendly;
  if (object.kind === 'npc' && !object.side) return DISPOSITION_COLOR[object.disposition ?? 'neutral'] ?? DISPOSITION_COLOR.neutral;
  return '#4f7fc9';
}

function draw() {
  const el = canvas.value;
  const data = sceneData.value;
  if (!el || !data) return;
  const scene = data.scene;
  const widthCells: number = scene.width_cells;
  const heightCells: number = scene.height_cells;
  const cellPx = 32;
  const margin = 18;
  el.width = widthCells * cellPx + margin * 2;
  el.height = heightCells * cellPx + margin * 2;
  const ctx = el.getContext('2d');
  if (!ctx) return;

  const toPx = (x: number, z: number) => ({ px: (x + widthCells / 2) * cellPx + margin, pz: (z + heightCells / 2) * cellPx + margin });

  const gridW = widthCells * cellPx, gridH = heightCells * cellPx;

  ctx.fillStyle = '#0b0907';
  ctx.fillRect(0, 0, el.width, el.height);

  if (backgroundImage) ctx.drawImage(backgroundImage, margin, margin, gridW, gridH);

  const fog = data.fog as { visibleCells: Array<{ x: number; z: number }>; exploredCells: Array<{ x: number; z: number }> } | null;
  ctx.strokeStyle = 'rgba(212,174,90,.35)';
  ctx.lineWidth = 1;
  if (!fog) {
    ctx.fillStyle = 'rgba(60,48,32,.55)';
    ctx.fillRect(margin, margin, gridW, gridH);
    for (let col = 0; col <= widthCells; col += 1) {
      ctx.beginPath(); ctx.moveTo(col * cellPx + margin, margin); ctx.lineTo(col * cellPx + margin, gridH + margin); ctx.stroke();
    }
    for (let row = 0; row <= heightCells; row += 1) {
      ctx.beginPath(); ctx.moveTo(margin, row * cellPx + margin); ctx.lineTo(gridW + margin, row * cellPx + margin); ctx.stroke();
    }
  } else {
    for (const cell of fog.exploredCells) {
      const { px, pz } = toPx(cell.x, cell.z);
      ctx.fillStyle = 'rgba(40,32,22,.65)';
      ctx.fillRect(px - cellPx / 2, pz - cellPx / 2, cellPx, cellPx);
    }
    for (const cell of fog.visibleCells) {
      const { px, pz } = toPx(cell.x, cell.z);
      ctx.fillStyle = 'rgba(70,56,36,.4)';
      ctx.fillRect(px - cellPx / 2, pz - cellPx / 2, cellPx, cellPx);
      ctx.strokeRect(px - cellPx / 2, pz - cellPx / 2, cellPx, cellPx);
    }
  }

  ctx.strokeStyle = '#d4ae5a';
  ctx.lineWidth = 3;
  for (const wall of data.walls ?? []) {
    const a = toPx(wall.x1, wall.z1), b = toPx(wall.x2, wall.z2);
    ctx.beginPath(); ctx.moveTo(a.px, a.pz); ctx.lineTo(b.px, b.pz); ctx.stroke();
  }

  for (const object of data.objects ?? []) {
    const n = footprintCells(object.size);
    const { px, pz } = toPx(object.world_x, object.world_z);
    const radius = (n * cellPx) / 2 - 2;
    ctx.beginPath();
    ctx.arc(px, pz, Math.max(6, radius), 0, Math.PI * 2);
    ctx.fillStyle = colorOf(object);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();

    if (object.hp && object.hp.max > 0) {
      const ratio = Math.max(0, Math.min(1, object.hp.current / object.hp.max));
      const barWidth = Math.max(18, n * cellPx - 8);
      const barX = px - barWidth / 2, barY = pz - radius - 9;
      ctx.fillStyle = '#000a';
      ctx.fillRect(barX, barY, barWidth, 5);
      ctx.fillStyle = ratio > 0.5 ? '#5ea764' : ratio > 0.25 ? '#e0aa3e' : '#cf4a3d';
      ctx.fillRect(barX, barY, barWidth * ratio, 5);
    }

    ctx.fillStyle = '#f6e2a0';
    ctx.font = '11px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText(object.name, px, pz + radius + 13);
  }
}

let resizeObserver: ResizeObserver | undefined;

onMounted(async () => {
  await loadScenes();
  await loadScene();
  pollTimer = setInterval(() => { void loadScene(true); }, 5000);
  if (wrap.value) {
    resizeObserver = new ResizeObserver(() => draw());
    resizeObserver.observe(wrap.value);
  }
});
onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
  resizeObserver?.disconnect();
});
watch(sceneId, onSceneChange);
</script>

<template>
  <section class="phone-map">
    <header class="map-header">
      <button type="button" class="link" @click="emit('back')">← Персонажи</button>
      <select v-if="scenes.length" v-model="sceneId" aria-label="Сцена">
        <option v-for="scene in scenes" :key="scene.id" :value="scene.id">{{ scene.name }}</option>
      </select>
    </header>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="busy && !sceneData" class="muted">Загрузка…</p>
    <p v-else-if="!scenes.length" class="muted">На этой кампании пока нет сцен.</p>
    <div v-else ref="wrap" class="canvas-wrap">
      <canvas ref="canvas" />
    </div>
  </section>
</template>

<style scoped>
.phone-map{display:flex;flex-direction:column;gap:10px;min-height:0}
.map-header{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.map-header select{min-height:36px;padding:4px 8px;flex:1 1 auto;min-width:0}
.link{background:none;border:none;color:#c9a876;text-decoration:underline;padding:0;font:inherit;cursor:pointer;flex:none}
.error{background:#4a1f1f;border:1px solid #a33;color:#ffd7d7;padding:8px 10px;border-radius:6px}
.muted{color:#a8957e;font-size:0.9rem}
.canvas-wrap{overflow:auto;border:1px solid #5a4636;border-radius:6px;background:#0b0907;max-height:70vh}
canvas{display:block;width:100%;height:auto;image-rendering:crisp-edges}
</style>
