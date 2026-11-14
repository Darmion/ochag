<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { CHECK_SKILL_NAMES, type CheckActor, type SkillCheck } from '../../../../../packages/domain/minigames/skill-checks';
// A hero's skill check inside a game: the server rolls it with the hero's modifiers; each hero tries once.
const props = defineProps<{ check: Pick<SkillCheck, 'skill' | 'dc'> & { tried?: CheckActor[] }; actors: CheckActor[]; busy: boolean; purpose: string }>();
const emit = defineEmits<{ roll: [heroId: string] }>();
const free = computed(() => props.actors.filter(actor => !(props.check.tried ?? []).some(entry => entry.id === actor.id)));
const heroId = ref('');
watch(free, list => { if (!list.some(actor => actor.id === heroId.value)) heroId.value = list[0]?.id ?? ''; }, { immediate: true });
const skill = computed(() => CHECK_SKILL_NAMES[props.check.skill] ?? props.check.skill);
</script>

<template>
  <fieldset class="hero-check">
    <legend>Проверка навыка: {{ skill }}, СЛ {{ check.dc }}</legend>
    <p>{{ purpose }}</p>
    <div class="row">
      <label>Герой
        <select v-model="heroId" :disabled="busy || !free.length">
          <option v-for="actor in free" :key="actor.id" :value="actor.id" translate="no">{{ actor.name }}</option>
        </select>
      </label>
      <slot />
      <button type="button" :disabled="busy || !heroId" @click="emit('roll', heroId)">Бросить проверку</button>
    </div>
    <p v-if="!free.length" class="muted">{{ actors.length ? 'Все ваши герои уже пробовали.' : 'У вас нет героя в этой кампании.' }}</p>
    <p v-if="check.tried?.length" class="muted">Уже пробовали: <span translate="no">{{ check.tried.map(entry => entry.name).join(', ') }}</span></p>
  </fieldset>
</template>

<style scoped>
.hero-check{margin:14px 0;padding:12px 14px;border:1px solid var(--brass-light);border-radius:8px;background:var(--surface-inset)}
.hero-check legend{padding:0 6px;font-size:13px;font-weight:700}
.hero-check p{margin:0 0 8px;font-size:13px;line-height:1.5}
.hero-check .muted{color:var(--muted-ink);font-size:12px;margin:8px 0 0}
.row{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:end}
.row label{display:grid;gap:4px;font-size:12px;min-width:0}
.row select{min-width:140px;max-width:100%}
</style>
