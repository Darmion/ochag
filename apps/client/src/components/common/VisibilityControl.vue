<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { lockNearestScroll } from '../../ui/scrollLock';
import GameIcon from '../game/GameIcon.vue';
import type { GameIconName } from '../../ui/gameIcons';

export type VisibilitySetting = { mode: 'public' | 'hidden' | 'allowlist'; allowedUserIds: string[] };
export type CampaignMember = { userId: string; displayName: string };

const props = defineProps<{
  fieldKey: string;
  campaignId: string;
  characterId: string;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
  setting: VisibilitySetting;
  members: CampaignMember[];
}>();

const emit = defineEmits<{ change: [setting: VisibilitySetting, fieldKey: string] }>();

const busy = ref(false);
const open = ref(false);
const mode = ref(props.setting.mode);
const selected = ref<string[]>([...props.setting.allowedUserIds]);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLElement | null>(null);
const popover = ref<HTMLElement | null>(null);
const popoverStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' });

watch(() => props.setting, s => {
  mode.value = s.mode;
  selected.value = [...s.allowedUserIds];
});

// position:fixed from the trigger's rect: an absolute popover was clipped by scrolling ancestors. Flips left/up at the viewport edge.
async function positionPopover() {
  await nextTick();
  if (!trigger.value || !popover.value) return;

  const margin = 6;
  const triggerRect = trigger.value.getBoundingClientRect();
  const popoverRect = popover.value.getBoundingClientRect();

  let left = triggerRect.right - popoverRect.width;
  if (left < margin) left = triggerRect.left;
  left = Math.min(left, window.innerWidth - margin - popoverRect.width);
  left = Math.max(margin, left);

  let top = triggerRect.bottom + 4;
  if (top + popoverRect.height > window.innerHeight - margin) {
    top = triggerRect.top - popoverRect.height - 4;
  }
  top = Math.max(margin, top);

  popoverStyle.value = { left: `${left}px`, top: `${top}px` };
}

function onDocPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  // Teleported to <body> so no stacking context caps its z-index, hence its own «inside» check.
  if (root.value?.contains(target)) return;
  if (popover.value?.contains(target)) return;
  open.value = false;
}
function onReposition() { void positionPopover(); }
function onKey(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !open.value) return;
  open.value = false;
  event.preventDefault();
}
function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  // Capture phase: the character sheet overlay stops pointerdown from bubbling.
  document[method]('pointerdown', onDocPointerDown as EventListener, true);
  document[method]('keydown', onKey as EventListener);
  window[method]('scroll', onReposition, true);
  window[method]('resize', onReposition);
}
// The sheet does not scroll while the popover is open, otherwise it drifts away from its button.
let unlockScroll: () => void = () => {};
watch(open, isOpen => {
  listen(isOpen);
  if (isOpen) {
    void positionPopover();
    unlockScroll = lockNearestScroll(root.value);
  } else {
    unlockScroll();
  }
});
onBeforeUnmount(() => { listen(false); unlockScroll(); });

const ICONS: Record<VisibilitySetting['mode'], GameIconName> = { public: 'eye', hidden: 'eyeOff', allowlist: 'group' };
const icon = computed(() => ICONS[mode.value]);
const triggerTitle = computed(() => {
  if (mode.value === 'public') return 'Видно всем — нажмите, чтобы изменить';
  if (mode.value === 'hidden') return 'Скрыто от всех — нажмите, чтобы изменить';
  return 'Видно только выбранным — нажмите, чтобы изменить';
});

async function save(nextMode: 'public' | 'hidden' | 'allowlist') {
  if (nextMode === 'allowlist' && selected.value.length === 0) return;
  // The control can be reused for another field while the request is in flight.
  const { fieldKey, characterId } = props;
  const allowedUserIds = nextMode === 'allowlist' ? [...selected.value] : [];

  busy.value = true;

  try {
    await props.request(
      `/campaigns/${props.campaignId}/characters/${characterId}/visibility/${fieldKey}`,
      'PUT',
      { mode: nextMode, allowedUserIds: nextMode === 'allowlist' ? allowedUserIds : undefined },
    );
    if (characterId !== props.characterId) return;
    const sameField = fieldKey === props.fieldKey;
    if (sameField) mode.value = nextMode;
    emit('change', { mode: nextMode, allowedUserIds }, fieldKey);
    if (sameField && nextMode !== 'allowlist') open.value = false;
  } finally {
    busy.value = false;
  }
}

function onModeChange(event: Event) {
  const next = (event.target as HTMLSelectElement).value as 'public' | 'hidden' | 'allowlist';
  if (next === 'allowlist') {
    mode.value = 'allowlist';
    void positionPopover(); // the allowlist checkboxes just grew the popover — re-measure
  } else {
    save(next);
  }
}

function toggleMember(userId: string) {
  const index = selected.value.indexOf(userId);
  if (index === -1) selected.value.push(userId);
  else selected.value.splice(index, 1);
}
</script>

<template>
  <span ref="root" class="visibility-control">
    <button
      ref="trigger"
      type="button"
      class="visibility-trigger"
      :class="mode"
      :title="triggerTitle"
      :aria-label="triggerTitle"
      @click="open = !open"
    ><GameIcon class="inline-icon" :name="icon" :size="16" /></button>

    <teleport to="body">
      <div v-if="open" ref="popover" class="visibility-popover" role="dialog" :style="popoverStyle">
        <label>
          Кто видит
          <select :value="mode" :disabled="busy" @change="onModeChange">
            <option value="public">Видно всем</option>
            <option value="hidden">Скрыто от всех</option>
            <option value="allowlist">Видно только…</option>
          </select>
        </label>
        <div v-if="mode === 'allowlist'" class="allowlist-picker">
          <label v-for="m in members" :key="m.userId" class="checkbox-label">
            <input
              type="checkbox"
              :checked="selected.includes(m.userId)"
              :disabled="busy"
              @change="toggleMember(m.userId)"
            />
            {{ m.displayName }}
          </label>
          <button type="button" :disabled="busy || !selected.length" @click="save('allowlist')">Сохранить</button>
        </div>
      </div>
    </teleport>
  </span>
</template>

<style scoped>
.visibility-control{position:relative;display:inline-block;vertical-align:middle}
.visibility-trigger{min-height:auto;width:22px;height:22px;padding:0;border-radius:50%;font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;background:var(--input-bg);border-color:var(--input-border)}
.visibility-trigger.hidden{border-color:#91383e}
.visibility-trigger.allowlist{border-color:var(--gold-light)}
.visibility-popover{position:fixed;z-index:5000;padding:10px;min-width:200px;max-width:min(280px,90vw);background:var(--parchment-background);color:var(--ink);border:1px solid var(--brass);border-radius:4px;box-shadow:0 8px 20px #0006}
.visibility-popover label{display:block;margin:0 0 8px;font-size:12px;font-weight:600}
.visibility-popover select{margin-top:4px}
.allowlist-picker{display:flex;flex-direction:column;gap:6px}
.allowlist-picker .checkbox-label{margin:0;font-size:12px;font-weight:400}
.allowlist-picker button{min-height:26px;padding:2px 8px;font-size:12px;margin-top:2px}
</style>
