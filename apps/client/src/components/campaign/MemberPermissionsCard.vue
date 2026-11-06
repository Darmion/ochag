<script setup lang="ts">
import { ref, watch } from 'vue';

import {
  PERMISSION_CODES,
  PERMISSION_LABELS,
  saveMemberPermissions,
  saveMemberVision,
  type CampaignMember,
  type PermissionCode,
} from '../../campaign/campaignPermissions';

const props = defineProps<{
  campaignId: string;
  campaignName?: string;
  member: CampaignMember;
  request: (path: string, method?: string, body?: unknown) => Promise<any>;
}>();

const emit = defineEmits<{ saved: [] }>();

const isFullGm = ref(props.member.is_full_gm);
const permissions = ref<Set<PermissionCode>>(new Set(props.member.permissions));
const mayChooseAlliedVision = ref(props.member.may_choose_allied_vision);
const fogDisabledByGm = ref(props.member.fog_disabled_by_gm);

// Compare with what was last saved here, not props.member: the parent does not refetch after a save.
let baseline = { ...props.member };

const busy = ref(false);
const error = ref('');
const saved = ref(false);

watch(() => props.member, member => {
  baseline = { ...member };
  isFullGm.value = member.is_full_gm;
  permissions.value = new Set(member.permissions);
  mayChooseAlliedVision.value = member.may_choose_allied_vision;
  fogDisabledByGm.value = member.fog_disabled_by_gm;
  saved.value = false;
});

function togglePermission(code: PermissionCode, checked: boolean) {
  const next = new Set(permissions.value);
  if (checked) next.add(code); else next.delete(code);
  permissions.value = next;
  saved.value = false;
}

const dirty = () =>
  isFullGm.value !== baseline.is_full_gm ||
  mayChooseAlliedVision.value !== baseline.may_choose_allied_vision ||
  fogDisabledByGm.value !== baseline.fog_disabled_by_gm ||
  permissions.value.size !== baseline.permissions.length ||
  [...permissions.value].some(code => !baseline.permissions.includes(code));

async function save() {
  busy.value = true;
  error.value = '';
  saved.value = false;

  try {
    await saveMemberPermissions(props.request, props.campaignId, props.member.user_id, isFullGm.value, [...permissions.value]);
    await saveMemberVision(props.request, props.campaignId, props.member.user_id, mayChooseAlliedVision.value, fogDisabledByGm.value);
    baseline = {
      ...baseline,
      is_full_gm: isFullGm.value,
      permissions: [...permissions.value],
      may_choose_allied_vision: mayChooseAlliedVision.value,
      fog_disabled_by_gm: fogDisabledByGm.value,
    };
    saved.value = true;
    emit('saved');
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Не удалось сохранить права. Попробуйте ещё раз.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="permissions-card">
    <header>
      <strong>{{ member.display_name }}</strong>
      <span v-if="campaignName" class="muted campaign-name">— {{ campaignName }}</span>
    </header>

    <label class="checkbox-label full-gm">
      <input
        type="checkbox"
        :checked="isFullGm"
        :disabled="busy"
        @change="isFullGm = ($event.target as HTMLInputElement).checked; saved = false"
      />
      Полный мастер — игровое управление (сцены, персонажи, зрение), но не может назначать права другим
    </label>

    <fieldset class="permission-grid">
      <legend>Отдельные права</legend>
      <label v-for="code in PERMISSION_CODES" :key="code" class="checkbox-label">
        <input
          type="checkbox"
          :checked="permissions.has(code)"
          :disabled="busy"
          @change="togglePermission(code, ($event.target as HTMLInputElement).checked)"
        />
        {{ PERMISSION_LABELS[code] }}
      </label>
      <p class="muted hint">Действуют и без «Полного мастера» — можно выдать только одно конкретное право.</p>
    </fieldset>

    <fieldset class="permission-grid">
      <legend>Зрение на столе</legend>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="mayChooseAlliedVision"
          :disabled="busy"
          @change="mayChooseAlliedVision = ($event.target as HTMLInputElement).checked; saved = false"
        />
        Может смотреть глазами всего отряда (нужно, когда в «Свет и обзор» выбрано «каждый своими персонажами»)
      </label>
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="fogDisabledByGm"
          :disabled="busy"
          @change="fogDisabledByGm = ($event.target as HTMLInputElement).checked; saved = false"
        />
        Туман войны отключён лично для него
      </label>
    </fieldset>

    <div class="actions">
      <button type="button" :disabled="busy || !dirty()" @click="save">
        {{ busy ? 'Сохраняю…' : 'Сохранить права' }}
      </button>
      <span v-if="saved && !dirty()" class="saved-note">✔ Сохранено</span>
    </div>

    <p v-if="error" class="notice error">{{ error }}</p>
  </div>
</template>

<style scoped>
.permissions-card{padding:12px 14px;border:1px solid var(--brass-light);border-radius:3px;background:var(--surface-inset);display:flex;flex-direction:column;gap:10px}
.permissions-card header{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.campaign-name{font-size:13px}
.full-gm{font-weight:700;gap:10px}
.permission-grid{border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.permission-grid legend{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted-ink);padding:0;margin-bottom:2px}
.permission-grid .checkbox-label{gap:8px;font-size:14px}
.hint{font-size:12px;margin:2px 0 0}
.actions{display:flex;align-items:center;gap:10px}
.saved-note{color:#2f6b3a;font-weight:600;font-size:13px}
</style>
